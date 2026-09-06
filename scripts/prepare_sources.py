#!/usr/bin/env python3
"""Prepare cached paper text, page previews and selected figure crops after page confirmation."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib
import importlib.metadata
import json
import math
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from workflow import ContractError, confirmed_state, require, sha256


SCHEMA_VERSION = 1
SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
SAFE_NAME = re.compile(r"^[\w-][\w.-]{0,119}$", re.UNICODE)


def _version(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _inside(root, path):
    """Reject escapes, including existing symlinks; all outputs belong to _work."""
    path = Path(path).resolve()
    base = root / "_work"
    require(path != base and base in path.parents,
            f"输出必须位于任务的 _work 目录内：{path}")
    return path


def _atomic_bytes(root, path, data):
    path = _inside(root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _save(root, path, data):
    _atomic_bytes(root, path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def _load(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, UnicodeError):
        return {}


def _fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _asset(root, path, **extra):
    path = _inside(root, path)
    return {"path": str(path.relative_to(root)), "sha256": sha256(path), **extra}


def _valid_asset(root, record, expected_path, image=False):
    if not isinstance(record, dict) or record.get("path") != str(expected_path.relative_to(root)):
        return False
    path = _inside(root, root / record["path"])
    try:
        if not path.is_file() or sha256(path) != record.get("sha256"):
            return False
        if image:
            from PIL import Image
            with Image.open(path) as im:
                im.verify()
        return True
    except (OSError, ValueError):
        return False


@contextlib.contextmanager
def _paper_lock(root, folder):
    # Distinct paper directories can run concurrently. Same-paper writers fail
    # immediately instead of racing or hiding latency behind a blocking lock.
    import fcntl
    lock = _inside(root, folder / ".prepare.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ContractError(f"该论文正在预处理或裁图，请完成后再重试：{folder.name}") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _dependencies(renderer="auto", pdftoppm=None):
    require(renderer in {"auto", "pdfium", "pdftoppm"}, "renderer 无效。")
    versions = {}
    for module, package in (("pypdf", "pypdf"), ("PIL.Image", "Pillow")):
        try:
            importlib.import_module(module)
        except ImportError as exc:
            raise ContractError(f"需要 {package}；请使用 load_workspace_dependencies 返回的 Python 运行时。") from exc
        versions[package] = _version(package)
    pdfium = None
    try:
        pdfium = importlib.import_module("pypdfium2")
        version = importlib.import_module("pypdfium2.version")
        versions["pypdfium2"] = _version("pypdfium2")
        versions["pdfium"] = str(version.PDFIUM_INFO)
    except (ImportError, OSError):
        versions["pypdfium2"] = "unavailable"
    if renderer == "pdfium" or (renderer == "auto" and pdfium is not None):
        require(pdfium is not None, "pypdfium2 不可用；选择显式 pdftoppm 路径或修复运行时。")
        return {"name": "pdfium", "version": versions.get("pypdfium2"),
                "engine_version": versions.get("pdfium"), "dependencies": versions}
    require(pdftoppm is not None, "需要 pypdfium2 或通过 --pdftoppm 提供已定位的可执行文件绝对路径。")
    executable = Path(pdftoppm).expanduser()
    require(executable.is_absolute() and executable.is_file(), "--pdftoppm 必须是已定位的可执行文件绝对路径。")
    try:
        probe = subprocess.run([str(executable), "-v"], capture_output=True, text=True,
                               timeout=10, check=True)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContractError(f"pdftoppm 无法运行：{exc}") from exc
    version = (probe.stdout + probe.stderr).strip().splitlines()[0]
    return {"name": "pdftoppm", "path": str(executable.resolve()), "version": version,
            "dependencies": versions}


def preflight(renderer="auto", pdftoppm=None):
    """Dependency check only: no source PDF is read and no task file is written."""
    start = time.monotonic()
    selected = _dependencies(renderer, pdftoppm)
    return {"status": "ready", "python": sys.executable, "renderer": selected,
            "elapsed_seconds": round(time.monotonic() - start, 3),
            "scope": "依赖检查；未读取论文，未完成分析或复核"}


def _inputs(state, paper_ids):
    selected = set(paper_ids or [])
    known = {item["paper_id"] for item in state["inputs"]}
    require(not (selected - known), f"未知 paper_id：{', '.join(sorted(selected - known))}")
    result = []
    for item in state["inputs"]:
        pid = item["paper_id"]
        require(isinstance(pid, str) and SAFE_ID.fullmatch(pid), "来源 paper_id 不能用于安全的目录名。")
        if not selected or pid in selected:
            source = Path(item["path"]).expanduser().resolve()
            require(source.is_file(), f"原始 PDF 不存在：{source}")
            result.append((pid, source))
    require(result, "没有可处理的论文。")
    return result


def _reader(source):
    from pypdf import PdfReader
    try:
        reader = PdfReader(str(source))
        if reader.is_encrypted:
            try:
                unlocked = reader.decrypt("")
            except Exception as exc:
                raise ContractError(f"PDF 已加密且无法以空密码读取：{source.name}（{exc}）") from exc
            require(bool(unlocked), f"PDF 需要密码，不能读取：{source.name}")
        require(len(reader.pages) > 0, f"PDF 没有可读取页面：{source.name}")
        return reader
    except ContractError:
        raise
    except Exception as exc:
        raise ContractError(f"无法读取 PDF：{source.name}（{exc}）") from exc


def _geometry(page):
    box = page.cropbox
    width, height = float(box.width), float(box.height)
    rotation = int(page.rotation or 0) % 360
    if rotation in {90, 270}:
        width, height = height, width
    require(width > 0 and height > 0, "PDF 页面尺寸无效。")
    return {"display_width_pt": width, "display_height_pt": height,
            "rotation": rotation, "user_unit": float(page.user_unit)}


def _extract(root, folder, reader, source_hash, previous):
    key = _fingerprint({"schema": SCHEMA_VERSION, "source_sha256": source_hash,
                        "pypdf": _version("pypdf"), "method": "extract_text/plain/v1"})
    text_path, pages_path = folder / "fulltext.txt", folder / "pages.json"
    cached = previous.get("text", {})
    if cached.get("cache_key") == key and _valid_asset(root, cached.get("fulltext"), text_path) \
            and _valid_asset(root, cached.get("page_map"), pages_path):
        return cached, _load(pages_path).get("pages", []), True
    records, pieces, offset = [], [], 0
    for index, page in enumerate(reader.pages, 1):
        issues = []
        try:
            content = page.extract_text() or ""
        except Exception as exc:
            content = ""
            issues.append({"kind": "extraction_error", "message": str(exc)[:500]})
        count = len(content.strip())
        if count == 0:
            issues.append({"kind": "no_text", "message": "本页未提取到文字；检查页面图像，必要时使用 OCR。"})
        elif count < 20:
            issues.append({"kind": "sparse_text", "message": "本页文字很少；检查是否扫描页、图页或提取缺失。"})
        if "\ufffd" in content:
            issues.append({"kind": "replacement_characters", "message": "提取文字含替换字符，需对照页面检查。"})
        marker = f"\n===== PDF PAGE {index} =====\n"
        start = offset + len(marker)
        pieces.extend((marker, content, "\n"))
        records.append({"pdf_page": index, "text_start": start, "text_end": start + len(content),
                        "text_characters": count, **_geometry(page), "extraction_issues": issues})
        offset = start + len(content) + 1
    _atomic_bytes(root, text_path, "".join(pieces).encode("utf-8"))
    _save(root, pages_path, {"schema_version": SCHEMA_VERSION,
                           "source_sha256": source_hash,
                           "offset_units": "Python Unicode string indices in fulltext.txt; end exclusive",
                           "pages": records})
    return {"cache_key": key, "fulltext": _asset(root, text_path),
            "page_map": _asset(root, pages_path)}, records, False


def _render(root, target, source, page_number, geometry, selected, *, width=None, dpi=None, bbox=None):
    """Render a single visible page or a single region; never render the entire PDF at high DPI."""
    from PIL import Image
    target = _inside(root, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.png")
    try:
        if selected["name"] == "pdfium":
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(str(source)) as document:
                page = document[page_number - 1]
                try:
                    pw, ph = page.get_size()
                    scale = width / pw if width is not None else dpi / 72
                    edges = (0, 0, 0, 0)
                    if bbox is not None:
                        x0, y0, x1, y1 = bbox
                        # Remove floating-point noise before PDFium rounds pixel
                        # cuts up (e.g. 200.00000000000003 must not lose a pixel).
                        edges = tuple(round(v, 10) for v in
                                      (x0 * pw, (1 - y1) * ph, (1 - x1) * pw, y0 * ph))
                    bitmap = page.render(scale=scale, crop=edges)
                    try:
                        bitmap.to_pil().save(temporary, format="PNG")
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        else:
            command = [selected["path"], "-f", str(page_number), "-l", str(page_number),
                       "-singlefile", "-cropbox", "-png"]
            pw, ph = geometry["display_width_pt"], geometry["display_height_pt"]
            if width is not None:
                command.extend(["-scale-to-x", str(width), "-scale-to-y", "-1"])
            else:
                command.extend(["-r", str(dpi)])
            if bbox is not None:
                scale = dpi / 72 * geometry.get("user_unit", 1)
                x0, y0, x1, y1 = bbox
                left, top = math.floor(x0 * pw * scale), math.floor(y0 * ph * scale)
                right, bottom = math.ceil(x1 * pw * scale), math.ceil(y1 * ph * scale)
                command.extend(["-x", str(left), "-y", str(top), "-W", str(right - left), "-H", str(bottom - top)])
            command.extend([str(source), str(temporary.with_suffix(""))])
            try:
                subprocess.run(command, capture_output=True, text=True, timeout=120, check=True)
            except subprocess.CalledProcessError as exc:
                raise ContractError(f"第 {page_number} 页渲染失败：{exc.stderr[:1000]}") from exc
        with Image.open(temporary) as im:
            im.load()
            dimensions = {"width_px": im.width, "height_px": im.height}
            require(im.width > 0 and im.height > 0, "渲染结果为空。")
        temporary.replace(target)
        return dimensions
    except ContractError:
        raise
    except Exception as exc:
        raise ContractError(f"第 {page_number} 页渲染失败：{exc}") from exc
    finally:
        temporary.unlink(missing_ok=True)


def _receipt(root, operation, start, data):
    path = root / "_work/receipts" / f"source-{operation}-{uuid.uuid4().hex}.json"
    _save(root, path, {"schema_version": SCHEMA_VERSION, "tool": "prepare_sources",
                      "operation": operation, "completed_at": datetime.now(timezone.utc).isoformat(),
                      "elapsed_seconds": round(time.monotonic() - start, 3), **data})
    return str(path)


def prepare(workdir, paper_ids=None, preview_width=1200, renderer="auto", pdftoppm=None):
    start = time.monotonic()
    root, state = confirmed_state(workdir)
    require(type(preview_width) is int and 100 <= preview_width <= 4000, "preview-width 必须在 100–4000 像素之间。")
    selected = _dependencies(renderer, pdftoppm)
    inputs = _inputs(state, paper_ids)
    summaries, errors = [], []
    for pid, source in inputs:
        paper_start = time.monotonic()
        folder = _inside(root, root / "_work/sources" / pid)
        try:
            with _paper_lock(root, folder):
                source_hash = sha256(source)
                previous = _load(folder / "manifest.json")
                reader = _reader(source)
                text_record, pages, text_cached = _extract(root, folder, reader, source_hash, previous)
                old_previews = {p.get("pdf_page"): p for p in previous.get("previews", []) if isinstance(p, dict)}
                previews, rendered, reused = [], 0, 0
                for page in pages:
                    number = page["pdf_page"]
                    target = folder / "previews" / f"page-{number:03d}.png"
                    key = _fingerprint({"schema": SCHEMA_VERSION, "source_sha256": source_hash,
                                        "page": number, "preview_width": preview_width, "renderer": selected})
                    cached = old_previews.get(number, {})
                    if cached.get("cache_key") == key and _valid_asset(root, cached, target, image=True):
                        record = cached
                        reused += 1
                    else:
                        size = _render(root, target, source, number, page, selected, width=preview_width)
                        record = _asset(root, target, pdf_page=number, cache_key=key, **size)
                        rendered += 1
                    previews.append(record)
                require(sha256(source) == source_hash, f"处理期间 PDF 发生变化，请重新执行：{pid}")
                issues = [{"pdf_page": p["pdf_page"], "issues": p["extraction_issues"]}
                          for p in pages if p["extraction_issues"]]
                manifest = {"schema_version": SCHEMA_VERSION, "paper_id": pid, "source_path": str(source),
                            "source_sha256": source_hash, "pdf_page_count": len(pages),
                            "preview_width": preview_width, "renderer": selected, "text": text_record,
                            "previews": previews, "extraction_issues": issues,
                            "scope": "仅提取和渲染；不会自动记录已阅读、图表已审阅或科学结论。"}
                _save(root, folder / "manifest.json", manifest)
                summaries.append({"paper_id": pid, "status": "needs_inspection" if issues else "prepared",
                                  "pdf_page_count": len(pages), "manifest": str(folder / "manifest.json"),
                                  "fulltext": str(folder / "fulltext.txt"), "page_map": str(folder / "pages.json"),
                                  "preview_directory": str(folder / "previews"), "text_cache_hit": text_cached,
                                  "pages_rendered": rendered, "pages_reused": reused,
                                  "extraction_issue_pages": len(issues),
                                  "elapsed_seconds": round(time.monotonic() - paper_start, 3)})
        except Exception as exc:
            errors.append({"paper_id": pid, "message": str(exc),
                           "elapsed_seconds": round(time.monotonic() - paper_start, 3)})
    status = "error" if errors else ("needs_inspection" if any(p["extraction_issue_pages"] for p in summaries) else "prepared")
    result = {"status": status, "papers": summaries, "errors": errors,
              "elapsed_seconds": round(time.monotonic() - start, 3)}
    result["receipt"] = _receipt(root, "prepare", start, result)
    return result


def _bbox(values):
    require(isinstance(values, (list, tuple)) and len(values) == 4, "bbox 需要四个数：x0 y0 x1 y1。")
    require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values),
            "bbox 必须是有限数值。")
    x0, y0, x1, y1 = [float(v) for v in values]
    require(0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1,
            "bbox 使用显示页面左上原点的归一化坐标；必须满足 0≤x0<x1≤1、0≤y0<y1≤1。")
    return [x0, y0, x1, y1]


def crop(workdir, paper_id, page, bbox, name, dpi=220, renderer="auto", pdftoppm=None):
    start = time.monotonic()
    root, state = confirmed_state(workdir)
    bbox = _bbox(bbox)
    require(isinstance(name, str) and SAFE_NAME.fullmatch(name) and ".." not in name,
            "name 只能包含文字、数字、下划线、连字符和单点，最长 120 字符，不能含路径。")
    require(type(page) is int and page > 0, "page 必须是从 1 开始的 PDF 页码。")
    require(isinstance(dpi, (float, int)) and not isinstance(dpi, bool) and math.isfinite(dpi)
            and 72 <= dpi <= 600, "dpi 必须在 72–600 之间。")
    # CLI numbers and JSON integers describe the same rendering request.
    dpi = float(dpi)
    selected = _dependencies(renderer, pdftoppm)
    [(pid, source)] = _inputs(state, [paper_id])
    folder = _inside(root, root / "_work/sources" / pid)
    try:
        with _paper_lock(root, folder):
            source_hash = sha256(source)
            reader = _reader(source)
            require(page <= len(reader.pages), f"page 越界：PDF 共 {len(reader.pages)} 页。")
            geometry = _geometry(reader.pages[page - 1])
            target, provenance = folder / "crops" / f"{name}.png", folder / "crops" / f"{name}.json"
            request = {"schema_version": SCHEMA_VERSION, "paper_id": pid, "source_path": str(source),
                       "source_sha256": source_hash, "pdf_page": page, "bbox": bbox,
                       "bbox_convention": "normalized visible page; top-left origin; x0 y0 x1 y1",
                       "dpi": dpi, "renderer": selected, "geometry": geometry}
            key = _fingerprint(request)
            previous = _load(provenance)
            cache_hit = previous.get("cache_key") == key and _valid_asset(root, previous.get("image"), target, image=True)
            if not cache_hit:
                size = _render(root, target, source, page, geometry, selected, dpi=dpi, bbox=bbox)
                require(sha256(source) == source_hash, f"处理期间 PDF 发生变化，请重新执行：{pid}")
                _save(root, provenance, {**request, "cache_key": key, "image": _asset(root, target, **size),
                                         "scope": "忠实保留指定裁切范围；坐标、图例和图注完整性需实际查看。"})
            require(sha256(source) == source_hash, f"处理期间 PDF 发生变化，请重新执行：{pid}")
            result = {"status": "cropped", "paper_id": pid, "pdf_page": page,
                      "image": str(target), "provenance": str(provenance), "cache_hit": cache_hit,
                      "elapsed_seconds": round(time.monotonic() - start, 3)}
    except Exception as exc:
        _receipt(root, "crop", start, {"status": "error", "paper_id": pid, "pdf_page": page, "message": str(exc)})
        raise
    result["receipt"] = _receipt(root, "crop", start, result)
    return result


def crop_batch(workdir, items, dpi=220, renderer="auto", pdftoppm=None):
    """Run explicit crop requests in-process; each successful crop remains safely reusable."""
    start = time.monotonic()
    root, _ = confirmed_state(workdir)
    try:
        requests = json.loads(Path(items).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise ContractError(f"无法读取裁图任务 JSON：{exc}") from exc
    require(isinstance(requests, list) and requests, "裁图任务 JSON 必须是非空数组。")
    required = {"paper_id", "page", "bbox", "name"}
    results, seen = [], set()
    for index, request in enumerate(requests, 1):
        summary = {"item": index}
        try:
            require(isinstance(request, dict), "每项裁图任务必须是 JSON 对象。")
            summary.update({key: request[key] for key in ("paper_id", "name")
                            if isinstance(request.get(key), str)})
            missing = required - request.keys()
            require(not missing, f"缺少字段：{', '.join(sorted(missing))}")
            unknown = request.keys() - (required | {"dpi"})
            require(not unknown, f"未知字段：{', '.join(sorted(unknown))}")
            require(isinstance(request["paper_id"], str) and isinstance(request["name"], str),
                    "paper_id 和 name 必须是字符串。")
            identity = (request["paper_id"], request["name"])
            require(identity not in seen, "同一批次不能重复使用相同的 paper_id 和 name；不同范围请用不同名称。")
            seen.add(identity)
            result = crop(workdir, **{**request, "dpi": request.get("dpi", dpi)},
                          renderer=renderer, pdftoppm=pdftoppm)
            summary.update({key: result[key] for key in
                            ("status", "pdf_page", "image", "provenance", "cache_hit")})
        except Exception as exc:
            summary.update(status="error", message=str(exc))
        results.append(summary)
    completed = [item for item in results if item["status"] == "cropped"]
    reused = sum(item["cache_hit"] for item in completed)
    result = {"status": "cropped" if len(completed) == len(results) else "error",
              "total": len(results), "completed": len(completed),
              "rendered": len(completed) - reused, "reused": reused,
              "items": results, "elapsed_seconds": round(time.monotonic() - start, 3)}
    result["receipt"] = _receipt(root, "crop-batch", start, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("preflight", "prepare", "crop", "crop-batch"):
        item = sub.add_parser(command)
        item.add_argument("--renderer", choices=("auto", "pdfium", "pdftoppm"), default="auto")
        item.add_argument("--pdftoppm", type=Path, help="Explicit absolute path, if PDFium is unavailable.")
        if command != "preflight":
            item.add_argument("--workdir", required=True, type=Path)
        if command == "prepare":
            item.add_argument("--paper-id", action="append", dest="paper_ids", help="Repeat for an independent paper subset.")
            item.add_argument("--preview-width", type=int, default=1200)
        elif command == "crop":
            item.add_argument("--paper-id", required=True)
            item.add_argument("--page", required=True, type=int, help="One-based PDF page.")
            item.add_argument("--bbox", required=True, nargs=4, type=float, metavar=("X0", "Y0", "X1", "Y1"))
            item.add_argument("--name", required=True)
            item.add_argument("--dpi", type=float, default=220)
        elif command == "crop-batch":
            item.add_argument("--items", required=True, type=Path,
                              help="JSON array of {paper_id, page, bbox, name, dpi?} crop requests.")
            item.add_argument("--dpi", type=float, default=220, help="Default DPI; an item may override it.")
    args = vars(parser.parse_args())
    command = args.pop("command")
    try:
        result = {"preflight": preflight, "prepare": prepare, "crop": crop,
                  "crop-batch": crop_batch}[command](**args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result["status"] == "error" else 0
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
