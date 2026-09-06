# 内部数据契约

本文件是内部记录、来源关联与复核字段的权威定义；组件专有 `render` 字段见 [build-api.md](build-api.md)。按阶段读取：分析时看“任务状态”和“来源记录”，规划时看“逐页计划”，交付时看“最终复核”；无需每阶段重读全部示例。

文件写入任务目录，不写入技能目录或作为用户交付物：

```text
<任务目录>/
├── _work/
│   ├── run.json
│   ├── papers.json
│   ├── deck-plan.json
│   ├── review.json
│   ├── figures/
│   └── previews/
└── output/
    └── journal-club.pptx
```

## 任务状态

`init` 创建 `schema_version: 3`，记录输入路径和等待状态，`theme_id`、`theme_user_answer` 初始为空。`confirm-pages` 保存用户真实回答和正整数 `target_slide_count` 后才允许处理论文及检查计划。命令不负责对话；代理按 [SKILL.md](../SKILL.md) 取得页数和颜色回答，已答项不重复问，缺项不默认。页数已答可先阅读和规划，排版导出前须记录颜色：

```text
python <skill>/scripts/workflow.py confirm-theme --workdir <任务目录> --theme <blue|teal|red|purple> --user-answer <真实回答>
python <skill>/scripts/workflow.py get-theme --workdir <任务目录>
```

`confirm-theme` 保存上述主题字段。`get-theme` 从 `assets/theme-palettes.json` 返回 `theme_id`、`theme_label`、`colors`、`palette_sha256`、`legacy_default`；散列为 `colors` 按键排序的紧凑 JSON（无空格）的 SHA-256。制作器读取结果，不另传主题。schema 1/2 从未显式选色的旧任务仅兼容蓝色并返回 `legacy_default: true`；新任务不能降低 schema 绕过选色。旧任务一旦显式选色也须绑定主题复核，无需升级 schema。主题变更后的复核规则见“最终复核”。

## 来源记录：papers.json

以下示例只说明字段，不代表实际证据或完整清单：

```json
{
  "papers": [{
    "paper_id": "P1",
    "source_role": "primary",
    "pdf_page_count": 12,
    "source_sha256": "实际PDF的SHA256",
    "main_evidence_reviewed": true,
    "main_evidence_ids": ["P1:Fig2b"],
    "evidence": [{
      "evidence_id": "P1:Fig2b",
      "kind": "figure",
      "pdf_page": 5,
      "locator": "Figure 2b",
      "reviewed": true,
      "source_excerpt": "用于复核的简短原文或图注",
      "asset_path": "_work/figures/P1-Fig2b.png"
    }]
  }]
}
```

- `paper_id` 是 init 按输入顺序分配的稳定文件来源编号 P1、P2 等；`papers` 与 PDF 一一对应，不因补充或重复而删除、合并、重编号。`pdf_page_count`、`source_sha256` 必须与实际文件一致，检查器用 pypdf 与 SHA-256 核实。
- `source_role` 默认 `primary`（主文），另可为 `supplement`（补充）或 `duplicate`（重复）。非 primary 须以 `related_to` 指向 primary，并用非空 `association_note`、`reading_scope` 记录可核实的关联依据及实际阅读范围。duplicate 仅指与关联主文完全同字节的文件；不同主文修订版保留独立 primary，说明版本关系。
- `evidence_id` 在任务内唯一，前缀是证据实际所在 PDF 的 `paper_id`；补充图仍记为 `P2:FigS1`，不能归成 P1 的证据。所有引用精确匹配，`P1:Fig1` 与 `P1:Fig10` 不同。
- `kind` 为 `figure`、`table`、`equation` 或 `text`。`pdf_page` 是从 1 开始的文件页序，未知可为 null，但 `locator` 须保留可靠章节/图号；印刷页码可另存，不混用。
- 仅实际展示的图片必须有相对任务目录的 `asset_path`；未展示图可只留定位与审阅记录。原生重建表格须保存可复核数据。
- 每个 primary 的 `main_evidence_reviewed` 必须为 true，且只能在全部正文主图主表实际审阅后填写；schema 2/3 另必填完整、不重复的 `main_evidence_ids`，对应 evidence 项须为该主文的 figure/table 并设 `reviewed: true`，无主图表则填空列表。旧版兼容不能用于跳过新任务要求。supplement、duplicate 可为 false，但 `reading_scope` 须如实反映按需阅读或仅核对字节一致；清单完整性与实际可读性由代理判断。

可按需增加术语、图注、统计条件、单位等科学记录。`observation`、`supports` 均非强制字段；同义内容写一次即可，只有观察与推断确有区别时才分开。原文摘录只留核验所需片段，证据支持范围仍须清楚。裁图元数据保留在工具生成的同名 JSON sidecar，证据记录引用其相对路径即可，不复制 `crop_metadata` 大对象；生成和来源失效规则见 [source-preparation.md](source-preparation.md)。字段或文件存在不能证明科学判断正确。

