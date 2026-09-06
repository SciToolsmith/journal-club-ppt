"""Focused source preparation regression tests; no scientific judgments are automated."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import prepare_sources as ps
from workflow import ContractError, confirm_pages, initialize, sha256


def write_pdf(path, text="Source A", *, encrypted=False, rotated=False):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=100)
    # Visual quadrants: upper-left red, upper-right blue; remaining white.
    stream = DecodedStreamObject()
    stream.set_data((f"1 0 0 rg 0 50 100 50 re f\n0 0 1 rg 100 50 100 50 re f\n"
                     f"0 0 0 rg BT /F1 10 Tf 10 15 Td ({text}) Tj ET").encode())
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    page[NameObject("/Contents")] = writer._add_object(stream)
    if rotated:
        page.rotate(90)
    if encrypted:
        writer.encrypt("requires-password")
    with path.open("wb") as handle:
        writer.write(handle)


class SourcePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.pdf = self.base / "source.pdf"
        write_pdf(self.pdf, "Sufficient original text for extraction")
        self.work = self.base / "task"
        initialize(self.work, [self.pdf])

    def confirm(self):
        confirm_pages(self.work, 15, "15")

    def read(self, path):
        return json.loads(Path(path).read_text())

    def batch_file(self, items):
        path = self.base / "crop-items.json"
        path.write_text(json.dumps(items), encoding="utf-8")
        return path

    def test_page_gate_precedes_pdf_reads_and_writes(self):
        before = sorted(str(p.relative_to(self.work)) for p in self.work.rglob("*"))
        with mock.patch.object(ps, "_reader", side_effect=AssertionError("must not read")):
            with self.assertRaises(ContractError):
                ps.prepare(self.work)
            with self.assertRaises(ContractError):
                ps.crop(self.work, "P1", 1, [0, 0, 1, 1], "figure")
            with self.assertRaisesRegex(ContractError, "页数"):
                ps.crop_batch(self.work, self.base / "not-read.json")
            self.assertEqual(ps.preflight()["status"], "ready")
        after = sorted(str(p.relative_to(self.work)) for p in self.work.rglob("*"))
        self.assertEqual(before, after)

    def test_text_page_mapping_preview_and_no_review_fields(self):
        self.confirm()
        result = ps.prepare(self.work, preview_width=300)
        paper = result["papers"][0]
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(paper["pages_rendered"], 1)
        text = Path(paper["fulltext"]).read_text()
        page = self.read(paper["page_map"])["pages"][0]
        self.assertIn("Sufficient original", text[page["text_start"]:page["text_end"]])
        manifest = self.read(paper["manifest"])
        self.assertEqual(manifest["previews"][0]["width_px"], 300)
        self.assertEqual(manifest["source_sha256"], sha256(self.pdf))
        self.assertNotIn("main_evidence_reviewed", manifest)
        self.assertFalse((self.work / "_work/papers.json").exists())
        self.assertFalse((self.work / "output").exists())

    def test_cache_hit_does_not_extract_or_render(self):
        self.confirm()
        ps.prepare(self.work, preview_width=300)
        with mock.patch.object(ps, "_render", side_effect=AssertionError("cache must avoid render")), \
                mock.patch("pypdf._page.PageObject.extract_text", side_effect=AssertionError("cache must avoid extraction")):
            result = ps.prepare(self.work, preview_width=300)
        self.assertEqual(result["status"], "prepared")
        self.assertTrue(result["papers"][0]["text_cache_hit"])
        self.assertEqual(result["papers"][0]["pages_reused"], 1)

    def test_resolution_change_reuses_text_source_change_invalidates_both(self):
        self.confirm()
        ps.prepare(self.work, preview_width=300)
        resized = ps.prepare(self.work, preview_width=400)["papers"][0]
        self.assertTrue(resized["text_cache_hit"])
        self.assertEqual(resized["pages_rendered"], 1)
        write_pdf(self.pdf, "Replacement source has different text")
        changed = ps.prepare(self.work, preview_width=400)["papers"][0]
        self.assertFalse(changed["text_cache_hit"])
        self.assertEqual(changed["pages_rendered"], 1)
        self.assertIn("Replacement source", Path(changed["fulltext"]).read_text())

    def test_corrupt_preview_and_text_are_rebuilt(self):
        self.confirm()
        result = ps.prepare(self.work, preview_width=300)["papers"][0]
        preview = Path(result["preview_directory"]) / "page-001.png"
        preview.write_bytes(b"not a PNG")
        Path(result["fulltext"]).write_text("tampered")
        repaired = ps.prepare(self.work, preview_width=300)["papers"][0]
        self.assertEqual(repaired["pages_rendered"], 1)
        self.assertFalse(repaired["text_cache_hit"])
        self.assertIn("Sufficient original", Path(repaired["fulltext"]).read_text())
        from PIL import Image
        with Image.open(preview) as im:
            self.assertEqual(im.width, 300)

    def test_multi_source_subset_does_not_touch_other_paper(self):
        second = self.base / "second.pdf"
        write_pdf(second, "Other paper with independent content")
        multi = self.base / "multi"
        initialize(multi, [self.pdf, second])
        confirm_pages(multi, 15, "15")
        state_hash = sha256(multi / "_work/run.json")
        first = ps.prepare(multi, paper_ids=["P1"], preview_width=300)
        first_hash = sha256(first["papers"][0]["manifest"])
        self.assertFalse((multi / "_work/sources/P2").exists())
        other = ps.prepare(multi, paper_ids=["P2"], preview_width=300)
        self.assertEqual(other["papers"][0]["paper_id"], "P2")
        self.assertEqual(first_hash, sha256(first["papers"][0]["manifest"]))
        self.assertEqual(state_hash, sha256(multi / "_work/run.json"))
        self.assertNotEqual(first["receipt"], other["receipt"])

    def test_crop_bounds_page_gate_names_and_actual_top_left_region(self):
        self.confirm()
        for bounds in ([-.1, 0, 1, 1], [0, 0, 1.1, 1], [0, 0, 0, 1], [0, .5, 1, .2], [0, 0, float("nan"), 1]):
            with self.subTest(bounds=bounds), self.assertRaises(ContractError):
                ps.crop(self.work, "P1", 1, bounds, "invalid")
        with self.assertRaises(ContractError):
            ps.crop(self.work, "P1", 2, [0, 0, 1, 1], "missing")
        with self.assertRaises(ContractError):
            ps.crop(self.work, "P1", 1, [0, 0, 1, 1], "../escape")
        result = ps.crop(self.work, "P1", 1, [0, 0, .5, .5], "red-quadrant", dpi=144)
        from PIL import Image
        with Image.open(result["image"]).convert("RGB") as im:
            self.assertEqual(im.size, (200, 100))
            self.assertEqual(im.getpixel((100, 50)), (255, 0, 0))
        provenance = self.read(result["provenance"])
        self.assertEqual(provenance["bbox"], [0., 0., .5, .5])
        self.assertEqual(provenance["image"]["sha256"], sha256(result["image"]))
        self.assertFalse((self.work / "_work/sources/P1/previews").exists())

    def test_crop_cache_corruption_and_bbox_invalidation(self):
        self.confirm()
        first = ps.crop(self.work, "P1", 1, [0, 0, .5, .5], "crop", dpi=144)
        self.assertTrue(ps.crop(self.work, "P1", 1, [0, 0, .5, .5], "crop", dpi=144)["cache_hit"])
        Path(first["image"]).write_bytes(b"broken")
        self.assertFalse(ps.crop(self.work, "P1", 1, [0, 0, .5, .5], "crop", dpi=144)["cache_hit"])
        changed = ps.crop(self.work, "P1", 1, [.5, 0, 1, .5], "crop", dpi=144)
        self.assertFalse(changed["cache_hit"])
        from PIL import Image
        with Image.open(changed["image"]).convert("RGB") as im:
            self.assertEqual(im.getpixel((100, 50)), (0, 0, 255))

    def test_crop_batch_reuses_single_crop_cache_and_keeps_metadata(self):
        self.confirm()
        single = ps.crop(self.work, "P1", 1, [0, 0, .5, .5], "red", dpi=144)
        before = self.read(single["provenance"])
        tasks = self.batch_file([
            {"paper_id": "P1", "page": 1, "bbox": [0, 0, .5, .5], "name": "red"},
            {"paper_id": "P1", "page": 1, "bbox": [.5, 0, 1, .5], "name": "blue", "dpi": 72},
        ])
        result = ps.crop_batch(self.work, tasks, dpi=144)
        self.assertEqual(result["status"], "cropped")
        self.assertEqual((result["total"], result["completed"], result["rendered"], result["reused"]), (2, 2, 1, 1))
        self.assertEqual(before, self.read(result["items"][0]["provenance"]))
        self.assertEqual(self.read(result["items"][1]["provenance"])["dpi"], 72)
        from PIL import Image
        with Image.open(result["items"][1]["image"]).convert("RGB") as im:
            self.assertEqual(im.size, (100, 50))
            self.assertEqual(im.getpixel((50, 25)), (0, 0, 255))
        self.assertNotIn("renderer", result["items"][0])
        self.assertNotIn("source_sha256", result["items"][0])
        with mock.patch.object(ps, "_render", side_effect=AssertionError("must reuse all crops")):
            repeated = ps.crop_batch(self.work, tasks, dpi=144)
        self.assertEqual((repeated["status"], repeated["reused"]), ("cropped", 2))
        self.assertFalse((self.work / "_work/papers.json").exists())
        self.assertFalse((self.work / "output").exists())

    def test_crop_batch_partial_failure_cli_exit_and_safe_retry(self):
        self.confirm()
        tasks = self.batch_file([
            {"paper_id": "P1", "page": 1, "bbox": [0, 0, .5, .5], "name": "first"},
            {"paper_id": "P1", "page": 1, "bbox": [0, 0, 1, 1], "name": "broken"},
            {"paper_id": "P1", "page": 1, "bbox": [.5, 0, 1, .5], "name": "last"},
        ])
        render = ps._render

        def fail_one(root, target, *args, **kwargs):
            if target.stem == "broken":
                raise ContractError("simulated render failure")
            return render(root, target, *args, **kwargs)

        output = io.StringIO()
        with mock.patch.object(ps, "_render", side_effect=fail_one), \
                mock.patch.object(sys, "argv", ["prepare_sources.py", "crop-batch", "--workdir", str(self.work),
                                               "--items", str(tasks), "--dpi", "144"]), \
                contextlib.redirect_stdout(output):
            code = ps.main()
        result = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual((result["status"], result["completed"]), ("error", 2))
        self.assertEqual(result["items"][1]["item"], 2)
        self.assertEqual(result["items"][1]["name"], "broken")
        self.assertIn("simulated render failure", result["items"][1]["message"])
        self.assertEqual(result["items"][2]["status"], "cropped")
        self.assertEqual(self.read(result["receipt"])["status"], "error")
        retried = ps.crop_batch(self.work, tasks, dpi=144)
        self.assertEqual((retried["status"], retried["rendered"], retried["reused"]), ("cropped", 1, 2))

    def test_crop_batch_rejects_item_errors_without_overwriting_success(self):
        self.confirm()
        valid = {"paper_id": "P1", "page": 1, "bbox": [0, 0, .5, .5], "name": "figure"}
        tasks = self.batch_file([
            valid,
            {**valid, "bbox": [.5, 0, 1, .5]},
            {**valid, "name": "bounds", "bbox": [0, 0, 1.1, 1]},
            {**valid, "name": "page", "page": 2},
            {**valid, "name": "../escape"},
            {**valid, "name": "unknown", "paper_id": "P2"},
            {**valid, "name": "typo", "bBox": [0, 0, 1, 1]},
            {"name": "missing"},
            "not an object",
        ])
        result = ps.crop_batch(self.work, tasks, dpi=144)
        self.assertEqual((result["status"], result["completed"]), ("error", 1))
        self.assertEqual([r["item"] for r in result["items"] if r["status"] == "error"], list(range(2, 10)))
        self.assertIn("重复", result["items"][1]["message"])
        self.assertEqual(self.read(result["items"][0]["provenance"])["bbox"], [0, 0, .5, .5])
        self.assertEqual(sorted(p.name for p in (self.work / "_work/sources/P1/crops").iterdir()),
                         ["figure.json", "figure.png"])

    def test_crop_batch_bad_json_does_not_create_source_outputs(self):
        self.confirm()
        for value in ([], {"items": []}, None):
            with self.subTest(value=value), self.assertRaises(ContractError):
                ps.crop_batch(self.work, self.batch_file(value))
        tasks = self.batch_file([])
        tasks.write_text("[{", encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "JSON"):
            ps.crop_batch(self.work, tasks)
        self.assertFalse((self.work / "_work/sources").exists())

    def test_rotated_and_cropped_page_use_visible_page_coordinates(self):
        self.confirm()
        write_pdf(self.pdf, rotated=True)
        from PIL import Image
        rotated = ps.crop(self.work, "P1", 1, [.5, 0, 1, .5], "rotated", dpi=144)
        with Image.open(rotated["image"]).convert("RGB") as im:
            self.assertEqual(im.size, (100, 200))
            self.assertEqual(im.getpixel((50, 100)), (255, 0, 0))
        write_pdf(self.pdf)
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject
        writer = PdfWriter()
        writer.add_page(PdfReader(self.pdf).pages[0])
        writer.pages[0].cropbox = RectangleObject([50, 0, 200, 100])
        with self.pdf.open("wb") as handle:
            writer.write(handle)
        cropped = ps.crop(self.work, "P1", 1, [0, 0, 1/3, .5], "cropbox", dpi=144)
        with Image.open(cropped["image"]).convert("RGB") as im:
            self.assertEqual(im.size, (100, 100))
            self.assertEqual(im.getpixel((50, 50)), (255, 0, 0))

    def test_renderer_version_change_invalidates_only_preview(self):
        self.confirm()
        ps.prepare(self.work, preview_width=300)
        changed = ps._dependencies()
        changed["version"] = "future-version-for-test"
        with mock.patch.object(ps, "_dependencies", return_value=changed):
            updated = ps.prepare(self.work, preview_width=300)["papers"][0]
        self.assertTrue(updated["text_cache_hit"])
        self.assertEqual(updated["pages_rendered"], 1)

    def test_encrypted_invalid_and_empty_extraction_are_distinguished(self):
        self.confirm()
        write_pdf(self.pdf, encrypted=True)
        encrypted = ps.prepare(self.work)
        self.assertEqual(encrypted["status"], "error")
        self.assertIn("密码", encrypted["errors"][0]["message"])
        self.pdf.write_bytes(b"garbled input")
        invalid = ps.prepare(self.work)
        self.assertIn("无法读取 PDF", invalid["errors"][0]["message"])
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=100)
        with self.pdf.open("wb") as handle:
            writer.write(handle)
        scanned = ps.prepare(self.work, preview_width=300)
        self.assertEqual(scanned["status"], "needs_inspection")
        manifest = self.read(scanned["papers"][0]["manifest"])
        self.assertEqual(manifest["extraction_issues"][0]["issues"][0]["kind"], "no_text")

    def test_symlink_output_escape_is_rejected(self):
        self.confirm()
        outside = self.base / "outside"
        outside.mkdir()
        (self.work / "_work/sources").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ContractError):
            ps.prepare(self.work)
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
