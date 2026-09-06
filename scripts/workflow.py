#!/usr/bin/env python3
"""Journal-club task state and structural checks; does not judge scientific truth."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SKILL_ROOT = Path(__file__).resolve().parents[1]
QUESTION = "你希望这次文献组会汇报 PPT 一共多少页？（包含封面、目录、结束页等实际使用的页面）"
THEME_QUESTION = "这次 PPT 想用哪种主题色？（蓝色、青色、红色、紫色）"
PRESENTER_QUESTION = "PPT 上的汇报人姓名填什么？如果不需要显示，请明确回答“不显示”。"
THEME_LABELS = {"blue": "蓝色", "teal": "青色", "red": "红色", "purple": "紫色"}
THEME_CATALOG = SKILL_ROOT / "assets/theme-palettes.json"
COLOR_ROLES = {"primary", "light", "rule", "ink", "gray", "white", "on_primary", "muted_on_primary"}
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}
PLACEHOLDER = re.compile(r"请输入|请根据|20XX|汇报人\s*[:：]\s*XXX", re.I)


class ContractError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def positive_int(value):
    return type(value) is int and value > 0


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        result = json.load(handle)
    require(isinstance(result, dict), f"JSON 顶层必须是对象：{path}")
    return result


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def workspace(path):
    path = Path(path).expanduser().resolve()
    require(path != SKILL_ROOT and SKILL_ROOT not in path.parents,
            "运行材料必须放在独立任务目录，不能写入技能目录。")
    return path


def report_timezone(name):
    """An explicit IANA zone is portable; null deliberately means the local zone."""
    if name is None:
        return None
    require(isinstance(name, str) and bool(name.strip()) and name == name.strip(),
            "汇报日期时区必须是 IANA 时区名称，例如 Asia/Shanghai。")
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ContractError(f"未知 IANA 时区：{name}") from exc


def initialize(workdir, pdfs, timezone_name=None):
    root = workspace(workdir)
    require(not (root / "_work/run.json").exists(), "任务已存在，不能覆盖。")
    require(bool(pdfs), "至少提供一篇 PDF。")
    paths = [Path(p).expanduser().resolve() for p in pdfs]
    require(len(set(paths)) == len(paths), "同一 PDF 路径重复输入。")
    for path in paths:
        require(path.is_file() and path.suffix.lower() == ".pdf", f"PDF 文件不存在：{path}")
    report_timezone(timezone_name)
    state = {
        "schema_version": 4,
        "status": "awaiting_page_count",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "page_question": QUESTION,
        "target_slide_count": None,
        "user_answer": None,
        "theme_question": THEME_QUESTION,
        "theme_id": None,
        "theme_user_answer": None,
        "presenter_question": PRESENTER_QUESTION,
        "presenter_name": None,
        "presenter_user_answer": None,
        "presenter_omitted": False,
        "report_timezone": timezone_name,
        "inputs": [{"paper_id": f"P{i}", "path": str(p)} for i, p in enumerate(paths, 1)],
    }
    save_json(root / "_work/run.json", state)
    return {"status": state["status"], "question": QUESTION}


def confirm_pages(workdir, pages, user_answer):
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    require(state["status"] == "awaiting_page_count", "页数已经确认；新任务应使用新的工作目录。")
    require(positive_int(pages), "总页数必须是用户确定的正整数。")
    require(isinstance(user_answer, str) and user_answer.strip(), "必须记录用户真实回答。")
    state.update(status="page_count_confirmed", target_slide_count=pages, user_answer=user_answer.strip())
    save_json(root / "_work/run.json", state)
    return {"status": state["status"], "target_slide_count": pages}


def confirm_theme(workdir, theme, user_answer):
    """Record the user's actual choice independently of the page-count gate."""
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    require(state.get("status") != "delivered", "任务已交付，不能静默修改主题色。")
    require(state.get("status") in {"awaiting_page_count", "page_count_confirmed"}, "任务状态不支持确认主题色。")
    require(isinstance(theme, str) and theme in THEME_LABELS,
            "主题色必须是 blue、teal、red 或 purple。")
    require(isinstance(user_answer, str) and user_answer.strip(), "必须记录用户真实的主题色回答。")
    state.update(theme_id=theme, theme_user_answer=user_answer.strip())
    save_json(root / "_work/run.json", state)
    return {"status": state["status"], "theme_id": theme, "theme_label": THEME_LABELS[theme]}


