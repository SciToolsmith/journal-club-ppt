"""Contract tests with synthetic blank PDFs and minimal PPTX packages, not visual QA."""
import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from unittest import mock

from pypdf import PdfWriter

SKILL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("workflow", SKILL / "scripts/workflow.py")
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


def package(path, count=1, text="研究问题"):
    p, a, r = workflow.NS["p"], workflow.NS["a"], workflow.NS["r"]
    with ZipFile(path, "w") as z:
        ids = "".join(f'<p:sldId id="{256+i}" r:id="rId{i}"/>' for i in range(1, count + 1))
        z.writestr("ppt/presentation.xml", f'<p:presentation xmlns:p="{p}" xmlns:r="{r}"><p:sldIdLst>{ids}</p:sldIdLst></p:presentation>')
        rels = "".join(f'<Relationship Id="rId{i}" Target="slides/slide{i}.xml"/>' for i in range(1, count + 1))
        z.writestr("ppt/_rels/presentation.xml.rels", f'<Relationships xmlns="{workflow.NS["rel"]}">{rels}</Relationships>')
        for i in range(1, count + 1):
            body = f'<p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>' if text else '<p:pic/>'
            z.writestr(f"ppt/slides/slide{i}.xml", f'<p:sld xmlns:p="{p}" xmlns:a="{a}"><p:cSld><p:spTree>{body}</p:spTree></p:cSld></p:sld>')


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.palette_catalog = self.root / "theme-palettes.json"
        primaries = {"blue": "#32497B", "teal": "#2F6B76", "red": "#AD2C34", "purple": "#671D6F"}
        palettes = {"schema_version": 1, "themes": [{"theme_id": tid, "label": label,
                    "colors": {role: primaries[tid] if role == "primary" else "#FFFFFF"
                               for role in workflow.COLOR_ROLES}}
                    for tid, label in workflow.THEME_LABELS.items()]}
        workflow.save_json(self.palette_catalog, palettes)
        patcher = mock.patch.object(workflow, "THEME_CATALOG", self.palette_catalog)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.pdf = self.root / "paper.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=600, height=800)
        with self.pdf.open("wb") as stream:
            writer.write(stream)
        self.work = self.root / "job"
        workflow.initialize(self.work, [self.pdf])

    def ready(self, confirm_color=True, pages=1):
        workflow.confirm_pages(self.work, pages, "一页" if pages == 1 else f"{pages}页")
        if confirm_color:
            workflow.confirm_theme(self.work, "blue", "蓝色")
        self.papers = {"papers": [{"paper_id": "P1", "pdf_page_count": 1,
            "source_sha256": workflow.sha256(self.pdf), "main_evidence_reviewed": True,
            "main_evidence_ids": [],
            "evidence": [{"evidence_id": "P1:Fig1", "kind": "text", "pdf_page": 1,
                          "locator": "Synthetic fixture, not scientific evidence"}]}]}
        self.plan = {"slides": [{"slide_id": "S01", "layout_id": "paper-info", "title": "研究问题",
            "paper_ids": ["P1"], "evidence_ids": ["P1:Fig1"],
            "claims": [{"text": "测试结构", "provenance": "analysis", "sources": ["P1:Fig1"]}]}]}
        self.save()

    def save(self):
        workflow.save_json(self.work / "_work/papers.json", self.papers)
        workflow.save_json(self.work / "_work/deck-plan.json", self.plan)

    def test_waits_for_answer_before_reading_plan(self):
        with self.assertRaisesRegex(workflow.ContractError, "等待用户回答"):
            workflow.check_plan(self.work)
        self.assertFalse((self.work / "output").exists())

    def test_page_count_requires_actual_recorded_answer(self):
        for count, answer in [(0, "0"), (-1, "-1"), (True, "一页"), (1, " ")]:
            with self.assertRaises(workflow.ContractError):
                workflow.confirm_pages(self.work, count, answer)

    def test_correct_plan_passes(self):
        self.ready()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")

    def test_figure_10_does_not_match_figure_1(self):
        self.ready()
        self.plan["slides"][0]["claims"][0]["sources"] = ["P1:Fig10"]
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "未知证据编号"):
            workflow.check_plan(self.work)

    def test_page_999_rejected_for_one_page_pdf(self):
        self.ready()
        self.papers["papers"][0]["evidence"][0]["pdf_page"] = 999
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "页码越界"):
            workflow.check_plan(self.work)

    def test_source_page_count_and_hash_checked(self):
        self.ready()
        self.papers["papers"][0]["pdf_page_count"] = 999
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "真实 PDF"):
            workflow.check_plan(self.work)
        self.papers["papers"][0]["pdf_page_count"] = 1
        self.papers["papers"][0]["source_sha256"] = "stale"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "散列"):
            workflow.check_plan(self.work)

    def test_claim_cannot_borrow_undeclared_paper(self):
        self.ready()
        self.plan["slides"][0]["paper_ids"] = []
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "不属于"):
            workflow.check_plan(self.work)

    def test_plan_cannot_add_extra_slide(self):
        self.ready()
        self.plan["slides"].append(dict(self.plan["slides"][0], slide_id="S02"))
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "计划页数"):
            workflow.check_plan(self.work)

    def test_pptx_count_native_text_and_placeholders(self):
        path = self.root / "candidate.pptx"
        for count, text in [(2, "研究问题"), (1, ""), (1, "请输入正文")]:
            package(path, count, text)
            with self.assertRaises(workflow.ContractError):
                workflow.inspect_pptx(path, 1)

    def test_only_one_pptx_delivered_after_current_review(self):
        self.ready()
        pptx = self.work / "_work/candidate.pptx"
        package(pptx)
        review = {"pptx_sha256": "old", "slides": [{"slide_id": "S01", "content_checked": True,
                  "layout_checked": True, "editability_checked": True}], "unresolved_errors": []}
        workflow.save_json(self.work / "_work/review.json", review)
        with self.assertRaisesRegex(workflow.ContractError, "旧版本"):
            workflow.finalize(self.work, pptx)
        self.assertFalse((self.work / "output").exists())
        review["pptx_sha256"] = workflow.sha256(pptx)
        review["papers_sha256"] = workflow.sha256(self.work / "_work/papers.json")
        review["deck_plan_sha256"] = workflow.sha256(self.work / "_work/deck-plan.json")
        theme = workflow.get_theme(self.work)
        review.update(theme_id=theme["theme_id"], palette_sha256=theme["palette_sha256"])
        workflow.save_json(self.work / "_work/review.json", review)
        result = workflow.finalize(self.work, pptx)
        self.assertEqual(result["delivery_count"], 1)
        self.assertEqual([p.name for p in (self.work / "output").iterdir()], ["journal-club.pptx"])
        with self.assertRaises(workflow.ContractError):
            workflow.finalize(self.work, pptx)

    def add_source(self, role="primary"):
        extra = self.root / "extra.pdf"
        extra.write_bytes(self.pdf.read_bytes())
        state = workflow.load_json(self.work / "_work/run.json")
        state["inputs"].append({"paper_id": "P2", "path": str(extra)})
        workflow.save_json(self.work / "_work/run.json", state)
        self.papers["papers"].append({"paper_id": "P2", "source_role": role,
            "related_to": "P1", "association_note": "Synthetic association fixture",
            "reading_scope": "Synthetic page inspected",
            "pdf_page_count": 1, "source_sha256": workflow.sha256(extra),
            "main_evidence_reviewed": role == "primary",
            "main_evidence_ids": [],
            "evidence": [{"evidence_id": "P2:Text1", "kind": "text", "pdf_page": 1, "locator": "Fixture"}]})
        self.save()

    def test_each_independent_paper_needs_evidence_in_plan(self):
        self.ready()
        self.add_source()
        self.plan["slides"][0]["paper_ids"].append("P2")
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "遗漏"):
            workflow.check_plan(self.work)
        self.plan["slides"][0]["evidence_ids"].append("P2:Text1")
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")

    def test_supplement_keeps_own_pdf_locator_and_parent(self):
        self.ready()
        self.add_source("supplement")
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.plan["slides"][0]["paper_ids"].append("P2")
        self.plan["slides"][0]["evidence_ids"].append("P2:Text1")
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.papers["papers"][1]["related_to"] = "P999"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "related_to"):
            workflow.check_plan(self.work)

    def test_changed_plan_invalidates_old_review(self):
        self.ready()
        pptx = self.work / "_work/candidate.pptx"
        package(pptx)
        review = {"pptx_sha256": workflow.sha256(pptx),
            "papers_sha256": workflow.sha256(self.work / "_work/papers.json"),
            "deck_plan_sha256": workflow.sha256(self.work / "_work/deck-plan.json"),
            "slides": [{"slide_id": "S01", "content_checked": True,
                        "layout_checked": True, "editability_checked": True}], "unresolved_errors": []}
        workflow.save_json(self.work / "_work/review.json", review)
        self.plan["slides"][0]["claims"][0]["text"] = "新的分析"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "页面计划不一致"):
            workflow.finalize(self.work, pptx)
        self.assertFalse((self.work / "output").exists())

    def test_refuses_work_inside_skill(self):
        with self.assertRaises(workflow.ContractError):
            workflow.workspace(SKILL / "temp-run")

    def test_unused_figure_needs_review_but_not_a_raster(self):
        self.ready()
        paper = self.papers["papers"][0]
        paper["evidence"].append({"evidence_id": "P1:Fig2", "kind": "figure", "pdf_page": 1,
                                  "locator": "Figure 2", "reviewed": False})
        paper["main_evidence_ids"] = ["P1:Fig2"]
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "实际审阅"):
            workflow.check_plan(self.work)
        paper["evidence"][-1]["reviewed"] = True
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.plan["slides"][0]["evidence_ids"].append("P1:Fig2")
        self.plan["slides"][0]["render"] = {"type": "single-figure", "figures": [{"evidence_id": "P1:Fig2"}]}
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "尚未提取"):
            workflow.check_plan(self.work)

    def test_rendered_image_cannot_hide_undeclared_evidence(self):
        self.ready()
        self.plan["slides"][0]["render"] = {"type": "single-figure", "figures": [{"evidence_id": "P1:Fig99"}]}
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "展示图片必须声明"):
            workflow.check_plan(self.work)

    def test_condition_reference_requires_exact_field_and_source(self):
        self.ready()
        self.papers["papers"][0]["experiments"] = [{"experiment_id": "P1:ExpA",
            "sources": ["P1:Fig1"], "values": {"fs": "20 kHz", "n": 2}}]
        self.plan["slides"][0]["render"] = {"type": "text", "body": ["采样率 {{P1:ExpA.fs}}", {"condition_ref": "P1:ExpA.n"}]}
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.plan["slides"][0]["render"]["body"][1]["condition_ref"] = "P1:ExpA.unknown"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "未知实验条件"):
            workflow.check_plan(self.work)
        self.plan["slides"][0]["render"]["body"][1]["condition_ref"] = "P1:ExpA.n"
        self.plan["slides"][0]["evidence_ids"] = []
        self.plan["slides"][0]["claims"] = []
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "须声明其证据"):
            workflow.check_plan(self.work)

    def test_method_update_cannot_silently_disappear(self):
        self.ready()
        paper = self.papers["papers"][0]
        paper["analysis_type"] = "method"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "关键步骤覆盖"):
            workflow.check_plan(self.work)
        paper["method_coverage"] = [{"aspect": aspect, "evidence_ids": ["P1:Fig1"], "slide_ids": ["S01"]}
                                    for aspect in ("inputs", "objective", "update", "outputs", "stopping")]
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        paper["method_coverage"][2]["slide_ids"] = []
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "省略理由"):
            workflow.check_plan(self.work)
        paper["method_coverage"][2]["omission_reason"] = "Synthetic fixture: no distinct iterative solver exists."
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")

    def test_method_evidence_can_be_distributed_across_related_pages(self):
        self.ready(pages=2)
        paper = self.papers["papers"][0]
        paper["analysis_type"] = "method"
        paper["evidence"].append({"evidence_id": "P1:Eq2", "kind": "equation",
                                  "pdf_page": 1, "locator": "Synthetic update equation"})
        self.plan["slides"].append({"slide_id": "S02", "layout_id": "paper-info",
            "title": "第二个求解环节", "paper_ids": ["P1"], "evidence_ids": ["P1:Eq2"],
            "claims": [{"text": "测试第二环节", "provenance": "analysis", "sources": ["P1:Eq2"]}]})
        paper["method_coverage"] = [{"aspect": aspect, "evidence_ids": ["P1:Fig1"], "slide_ids": ["S01"]}
                                    for aspect in ("inputs", "objective", "update", "outputs", "stopping")]
        paper["method_coverage"][2].update(evidence_ids=["P1:Fig1", "P1:Eq2"], slide_ids=["S01", "S02"])
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        paper["method_coverage"][2]["slide_ids"] = ["S01"]
        self.save()
        with self.assertRaises(workflow.ContractError) as error:
            workflow.check_plan(self.work)
        self.assertIn("update", str(error.exception))
        self.assertIn("S01", str(error.exception))
        self.assertIn("P1:Eq2", str(error.exception))
        paper["method_coverage"][2].update(evidence_ids=["P1:Fig1"], slide_ids=["S01", "S02"])
        self.save()
        with self.assertRaises(workflow.ContractError) as error:
            workflow.check_plan(self.work)
        self.assertIn("S02", str(error.exception))
        self.assertIn("未引用", str(error.exception))

    def test_title_and_claim_condition_refs_require_sources(self):
        self.ready()
        paper = self.papers["papers"][0]
        paper["experiments"] = [{"experiment_id": "P1:ExpA", "sources": ["P1:Fig1"],
                                  "values": {"fs": "20 kHz"}}]
        slide = self.plan["slides"][0]
        slide["title"] = "采样率 {{ P1:ExpA.fs }}"
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        slide["title"] = "采样率 {{P1:ExpA.bad}}"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "未知实验条件"):
            workflow.check_plan(self.work)
        slide["title"] = "已声明的实验"
        slide["claims"][0]["text"] = "采样率 {{P1:ExpA.bad}}"
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "未知实验条件"):
            workflow.check_plan(self.work)

    def test_conditions_and_method_allow_associated_supplement_only(self):
        self.ready()
        self.add_source("supplement")
        paper = self.papers["papers"][0]
        paper["experiments"] = [{"experiment_id": "P1:ExpA", "sources": ["P2:Text1"],
                                  "values": {"fs": "20 kHz"}}]
        paper["analysis_type"] = "method"
        paper["method_coverage"] = [{"aspect": a, "evidence_ids": ["P2:Text1"], "slide_ids": ["S01"]}
                                    for a in ("inputs", "objective", "update", "outputs", "stopping")]
        slide = self.plan["slides"][0]
        slide["paper_ids"].append("P2")
        slide["evidence_ids"].append("P2:Text1")
        slide["title"] = "采样率 {{P1:ExpA.fs}}"
        self.save()
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.papers["papers"][1].update(source_role="primary", main_evidence_reviewed=True)
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "实验条件来源须属于同一主文"):
            workflow.check_plan(self.work)
        paper["experiments"][0]["sources"] = ["P1:Fig1"]
        self.save()
        with self.assertRaisesRegex(workflow.ContractError, "方法覆盖来源须属于同一主文"):
            workflow.check_plan(self.work)

    def test_stage_metrics_do_not_change_page_gate_or_review(self):
        with self.assertRaisesRegex(workflow.ContractError, "等待用户回答"):
            workflow.stage(self.work, "analysis", "start")
        self.ready()
        workflow.stage(self.work, "analysis-P1", "start")
        result = workflow.stage(self.work, "analysis-P1", "end")
        self.assertGreaterEqual(result["elapsed_seconds"], 0)
        with self.assertRaises(workflow.ContractError):
            workflow.stage(self.work, "analysis-P1", "start")
        stats = workflow.statistics(self.work)
        self.assertEqual(stats["receipt_count"], 0)
        self.assertEqual(workflow.load_json(self.work / "_work/run.json")["target_slide_count"], 1)
        self.assertFalse((self.work / "_work/review.json").exists())

    def test_new_task_asks_pages_and_four_themes_without_defaults(self):
        state = workflow.load_json(self.work / "_work/run.json")
        self.assertEqual(state["schema_version"], 3)
        self.assertIsNone(state["theme_id"])
        self.assertIsNone(state["theme_user_answer"])
        result = workflow.initialize(self.root / "other", [self.pdf])
        self.assertIn("一共多少页", result["question"])
        self.assertIn("主题色", result["theme_question"])
        self.assertEqual([item["theme_id"] for item in result["theme_options"]], ["blue", "teal", "red", "purple"])
        with self.assertRaisesRegex(workflow.ContractError, "等待用户明确选择"):
            workflow.get_theme(self.work)

    def test_theme_before_pages_does_not_unlock_scientific_work(self):
        chosen = workflow.confirm_theme(self.work, "teal", "青色")
        self.assertEqual(chosen["status"], "awaiting_page_count")
        self.assertEqual(workflow.get_theme(self.work)["theme_id"], "teal")
        with self.assertRaisesRegex(workflow.ContractError, "等待用户回答"):
            workflow.confirmed_state(self.work)
        workflow.confirm_pages(self.work, 15, "15")
        self.assertEqual(workflow.confirmed_state(self.work)[1]["target_slide_count"], 15)
        self.assertEqual(workflow.get_theme(self.work)["theme_id"], "teal")

    def test_pages_before_theme_allow_analysis_but_block_delivery(self):
        self.ready(confirm_color=False)
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        with self.assertRaisesRegex(workflow.ContractError, "等待用户明确选择"):
            workflow.get_theme(self.work)
        with self.assertRaisesRegex(workflow.ContractError, "等待用户明确选择"):
            workflow.finalize(self.work, self.work / "_work/not-made.pptx")
        workflow.confirm_theme(self.work, "purple", "紫色")
        theme = workflow.get_theme(self.work)
        self.assertFalse(theme["legacy_default"])
        self.assertEqual(theme["theme_id"], "purple")

    def test_invalid_theme_or_missing_answer_does_not_mutate_state(self):
        before = workflow.sha256(self.work / "_work/run.json")
        for theme, answer in [("green", "绿色"), ("Blue", "蓝色"), (None, "蓝色"), ("blue", " "), ("blue", None)]:
            with self.subTest(theme=theme, answer=answer), self.assertRaises(workflow.ContractError):
                workflow.confirm_theme(self.work, theme, answer)
        self.assertEqual(before, workflow.sha256(self.work / "_work/run.json"))
        state = workflow.load_json(self.work / "_work/run.json")
        state["theme_id"] = "blue"
        workflow.save_json(self.work / "_work/run.json", state)
        with self.assertRaisesRegex(workflow.ContractError, "真实回答"):
            workflow.get_theme(self.work)

    def test_palette_hash_is_canonical_and_invalid_colors_rejected(self):
        workflow.confirm_theme(self.work, "red", "红色")
        theme = workflow.get_theme(self.work)
        expected = hashlib.sha256(json.dumps(theme["colors"], sort_keys=True,
            separators=(",", ":"), ensure_ascii=True).encode("utf-8")).hexdigest()
        self.assertEqual(theme["palette_sha256"], expected)
        palettes = workflow.load_json(self.palette_catalog)
        selected = next(p for p in palettes["themes"] if p["theme_id"] == "red")
        selected["colors"] = dict(reversed(list(selected["colors"].items())))
        workflow.save_json(self.palette_catalog, palettes)
        self.assertEqual(workflow.get_theme(self.work)["palette_sha256"], expected)
        selected["colors"]["primary"] = "#ad2c34"
        workflow.save_json(self.palette_catalog, palettes)
        with self.assertRaisesRegex(workflow.ContractError, "大写 #RRGGBB"):
            workflow.get_theme(self.work)

    def test_legacy_schema_one_and_two_keep_blue_without_new_review_fields(self):
        self.ready(confirm_color=False)
        for version in (1, 2):
            with self.subTest(schema=version):
                state = workflow.load_json(self.work / "_work/run.json")
                state["schema_version"] = version
                state.pop("theme_id", None)
                state.pop("theme_user_answer", None)
                workflow.save_json(self.work / "_work/run.json", state)
                theme = workflow.get_theme(self.work)
                self.assertTrue(theme["legacy_default"])
                self.assertEqual(theme["theme_id"], "blue")
        pptx = self.work / "_work/legacy.pptx"
        package(pptx)
        review = self.current_review(pptx, include_theme=False)
        workflow.save_json(self.work / "_work/review.json", review)
        self.assertEqual(workflow.finalize(self.work, pptx)["status"], "delivered")

    def current_review(self, pptx, include_theme=True):
        review = {"pptx_sha256": workflow.sha256(pptx),
            "papers_sha256": workflow.sha256(self.work / "_work/papers.json"),
            "deck_plan_sha256": workflow.sha256(self.work / "_work/deck-plan.json"),
            "slides": [{"slide_id": "S01", "content_checked": True,
                        "layout_checked": True, "editability_checked": True}], "unresolved_errors": []}
        if include_theme:
            theme = workflow.get_theme(self.work)
            review.update(theme_id=theme["theme_id"], palette_sha256=theme["palette_sha256"])
        return review

    def test_new_review_requires_matching_theme_and_palette(self):
        self.ready()
        pptx = self.work / "_work/new.pptx"
        package(pptx)
        review = self.current_review(pptx, include_theme=False)
        workflow.save_json(self.work / "_work/review.json", review)
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)
        review = self.current_review(pptx)
        review["palette_sha256"] = "stale"
        workflow.save_json(self.work / "_work/review.json", review)
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)

    def test_legacy_job_with_new_color_choice_requires_matching_review(self):
        self.ready(confirm_color=False)
        state = workflow.load_json(self.work / "_work/run.json")
        state["schema_version"] = 2
        state.pop("theme_id", None)
        state.pop("theme_user_answer", None)
        workflow.save_json(self.work / "_work/run.json", state)
        pptx = self.work / "_work/legacy-recolored.pptx"
        package(pptx)
        review = self.current_review(pptx, include_theme=False)
        workflow.save_json(self.work / "_work/review.json", review)
        workflow.confirm_theme(self.work, "red", "这份旧任务改为红色")
        self.assertEqual(workflow.load_json(self.work / "_work/run.json")["schema_version"], 2)
        self.assertFalse(workflow.get_theme(self.work)["legacy_default"])
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)
        review.update(theme_id="blue", palette_sha256="stale-blue-palette")
        workflow.save_json(self.work / "_work/review.json", review)
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)
        workflow.save_json(self.work / "_work/review.json", self.current_review(pptx))
        self.assertEqual(workflow.finalize(self.work, pptx)["status"], "delivered")

    def test_color_change_preserves_pages_analysis_and_invalidates_review(self):
        self.ready()
        pptx = self.work / "_work/new.pptx"
        package(pptx)
        review = self.current_review(pptx)
        workflow.save_json(self.work / "_work/review.json", review)
        before = {name: workflow.sha256(self.work / "_work" / name)
                  for name in ("papers.json", "deck-plan.json", "review.json")}
        workflow.confirm_theme(self.work, "red", "改用红色")
        state = workflow.load_json(self.work / "_work/run.json")
        self.assertEqual(state["target_slide_count"], 1)
        self.assertEqual(state["user_answer"], "一页")
        self.assertEqual(state["theme_user_answer"], "改用红色")
        self.assertEqual(state["status"], "page_count_confirmed")
        self.assertEqual(workflow.check_plan(self.work)["status"], "pass")
        self.assertEqual(before, {name: workflow.sha256(self.work / "_work" / name) for name in before})
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)
        workflow.save_json(self.work / "_work/review.json", self.current_review(pptx))
        self.assertEqual(workflow.finalize(self.work, pptx)["status"], "delivered")
        with self.assertRaisesRegex(workflow.ContractError, "任务已交付"):
            workflow.confirm_theme(self.work, "purple", "紫色")

    def test_palette_revision_invalidates_review_even_when_theme_id_stays_same(self):
        self.ready()
        pptx = self.work / "_work/new.pptx"
        package(pptx)
        workflow.save_json(self.work / "_work/review.json", self.current_review(pptx))
        palettes = workflow.load_json(self.palette_catalog)
        palettes["themes"][0]["colors"]["rule"] = "#123456"
        workflow.save_json(self.palette_catalog, palettes)
        with self.assertRaisesRegex(workflow.ContractError, "当前主题色或配色散列不一致"):
            workflow.finalize(self.work, pptx)

    def test_theme_cli_supports_choice_and_rejects_missing_or_invalid_choice(self):
        cli = [sys.executable, str(SKILL / "scripts/workflow.py")]
        confirmed = subprocess.run(cli + ["confirm-theme", "--workdir", str(self.work),
            "--theme", "teal", "--user-answer", "青色"], text=True, capture_output=True)
        self.assertEqual(confirmed.returncode, 0, confirmed.stderr)
        self.assertEqual(json.loads(confirmed.stdout)["theme_id"], "teal")
        resolved = subprocess.run(cli + ["get-theme", "--workdir", str(self.work)],
                                  text=True, capture_output=True)
        self.assertEqual(resolved.returncode, 0, resolved.stderr)
        self.assertEqual(json.loads(resolved.stdout)["theme_id"], "teal")
        self.assertFalse(json.loads(resolved.stdout)["legacy_default"])
        for options in (["--theme", "green", "--user-answer", "绿色"],
                        ["--theme", "blue"], ["--user-answer", "蓝色"]):
            rejected = subprocess.run(cli + ["confirm-theme", "--workdir", str(self.work)] + options,
                                      text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)


if __name__ == "__main__":
    unittest.main()