### 实验条件与方法覆盖

下列字段属于各自 paper 对象，引用必须真实存在：

```json
{
  "experiments": [{
    "experiment_id": "P1:ExpA",
    "sources": ["P1:Setup"],
    "values": {"sample_count": 120, "duration": "30 min"}
  }],
  "analysis_type": "method",
  "method_coverage": [
    {"aspect": "inputs", "evidence_ids": ["P1:Setup"], "slide_ids": ["S03"]},
    {"aspect": "objective", "evidence_ids": ["P1:Eq4"], "slide_ids": ["S04"]},
    {"aspect": "update", "evidence_ids": ["P1:Eq8"], "slide_ids": ["S04"]},
    {"aspect": "outputs", "evidence_ids": ["P1:Flow"], "slide_ids": ["S03"]},
    {"aspect": "stopping", "evidence_ids": ["P1:Flow"], "slide_ids": ["S03"]}
  ]
}
```

`experiments` 可省略。使用时，`experiment_id` 在任务内唯一、以所属 paper_id 为前缀且不含点；非空 `values` 的键只用字母、数字、下划线或连字符，值为短字符串或数值（非布尔），不存代码。数字尽量连同单位保存，不合并不同实验的同名条件。

`experiments.sources`、`method_coverage.evidence_ids` 均须非空且来自同一主文及已声明关联的补充/重复材料；跨论文比较分别引用各篇记录，不能把另一独立主文的参数或方法登记到本篇。

方法、算法、系统论文分别将 `analysis_type` 设为 `method`、`algorithm`、`system`，`method_coverage` 须完整且不重复地覆盖示例中的 5 个 aspect；主动填写该记录也遵循此结构。展示环节以 `slide_ids` 关联真实页面：每页至少引用该 aspect 的一条证据，所有关联页合起来覆盖其全部 `evidence_ids`，无需每页重复引用全套。未展示环节用非空 `omission_reason` 说明取舍或不适用原因。这不强制增加页面、公式或证明，但禁止无关页充数、遗漏关键证据或无声省略环节。

## 逐页计划：deck-plan.json

```json
{
  "slides": [{
    "slide_id": "S01",
    "layout_id": "paper-info",
    "title": "论文题名",
    "paper_ids": ["P1"],
    "evidence_ids": ["P1:Fig2b"],
    "claims": [{
      "text": "依据原文填写的结论",
      "provenance": "paper",
      "sources": ["P1:Fig2b"]
    }]
  }]
}
```

- `slides` 数量等于确认总页数，`slide_id` 唯一，`title` 非空。`layout_id` 来自版式索引；必要新布局用 `derived:` 前缀和非空 `layout_reason` 说明原版为何不适用，遵循模板风格并视觉检查。
- `paper_ids`、`evidence_ids`、`claims.sources` 精确关联来源。引用 supplement/duplicate 时，`paper_ids` 同时包含该来源及其 `related_to` 主文。
- 每个 primary 至少有一个自身 `evidence_id` 进入页面的 `evidence_ids` 或 `claims.sources`；只挂论文名或仅引用补充材料不满足覆盖。补充/重复不要求独立展示。检查器核验引用，代理判断是否构成实质介绍。
- `claims` 完整记录页面实质陈述，`provenance` 为 `paper`、`analysis` 或 `hypothesis`；后两者也须关联原文依据并在文案中区分。封面、目录、结束页通常可为空，但内容页不能将科学陈述藏在标题或正文中回避记录。
- 组件构建使用 `render`，字段见 [build-api.md](build-api.md)。无 render 的旧计划可检查和手动制作；自定义页面同样保持来源声明。`render.figures` 中的 evidence_id 须在本页已声明证据内并有 asset_path，引用但不上屏的图不要求图片。
- 条件引用可写 `持续时间 {{P1:ExpA.duration}}` 或仅含一个字段的对象 `{"condition_ref":"P1:ExpA.duration"}`。双括号内首尾空格会去除，对象值精确匹配；标题、claims 与 render 中的引用均须命中实验字段。本页同时声明条件所属论文及全部 `experiments.sources`，脚本不执行字符串表达式。render 不取代 claims 和证据关联。

### 栏目导航：navigation

新计划在顶层填写 `navigation`，内容页用 `section_id` 关联，`title` 只写具体主题。以下为局部示例，其余来源字段仍需填写：

```json
{
  "navigation": {
    "mode": "single",
    "groups": [{
      "group_id": "paper-one",
      "paper_ids": ["P1"],
      "sections": [
        {"section_id": "p1-method", "label": "方法原理与求解"},
        {"section_id": "p1-results", "label": "结果与分析"}
      ]
    }]
  },
  "slides": [
    {"slide_id": "S03", "section_id": "p1-method", "title": "核心参数如何更新"},
    {"slide_id": "S04", "section_id": "p1-results", "title": "主要对照中的结果差异"},
    {"slide_id": "S05", "section_id": "p1-results", "title": "条件变化下的适用边界"}
  ]
}
```