def confirm_presenter(workdir, name=None, user_answer=None, omit=False):
    """Record an existing user statement or the answer to the presenter question."""
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    require(state.get("status") != "delivered", "任务已交付，不能静默修改汇报人。")
    require(state.get("status") in {"awaiting_page_count", "page_count_confirmed"},
            "任务状态不支持确认汇报人。")
    require(type(omit) is bool and ((name is not None) != omit), "必须提供汇报人姓名，或明确选择不显示；两者不能同时使用。")
    require(isinstance(user_answer, str) and bool(user_answer.strip()), "必须记录用户真实的汇报人回答。")
    if not omit:
        require(isinstance(name, str) and bool(name.strip()), "汇报人姓名不能为空。")
        require(not re.fullmatch(r"X{2,}|待填(?:写)?|未提供", name.strip(), re.I),
                "汇报人不能使用模板占位姓名；不显示须由用户明确选择。")
    state.update(presenter_name=None if omit else name.strip(),
                 presenter_user_answer=user_answer.strip(), presenter_omitted=omit)
    save_json(root / "_work/run.json", state)
    return {"status": state["status"], "presenter_name": state["presenter_name"],
            "presenter_omitted": omit}


def get_report(workdir):
    """Resolve cover metadata at generation time without gating source analysis."""
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    name, answer = state.get("presenter_name"), state.get("presenter_user_answer")
    omitted = state.get("presenter_omitted", False)
    legacy = state.get("schema_version", 1) < 4 and name is None and not answer
    if legacy:
        omitted = True
    else:
        require(isinstance(answer, str) and bool(answer.strip()),
                "必须先询问汇报人，并等待用户真实回答；用户已提供姓名时直接记录，不重复提问。")
        require(type(omitted) is bool, "presenter_omitted 必须为布尔值。")
        require((omitted and name is None) or (not omitted and isinstance(name, str) and bool(name.strip())),
                "汇报人记录无效：须有真实姓名，或用户明确要求不显示。")
        if not omitted:
            require(not re.fullmatch(r"X{2,}|待填(?:写)?|未提供", name.strip(), re.I), "汇报人不能使用模板占位姓名。")
            name = name.strip()
    zone_name = state.get("report_timezone")
    zone = report_timezone(zone_name)
    current = datetime.now(zone) if zone is not None else datetime.now().astimezone()
    return {"status": "ready", "presenter_name": name, "presenter_omitted": omitted,
            "report_date": current.strftime("%Y.%m.%d"), "report_timezone": zone_name,
            "legacy_default": legacy}


def get_theme(workdir):
    """Resolve confirmed colors; only schema 1/2 jobs may inherit the historical blue."""
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    theme = state.get("theme_id")
    answer = state.get("theme_user_answer")
    legacy = state.get("schema_version", 1) < 3 and theme is None and not answer
    if legacy:
        theme = "blue"
    else:
        require(isinstance(theme, str) and theme in THEME_LABELS,
                "必须先询问主题色，并等待用户明确选择蓝色、青色、红色或紫色。")
        require(isinstance(answer, str) and bool(answer.strip()), "主题色缺少用户真实回答记录。")
    catalog = load_json(THEME_CATALOG)
    require(catalog.get("schema_version") == 1, "主题色目录版本不受支持。")
    entries = list_field(catalog, "themes")
    require(all(isinstance(item, dict) for item in entries), "主题色目录条目无效。")
    ids = [item.get("theme_id") for item in entries]
    require(len(ids) == len(THEME_LABELS) and all(isinstance(item, str) for item in ids)
            and set(ids) == set(THEME_LABELS), "主题色目录必须恰好包含蓝、青、红、紫四种主题，且不能重复。")
    selected = next(item for item in entries if item["theme_id"] == theme)
    colors = selected.get("colors")
    require(isinstance(colors, dict) and set(colors) == COLOR_ROLES,
            f"{theme} 主题色角色不完整或包含未知角色。")
    require(all(isinstance(value, str) and re.fullmatch(r"#[0-9A-F]{6}", value)
                for value in colors.values()), "主题色必须使用大写 #RRGGBB 格式。")
    label = selected.get("label")
    require(isinstance(label, str) and bool(label.strip()), "主题色目录缺少名称。")
    digest = hashlib.sha256(json.dumps(colors, sort_keys=True, separators=(",", ":"),
                                        ensure_ascii=True).encode("utf-8")).hexdigest()
    return {"status": "ready", "theme_id": theme, "theme_label": label, "colors": colors,
            "palette_sha256": digest, "legacy_default": legacy}


def confirmed_state(workdir):
    root = workspace(workdir)
    state = load_json(root / "_work/run.json")
    require(state.get("status") in {"page_count_confirmed", "delivered"}
            and positive_int(state.get("target_slide_count")) and bool(state.get("user_answer")),
            "必须先询问总页数，并等待用户回答。")
    return root, state


def list_field(obj, key):
    value = obj.get(key)
    require(isinstance(value, list), f"{key} 必须是列表。")
    return value


def evidence_review_level(item):
    """Normalize explicit review records without claiming unrecorded legacy work."""
    level = item.get("review_level")
    eid = item.get("evidence_id")
    if "review_level" in item:
        require(isinstance(level, str) and level in {"screened", "verified"},
                f"{eid} review_level 必须是 screened 或 verified。")
        require(not (level == "screened" and item.get("reviewed") is True),
                f"{eid} review_level=screened 与 reviewed=true 矛盾。")
        require(not (level == "verified" and item.get("reviewed") is False),
                f"{eid} review_level=verified 与 reviewed=false 矛盾。")
    if level is not None:
        return level
    return "verified" if item.get("reviewed") is True else None


def check_plan(workdir):
    root, state = confirmed_state(workdir)
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ContractError("来源页数核验需要 pypdf；请使用工作区依赖运行时。") from exc
    paper_data = load_json(root / "_work/papers.json")
    plan = load_json(root / "_work/deck-plan.json")
    papers = list_field(paper_data, "papers")
    slides = list_field(plan, "slides")
    inputs = {item["paper_id"]: Path(item["path"]) for item in state["inputs"]}
    require(len(papers) == len(inputs), "来源记录必须覆盖每篇输入 PDF。")
    seen_papers, evidence, warnings, records, evidence_records = set(), {}, [], {}, {}
    for paper in papers:
        pid = paper.get("paper_id")
        require(isinstance(pid, str) and pid in inputs and pid not in seen_papers,
                f"未知或重复 paper_id：{pid}")
        seen_papers.add(pid)
        records[pid] = paper
        role = paper.get("source_role", "primary")
        require(role in {"primary", "supplement", "duplicate"}, f"{pid} source_role 无效。")
        source = inputs[pid]
        require(source.is_file(), f"原始 PDF 已不存在：{pid}")
        reader = PdfReader(str(source))
        page_count = len(reader.pages)
        require(positive_int(paper.get("pdf_page_count")) and paper["pdf_page_count"] == page_count,
                f"{pid} 来源页数与真实 PDF 不一致。")
        require(paper.get("source_sha256") == sha256(source), f"{pid} PDF 散列不匹配。")
        if role == "primary":
            require(paper.get("main_evidence_screened") is True or paper.get("main_evidence_reviewed") is True,
                    f"{pid} 尚未记录主图表已完成实际筛查或审阅。")
        for item in list_field(paper, "evidence"):
            eid = item.get("evidence_id")
            require(isinstance(eid, str) and eid.startswith(pid + ":")
                    and len(eid) > len(pid) + 1 and eid not in evidence,
                    f"证据编号缺失、重复或归属错误：{eid}")
            require(item.get("kind") in {"figure", "table", "equation", "text"}, f"{eid} kind 无效。")
            evidence_review_level(item)
            require(isinstance(item.get("locator"), str) and item["locator"].strip(), f"{eid} 缺少来源定位。")
            page = item.get("pdf_page")
            require(page is None or (positive_int(page) and page <= page_count), f"{eid} 引用页码越界。")
            if page is None:
                warnings.append(f"{eid} 仅有结构定位，需要内容复核。")
            asset = item.get("asset_path")
            if asset is not None:
                require(isinstance(asset, str) and bool(asset.strip()), f"{eid} asset_path 无效。")
                asset_path = (root / asset).resolve()
                require(root in asset_path.parents and asset_path.is_file(), f"{eid} 图片文件不存在或不在任务目录。")
            evidence[eid] = pid
            evidence_records[eid] = item
    # An inventory proves recorded coverage, not that the agent actually read the figures.
    # Unused scientific figures do not need to be rasterized just to pass the contract.
    for pid, paper in records.items():
        if paper.get("source_role", "primary") != "primary":
            continue
        if (state.get("schema_version", 1) >= 2 or "main_evidence_ids" in paper
                or "main_evidence_screened" in paper
                or any("review_level" in item for item in paper["evidence"])):
            inventory = list_field(paper, "main_evidence_ids")
            require(all(isinstance(e, str) for e in inventory) and len(inventory) == len(set(inventory)),
                    f"{pid} 主图表清单存在重复或无效编号。")
            for eid in inventory:
                item = evidence_records.get(eid, {})
                require(evidence.get(eid) == pid and item.get("kind") in {"figure", "table"},
                        f"{pid} 主图表清单引用无效：{eid}")
                require(evidence_review_level(item) in {"screened", "verified"},
                        f"{eid} 主图表尚未完成实际审阅或筛查。")
                if paper.get("main_evidence_reviewed") is True:
                    require(evidence_review_level(item) == "verified",
                            f"{eid} main_evidence_reviewed=true 要求全部主图表完成详细核验（verified）。")
    primary_ids = {pid for pid, paper in records.items() if paper.get("source_role", "primary") == "primary"}
    require(bool(primary_ids), "至少需要一篇主文 PDF，不能只有补充或重复材料。")
    for pid, paper in records.items():
        role = paper.get("source_role", "primary")
        if role == "primary":
            continue
        parent = paper.get("related_to")
        require(isinstance(parent, str) and parent in primary_ids, f"{pid} related_to 必须指向主文来源。")
        require(isinstance(paper.get("association_note"), str) and paper["association_note"].strip(),
                f"{pid} 必须记录关联主文的依据。")
        require(isinstance(paper.get("reading_scope"), str) and paper["reading_scope"].strip(),
                f"{pid} 必须记录补充或重复材料的阅读范围。")
        if role == "duplicate":
            require(paper["source_sha256"] == records[parent]["source_sha256"], f"{pid} 重复材料必须与主文完全一致。")
    families = {pid: pid if pid in primary_ids else paper["related_to"]
                for pid, paper in records.items()}
    # Opting into layered review covers the associated source family as well.
    # Pure legacy records retain their previous behavior when no review was recorded.
    layered_families = {families[pid] for pid, paper in records.items()
                        if "main_evidence_screened" in paper
                        or any("review_level" in item for item in paper["evidence"])}
    experiments = {}
    for pid, paper in records.items():
        for experiment in paper.get("experiments", []):
            xid = experiment.get("experiment_id")
            require(isinstance(xid, str) and xid.startswith(pid + ":") and "." not in xid
                    and xid not in experiments, f"实验编号无效或重复：{xid}")
            values = experiment.get("values")
            require(isinstance(values, dict) and bool(values), f"{xid} 缺少实验条件。")
            require(all(isinstance(k, str) and re.fullmatch(r"[A-Za-z0-9_-]+", k)
                        and isinstance(v, (str, int, float)) and not isinstance(v, bool)
                        for k, v in values.items()), f"{xid} 实验条件必须为命名字段及文字或数值。")
            sources = list_field(experiment, "sources")
            require(bool(sources) and all(isinstance(e, str) and e in evidence for e in sources),
                    f"{xid} 实验条件缺少有效证据来源。")
            require(all(families[evidence[e]] == families[pid] for e in sources),
                    f"{xid} 实验条件来源须属于同一主文及其关联材料。")
            experiments[xid] = (pid, experiment)
    require(len(slides) == state["target_slide_count"], "计划页数不等于用户指定总页数。")
    catalog = load_json(SKILL_ROOT / "assets/k105-blue/layout-catalog.json")
    layouts = {item["layout_id"] for item in catalog["layouts"]}
    slide_ids, used_sources, slide_refs = set(), set(), {}
    for slide in slides:
        sid = slide.get("slide_id")
        require(isinstance(sid, str) and sid.strip() and sid not in slide_ids, f"slide_id 缺失或重复：{sid}")
        slide_ids.add(sid)
        require(isinstance(slide.get("title"), str) and slide["title"].strip(), f"{sid} 缺少标题。")
        layout = slide.get("layout_id")
        derived = isinstance(layout, str) and layout.startswith("derived:") and len(layout) > 8
        require(isinstance(layout, str) and (layout in layouts or derived), f"{sid} 未知版式：{layout}")
        if derived:
            require(isinstance(slide.get("layout_reason"), str) and slide["layout_reason"].strip(),
                    f"{sid} 衍生版式必须说明用途。")
        pids = list_field(slide, "paper_ids")
        require(all(isinstance(p, str) and p in inputs for p in pids), f"{sid} 引用了未知论文。")
        refs = list(list_field(slide, "evidence_ids"))
        for claim in list_field(slide, "claims"):
            require(isinstance(claim.get("text"), str) and claim["text"].strip(), f"{sid} 存在空结论。")
            require(claim.get("provenance") in {"paper", "analysis", "hypothesis"}, f"{sid} 结论性质无效。")
            sources = list_field(claim, "sources")
            require(bool(sources), f"{sid} 实质结论必须关联来源。")
            refs.extend(sources)
        for ref in refs:
            require(isinstance(ref, str) and ref in evidence, f"{sid} 未知证据编号：{ref}")
            require(evidence[ref] in pids, f"{sid} 证据不属于该页声明的论文：{ref}")
            owner = evidence[ref]
            item = evidence_records[ref]
            if item["kind"] in {"figure", "table", "equation"}:
                if (families[owner] in layered_families
                        or "review_level" in item or "reviewed" in item):
                    require(evidence_review_level(item) == "verified" and item.get("reviewed") is not False,
                            f"{sid} 使用的图表或公式须完成详细核验（verified）：{ref}")
            used_sources.add(owner)
            if records[owner].get("source_role", "primary") != "primary":
                require(records[owner]["related_to"] in pids, f"{sid} 补充或重复来源须同时声明所属主文。")
        slide_refs[sid] = set(refs)
        render = slide.get("render")
        if render is not None:
            require(isinstance(render, dict), f"{sid} render 必须是对象。")
            for panel in render.get("figures", []):
                eid = panel.get("evidence_id")
                require(isinstance(eid, str) and eid in refs, f"{sid} 展示图片必须声明证据来源：{eid}")
                require(evidence_records[eid].get("asset_path") is not None,
                        f"{sid} 实际展示的图片尚未提取：{eid}")
        for ref in condition_references(slide):
            xid, sep, key = ref.rpartition(".")
            require(sep and xid in experiments and key in experiments[xid][1]["values"],
                    f"{sid} 未知实验条件引用：{ref}")
            owner, experiment = experiments[xid]
            require(owner in pids, f"{sid} 实验条件不属于声明的论文：{ref}")
            require(set(experiment["sources"]).issubset(set(refs)),
                    f"{sid} 引用实验条件须声明其证据来源：{ref}")
    missing = primary_ids - used_sources
    require(not missing, f"计划遗漏了独立论文的证据：{', '.join(sorted(missing))}")
    for pid, paper in records.items():
        if paper.get("source_role", "primary") != "primary":
            continue
        # Method coverage is optional; any supplied record keeps the full contract.
        if "method_coverage" not in paper:
            continue
        coverage = paper["method_coverage"]
        require(isinstance(coverage, list), f"{pid} 方法论文缺少关键步骤覆盖记录。")
        aspects = [item.get("aspect") for item in coverage]
        require(len(aspects) == 5 and set(aspects) == {"inputs", "objective", "update", "outputs", "stopping"},
                f"{pid} 方法覆盖应检查输入、目标、关键求解、输出和停止条件。")
        for item in coverage:
            aspect = item.get("aspect")
            refs = list_field(item, "evidence_ids")
            require(bool(refs) and all(isinstance(e, str) and e in evidence for e in refs),
                    f"{pid} 方法覆盖缺少原文依据。")
            require(all(families[evidence[e]] == families[pid] for e in refs),
                    f"{pid} 方法覆盖来源须属于同一主文及其关联材料。")
            owners = item.get("slide_ids", [])
            omitted = item.get("omission_reason")
            require(isinstance(owners, list) and all(isinstance(s, str) and s in slide_refs for s in owners),
                    f"{pid} 方法覆盖引用未知幻灯片。")
            require(bool(owners) or (isinstance(omitted, str) and bool(omitted.strip())),
                    f"{pid} 未展示的关键步骤须说明省略理由。")
            if owners:
                required_refs = set(refs)
                unrelated = [sid for sid in owners if not required_refs.intersection(slide_refs[sid])]
                require(not unrelated,
                        f"{pid} 方法覆盖 {aspect} 的页面 {', '.join(unrelated)} 未引用该环节证据：{', '.join(sorted(required_refs))}。")
                covered = set().union(*(slide_refs[sid] for sid in owners))
                missing_refs = required_refs - covered
                require(not missing_refs,
                        f"{pid} 方法覆盖 {aspect} 在页面 {', '.join(owners)} 合计缺少证据：{', '.join(sorted(missing_refs))}。")
    if state.get("schema_version", 1) >= 4:
        check_group_navigation(plan, paper_data)
    return {"status": "pass", "slide_count": len(slides), "paper_count": len(primary_ids), "source_count": len(papers),
            "warnings": warnings, "scope": "结构与来源关联检查，不证明科学结论正确"}