两张结果页均显示 `2 结果与分析`。编号由 `resolveNavigation(plan, papers)` 生成，不写入 `label` 或 `title`。

| mode | groups 要求 | 自动编号 |
|---|---|---|
| `single` | 一篇 primary，一个组包含该主文 | 1、2、3…… |
| `by-paper` | 至少两篇 primary；按汇报顺序，每篇恰好一个单主文组；可加包含全部主文的末尾综合组 | 1.1、1.2、2.1……；综合组 N+1.x |
| `by-theme` | 至少两篇 primary；一个组包含全部主文，sections 为证据主题 | 1、2、3…… |

`group_id`、`section_id` 各自在计划内唯一，均为无首尾空白的非空字符串；`label` 是不带编号的非空短栏目名。组内 `paper_ids` 只列主文。每个内容页（`render.type` 非 cover/agenda/closing）须引用已声明的 section_id，paper_ids 至少包含所属组的一篇主文；跨篇页可另列参与来源。封面、目录、结束页不能填 section_id，真实证据归属仍逐项检查。

组和栏目按声明顺序使用，可连续复用，不能倒序或留下未使用栏目；调整顺序同步 groups/sections。旧计划同时缺少 navigation 和所有 section_id 时保留旧标题行为，不能只填 section_id 漏掉导航定义；新计划不用兼容方式绕过导航。

### 单篇、多篇与末页

新计划默认以 `render: {"type":"closing"}` 为唯一末页，呈现模板结束语，claims/evidence_ids 可为空；总结讨论仍在此前的正文中，结束页计入总页数。

按 primary 篇数确定目录：单篇无目录，多篇在封面后放一页 `render.type: "agenda"`。`render.items` 含 `label`、`paper_ids`、`target_slide_id`，目标指向后续实际内容页，起始页号由程序计算。目录须覆盖各独立主文，不能代替正文证据；by-theme 的一个目录主题可连续几页分别讲各篇，不要求首张页同时出现全部论文。区间来源校验和容量见 build-api。

仅用户明确要求其他结构或一两页极短提要等具体情形，可在顶层 `structure_overrides` 对 `agenda`、`closing` 分别写非空原因，例如 `{"closing":"用户明确要求仅一页内容提要，不设结束页"}`；不能以省时为理由。构建器检查默认结构、已有目录目标及末页位置，不自行加页。旧任务检查与既有交付保持兼容。

## 最终复核：review.json

```json
{
  "pptx_sha256": "实际检查过的PPTX的SHA256",
  "papers_sha256": "实际检查过的papers.json的SHA256",
  "deck_plan_sha256": "实际检查过的deck-plan.json的SHA256",
  "theme_id": "purple",
  "palette_sha256": "实际检查过的主题colors对象的SHA256",
  "slides": [{
    "slide_id": "S01",
    "content_checked": true,
    "layout_checked": true,
    "editability_checked": true
  }],
  "unresolved_errors": []
}
```

按 [quality-check.md](quality-check.md) 实际逐页检查后填写，不能预填全部 true。记录按计划顺序覆盖每页，三个散列分别绑定实际复核的 PPTX、`_work/papers.json`、`_work/deck-plan.json`。schema 3 及显式选色的旧任务另保存本次 get-theme 的 `theme_id`、`palette_sha256`；示例紫色不是默认。

文件改动后复核受影响内容及页面，不能只换散列；仅确实未受影响的结论可沿用。改色或配色表变化后重新制作并实际查看全部导出页，未变科学分析可复用。

`check-plan` 返回的 paper_count 是 primary 篇数、source_count 是全部输入数；`check-pptx` 核对页数、原生文本与明显占位文字，两者不证明科学或视觉质量。`finalize` 重新检查计划、PPTX、三个文件散列和适用主题绑定，复制同一 PPTX 到空的 output 目录，不打包内部材料或覆盖既有交付。

## 预处理、构建和耗时回执

`_work/sources/<paper_id>/` 保存可复用文本、索引、预览、按需裁图及来源清单；`_work/receipts/` 保存预处理/构建耗时、缓存、渲染数量及散列。具体字段见对应工具说明，文件生成不表示完成科学分析。

可选测量分析、规划或修订阶段：

```text
python <skill>/scripts/workflow.py stage --workdir <任务目录> --name analysis-P1 --event start
python <skill>/scripts/workflow.py stage --workdir <任务目录> --name analysis-P1 --event end
python <skill>/scripts/workflow.py stats --workdir <任务目录>
```

测量名不覆盖，复测换新名。stats 将回执路径和手动阶段汇总到 run.json；并行阶段不能相加为总耗时，也不推算 token 或以时间短证明质量高。