def navigation_node():
    """Use the configured runtime without embedding any machine-specific path."""
    explicit = os.environ.get("RUNTIME_NODE")
    if explicit:
        path = Path(explicit)
        require(path.is_absolute() and path.is_file(), "RUNTIME_NODE 必须指向已配置运行时的绝对 Node 路径。")
        return str(path)
    modules = os.environ.get("RUNTIME_NODE_MODULES")
    if modules:
        path = Path(modules).parent / "bin" / "node"
        if path.is_absolute() and path.is_file():
            return str(path)
    executable = shutil.which("node")
    require(executable is not None,
            "组会导航检查需要 Node；请通过工作区依赖设置 RUNTIME_NODE 或 RUNTIME_NODE_MODULES。")
    return executable


def check_group_navigation(plan, papers):
    """Share the renderer's structural rules instead of duplicating them in Python."""
    navigation = plan.get("navigation")
    require(isinstance(navigation, dict) and navigation.get("profile") == "group-meeting",
            "新任务须设置 navigation.profile='group-meeting'，并按组会结构规划页面。")
    script = (
        "import fs from 'node:fs'; import {pathToFileURL} from 'node:url'; "
        "const {resolveNavigation}=await import(pathToFileURL(process.argv[1]).href); "
        "const {plan,papers}=JSON.parse(fs.readFileSync(0,'utf8')); "
        "try { console.log(JSON.stringify(resolveNavigation(plan,papers))); } "
        "catch(error) { console.error(error.message); process.exitCode=1; }"
    )
    try:
        checked = subprocess.run(
            [navigation_node(), "--input-type=module", "-e", script, str(SKILL_ROOT / "scripts/navigation.mjs")],
            input=json.dumps({"plan": plan, "papers": papers}, ensure_ascii=False),
            text=True, encoding="utf-8", capture_output=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ContractError(f"组会导航检查未能完成：{exc}") from exc
    require(checked.returncode == 0, f"组会导航结构不合格：{checked.stderr.strip() or checked.stdout.strip()}")
    try:
        resolved = json.loads(checked.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ContractError("组会导航检查未返回有效 JSON。") from exc
    require(isinstance(resolved, dict) and resolved.get("enabled") is True, "组会导航必须启用。")
    return resolved


def condition_references(value):
    """Resolve only explicit data references; never evaluate paper-derived strings."""
    if isinstance(value, str):
        yield from (ref.strip() for ref in re.findall(r"\{\{([^{}]+)\}\}", value))
    elif isinstance(value, dict):
        if "condition_ref" in value:
            require(isinstance(value["condition_ref"], str), "condition_ref 必须是字符串。")
            require(set(value) == {"condition_ref"}, "condition_ref 对象不能混入其他字段。")
            yield value["condition_ref"]
        for key, child in value.items():
            if key != "condition_ref":
                yield from condition_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from condition_references(child)


def stage(workdir, name, event):
    root, _ = confirmed_state(workdir)
    require(re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name), "阶段名只允许字母、数字、下划线和连字符。")
    target = root / "_work/timing" / f"{name}.json"
    now = datetime.now(timezone.utc)
    if event == "start":
        require(not target.exists(), "阶段名已存在；复测请使用新的名称。")
        record = {"name": name, "started_at": now.isoformat(), "status": "running"}
    else:
        record = load_json(target)
        require(record.get("status") == "running", "阶段未开始或已经结束。")
        record.update(status="complete", ended_at=now.isoformat(),
                      elapsed_seconds=round((now - datetime.fromisoformat(record["started_at"])).total_seconds(), 3))
    save_json(target, record)
    return record


def statistics(workdir):
    root, state = confirmed_state(workdir)
    stages = [load_json(p) for p in sorted((root / "_work/timing").glob("*.json"))]
    receipts = [load_json(p) for p in sorted((root / "_work/receipts").glob("*.json"))]
    metrics = {"stages": stages, "receipt_count": len(receipts),
               "receipt_paths": [str(p.relative_to(root)) for p in sorted((root / "_work/receipts").glob("*.json"))],
               "scope": "耗时以各工具回执为准；并行阶段不能相加作为总耗时，不推算token使用量。"}
    state["metrics"] = metrics
    save_json(root / "_work/run.json", state)
    return metrics


def inspect_pptx(path, expected_count):
    path = Path(path).resolve()
    require(path.is_file() and path.suffix.lower() == ".pptx", "需要实际的 PPTX 文件。")
    stats = []
    with ZipFile(path) as archive:
        presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
        relationships = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
        rels = {e.attrib["Id"]: e.attrib["Target"] for e in relationships
                if e.get("TargetMode") != "External"}
        slide_ids = presentation.findall("p:sldIdLst/p:sldId", NS)
        require(len(slide_ids) == expected_count, "PPTX 实际页数不等于用户指定总页数。")
        for index, slide_id in enumerate(slide_ids, 1):
            rid = slide_id.attrib[f"{{{NS['r']}}}id"]
            require(rid in rels, f"第{index}页关系引用缺失。")
            target = rels[rid]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("ppt", target))
            require(part.startswith("ppt/"), "非法幻灯片关系路径。")
            slide = ET.fromstring(archive.read(part))
            require(slide.get("show") not in {"0", "false"}, f"第{index}页被隐藏，需要明确调整后再交付。")
            texts = [e.text or "" for e in slide.findall(".//a:t", NS)]
            native_text = sum(bool(t.strip()) for t in texts)
            require(native_text > 0, f"第{index}页没有原生文字，需检查是否整页截图。")
            require(not PLACEHOLDER.search("".join(texts)), f"第{index}页有明显模板占位文字。")
            stats.append({"page": index, "native_text_runs": native_text,
                          "pictures": len(slide.findall(".//p:pic", NS)),
                          "tables": len(slide.findall(".//a:tbl", NS)),
                          "charts": len(slide.findall(".//c:chart", NS))})
    return {"status": "pass", "slide_count": len(stats), "slides": stats,
            "scope": "PPTX包检查；可读性、逐对象可编辑性和内容仍需人工或代理复核"}


def check_pptx(workdir, pptx):
    _, state = confirmed_state(workdir)
    return inspect_pptx(pptx, state["target_slide_count"])


def finalize(workdir, pptx):
    root, state = confirmed_state(workdir)
    require(state["status"] != "delivered", "任务已交付；不能静默覆盖。")
    requires_theme = state.get("schema_version", 1) >= 3 or any(
        state.get(key) is not None for key in ("theme_id", "theme_user_answer"))
    theme = get_theme(root) if requires_theme else None
    if state.get("schema_version", 1) >= 4:
        # Validate the user's metadata, but never compare generation date with
        # delivery date: reviewing a deck may legitimately cross midnight.
        get_report(root)
    check_plan(root)
    check_pptx(root, pptx)
    review = load_json(root / "_work/review.json")
    digest = sha256(pptx)
    require(review.get("pptx_sha256") == digest, "复核记录与当前PPTX不一致，可能是旧版本记录。")
    require(review.get("papers_sha256") == sha256(root / "_work/papers.json")
            and review.get("deck_plan_sha256") == sha256(root / "_work/deck-plan.json"),
            "复核记录与当前来源记录或页面计划不一致，请重新复核。")
    if theme is not None:
        require(review.get("theme_id") == theme["theme_id"]
                and review.get("palette_sha256") == theme["palette_sha256"],
                "复核记录与当前主题色或配色散列不一致，请按所选主题重制并复核。")
    require(review.get("unresolved_errors") == [], "仍有未解决问题或缺少问题记录。")
    plan = load_json(root / "_work/deck-plan.json")
    expected_ids = [s["slide_id"] for s in plan["slides"]]
    reviews = list_field(review, "slides")
    require([s.get("slide_id") for s in reviews] == expected_ids, "逐页复核必须按顺序覆盖所有计划页。")
    for item in reviews:
        require(all(item.get(k) is True for k in ("content_checked", "layout_checked", "editability_checked")),
                f"{item.get('slide_id')} 复核尚未完成。")
    output = root / "output"
    require(not output.exists() or (output.is_dir() and not any(output.iterdir())),
            "output必须为空，避免覆盖或交付多个文件。")
    output.mkdir(parents=True, exist_ok=True)
    final = output / "journal-club.pptx"
    with Path(pptx).open("rb") as src, final.open("xb") as dst:
        shutil.copyfileobj(src, dst)
    if sha256(final) != digest:
        final.unlink()
        raise ContractError("复制过程中PPTX变化，请重新检查。")
    state.update(status="delivered", output=str(final), output_sha256=digest)
    save_json(root / "_work/run.json", state)
    return {"status": "delivered", "pptx": str(final), "delivery_count": 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "confirm-pages", "confirm-theme", "get-theme", "confirm-presenter", "get-report",
                 "check-plan", "check-pptx", "finalize", "stage", "stats"):
        command = sub.add_parser(name)
        command.add_argument("--workdir", required=True, type=Path)
        if name == "init":
            command.add_argument("--pdf", required=True, action="append", type=Path)
            command.add_argument("--timezone", help="IANA time zone; omit to use the local generation date")
        elif name == "confirm-pages":
            command.add_argument("--pages", required=True, type=int)
            command.add_argument("--user-answer", required=True)
        elif name == "confirm-theme":
            command.add_argument("--theme", choices=tuple(THEME_LABELS), required=True)
            command.add_argument("--user-answer", required=True)
        elif name == "confirm-presenter":
            choice = command.add_mutually_exclusive_group(required=True)
            choice.add_argument("--name")
            choice.add_argument("--omit", action="store_true")
            command.add_argument("--user-answer", required=True)
        elif name in {"check-pptx", "finalize"}:
            command.add_argument("--pptx", required=True, type=Path)
        elif name == "stage":
            command.add_argument("--name", required=True)
            command.add_argument("--event", choices=("start", "end"), required=True)
    args = parser.parse_args()
    try:
        if args.command == "init":
            result = initialize(args.workdir, args.pdf, args.timezone)
        elif args.command == "confirm-pages":
            result = confirm_pages(args.workdir, args.pages, args.user_answer)
        elif args.command == "confirm-theme":
            result = confirm_theme(args.workdir, args.theme, args.user_answer)
        elif args.command == "get-theme":
            result = get_theme(args.workdir)
        elif args.command == "confirm-presenter":
            result = confirm_presenter(args.workdir, args.name, args.user_answer, args.omit)
        elif args.command == "get-report":
            result = get_report(args.workdir)
        elif args.command == "check-plan":
            result = check_plan(args.workdir)
        elif args.command == "check-pptx":
            result = check_pptx(args.workdir, args.pptx)
        elif args.command == "stage":
            result = stage(args.workdir, args.name, args.event)
        elif args.command == "stats":
            result = statistics(args.workdir)
        else:
            result = finalize(args.workdir, args.pptx)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
