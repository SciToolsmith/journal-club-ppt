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

`init` 创建 `schema_version: 4`，记录输入路径、等待状态与可选的 `report_timezone`（IANA 时区），回执只返回页数问题。`theme_id`、`theme_user_answer`、`presenter_name`、`presenter_user_answer` 初始为空，`presenter_omitted` 不代表已获省略授权。`confirm-pages` 保存用户真实回答和正整数 `target_slide_count` 后才允许处理论文及检查计划。命令不负责对话；代理按 [SKILL.md](../SKILL.md) 的页数、颜色、汇报人顺序，每次只询问一项缺失信息，收到真实回答后再问下一项。已提供项直接记录并跳过，用户主动一次提供多项时全部接受，缺项不默认。确认命令不强制提交顺序，便于记录用户已提供的信息。页数已答可先阅读和规划，排版导出前须记录颜色与汇报人：

```text
python <skill>/scripts/workflow.py confirm-theme --workdir <任务目录> --theme <blue|teal|red|purple> --user-answer <真实回答>
python <skill>/scripts/workflow.py get-theme --workdir <任务目录>
python <skill>/scripts/workflow.py confirm-presenter --workdir <任务目录> --name <真实姓名或称呼> --user-answer <真实回答>
python <skill>/scripts/workflow.py get-report --workdir <任务目录>
```

`confirm-theme` 保存上述主题字段。`get-theme` 从 `assets/theme-palettes.json` 返回 `theme_id`、`theme_label`、`colors`、`palette_sha256`、`legacy_default`；散列为 `colors` 按键排序的紧凑 JSON（无空格）的 SHA-256。制作器读取结果，不另传主题。schema 1/2 从未显式选色的旧任务仅兼容蓝色并返回 `legacy_default: true`；新任务不能降低 schema 绕过选色。旧任务一旦显式选色也须绑定主题复核，无需升级 schema。主题变更后的复核规则见“最终复核”。

`confirm-presenter` 将原话、真实称呼和显式省略状态写入任务。用户明确回复“不显示”时以 `--omit` 替代 `--name`；未回答不等价于省略。`get-report` 返回 `presenter_name`、`presenter_omitted`、`report_date` 和 `report_timezone`。日期在调用当天按记录时区计算，格式 `YYYY.MM.DD`；未指定时区时使用本机本地日期。生成器同时把这一份 report 用于封面、结束页和制作回执，不把发表日期用作汇报日期。再次生成时取新的当天日期，已生成文件隔天验收时不因此变更其生成日期。

schema 1–3 的旧任务继续兼容原有行为；新任务使用 schema 4 和 `navigation.profile: "group-meeting"`，不得降低 schema 或删去 profile 来省略汇报人确认、文献信息或分篇结构。更新技能本身不触发姓名提问，提问只属于新建/按新规范重制汇报的入口。

## 来源记录：papers.json

以下示例只说明字段，不代表实际证据或完整清单：

```json
{
  "papers": [{
    "paper_id": "P1",
    "source_role": "primary",
    "pdf_page_count": 12,
    "source_sha256": "实际PDF的SHA256",
    "main_evidence_screened": true,
    "main_evidence_ids": ["P1:Fig2b"],
    "evidence": [{
      "evidence_id": "P1:Fig2b",
      "kind": "figure",
      "pdf_page": 5,
      "locator": "Figure 2b",
      "review_level": "verified",
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
- 仅实际展示的图片必须有相对任务目录的 `asset_path`；未展示图可只留定位与阅读层级。公式裁图仍为 `kind: equation`，使用相同图片与 sidecar 机制，不改记成 figure。原生重建表格须保存可复核数据。
- 新任务在全部主图主表完成浏览筛查后填写 `main_evidence_screened: true`，并保留完整、不重复的 `main_evidence_ids`；清单项属于该主文的 figure/table，无主图表则填空列表。每项 `review_level` 为 `screened`（看过实际内容和图注并判断作用）或 `verified`（已核实相关结果、条件和边界）。不得自动预填，不能把仅浏览写成 verified。
- 进入页面 `evidence_ids`、`claims.sources` 或 `render.figures` 的 figure/table/equation 必须为 verified；未上屏但会改变主要结论的证据也须核验。其他次要图可以仅 screened，text 仍按来源与陈述关联核对。采用新分层的主文，其关联补充/重复材料中被引用的图表和公式遵循同一要求。
- 兼容旧记录：`reviewed: true` 等价于 verified；`main_evidence_reviewed: true` 仍要求全主图 verified。纯旧记录缺少新层级时按原规则处理，新任务使用上述分层字段；显式 screened 或 reviewed=false 的图表/公式不能当作已核验依据。新旧状态矛盾时拒绝。清单完整性、阅读深度和实际可读性仍由代理判断。

通常按整幅图/表登记，在 locator 中注明子图；独立裁图或分别引用确有需要时再拆条目。次要、未展示且不改变解释的图表只需 kind、定位和 screened 状态；关键证据及影响结论的负例还须 verified 及结果、条件与解释边界，不为所有子图逐一写详细分析。

可按需增加术语、图注、统计条件、单位等科学记录。`observation`、`supports` 均非强制字段；同义内容写一次即可，只有观察与推断确有区别时才分开。原文摘录只留核验所需片段，证据支持范围仍须清楚。裁图元数据保留在工具生成的同名 JSON sidecar，证据记录引用其相对路径即可，不复制 `crop_metadata` 大对象；生成和来源失效规则见 [source-preparation.md](source-preparation.md)。字段或文件存在不能证明科学判断正确。

### 可选的实验条件与方法覆盖

下列字段属于各自 paper 对象。普通组会不必填写 method_coverage；仅方法精读、复现或确有必要的细查使用。字段一旦显式提供，引用必须真实存在：

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

`analysis_type` 可用 `method`、`algorithm`、`system` 等记录论文类型，但不触发额外表格。普通组会直接省略 `method_coverage` 字段（不是填写 null 或空数组），沿用页面 claims/evidence 关联即可。确需使用时完整、不重复地记录示例的 5 个 aspect，旧格式保持兼容。展示环节以 `slide_ids` 关联真实页面：每页至少引用该 aspect 的一条证据，各关联页合计覆盖其 evidence_ids，无需每页重复全套。未展示环节用非空 `omission_reason` 说明具体取舍；应用/概览汇报可省推导、简述停止条件，方法精读保留关键求解。该记录不强制五方面各占页面或同等深讲，也不能省去理解主要贡献必需的环节。

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
- `claims` 按可核验论点完整记录页面实质陈述，不逐句复制标题、正文、图注。同一证据支持且性质相同的相关陈述可合为一项；来源性质或适用边界不同仍须分开。`provenance` 为 `paper`、`analysis` 或 `hypothesis`；后两者须关联原文依据并在文案中区分。封面、目录、结束页通常可为空，内容页不能把科学陈述藏在标题或正文中回避记录。
- 组件构建使用 `render`，字段见 [build-api.md](build-api.md)。无 render 的旧计划可检查和手动制作；自定义页面同样保持来源声明。`render.figures` 中的 evidence_id 须在本页已声明证据内并有 asset_path，引用但不上屏的图不要求图片。
- 条件引用可写 `持续时间 {{P1:ExpA.duration}}` 或仅含一个字段的对象 `{"condition_ref":"P1:ExpA.duration"}`。双括号内首尾空格会去除，对象值精确匹配；标题、claims 与 render 中的引用均须命中实验字段。本页同时声明条件所属论文及全部 `experiments.sources`，脚本不执行字符串表达式。render 不取代 claims 和证据关联。

### 栏目导航：navigation

新计划顶层填写 `navigation.profile: "group-meeting"`，内容页以 `section_id` 关联。每篇第一个 section 的 `role` 必须为 `paper_info`、`label` 必须为“文献基本信息”；第一张正文必须采用 `render.type: "paper-info"`，不能只在封面、目录或过渡页出现论文名。以下为局部示例，省略的来源字段与其他页面仍需填写：

```json
{
  "navigation": {
    "profile": "group-meeting",
    "mode": "single",
    "groups": [{
      "group_id": "paper-one",
      "label": "第一篇论文的中文短题名",
      "paper_ids": ["P1"],
      "sections": [
        {"section_id": "p1-info", "role": "paper_info", "label": "文献基本信息"},
        {"section_id": "p1-background", "role": "background", "label": "研究背景与核心问题"},
        {"section_id": "p1-method", "role": "methods", "label": "研究思路与方法"},
        {"section_id": "p1-results", "role": "findings", "label": "主要结果与分析"},
        {"section_id": "p1-discussion", "role": "appraisal", "covers": ["implications"], "label": "总结与讨论"}
      ]
    }]
  },
  "slides": [
    {"slide_id": "S01", "title": "组会汇报", "render": {"type": "cover"}},
    {"slide_id": "S02", "section_id": "p1-info", "title": "论文概况", "render": {"type": "paper-info", "summary": "据原文概括研究内容", "keywords": ["据原文提炼的关键词"]}},
    {"slide_id": "S05", "section_id": "p1-results", "title": "关键对照的主要发现"},
    {"slide_id": "S06", "section_id": "p1-results", "title": "不同条件下的适用边界"}
  ]
}
```

`role` 表达汇报功能，`label` 是观众看到的短小节名；默认与备选见 [slide-planning.md](slide-planning.md)。使用六种基本 role 或可选扩展 role，必要的 `custom` 须有非空 `reason`。合并功能时用 `covers` 列出额外 role；文献信息始终独立，不可藏入其他小节。六项是默认覆盖功能，不强制六张页面或所有小节相同页数。

| mode | 新 profile 的 groups 要求 | 自动编号 |
|---|---|---|
| `single` | 一篇 primary，一个组包含该主文 | 1.1、1.2、1.3…… |
| `by-paper` | 按汇报顺序，每篇恰好一个单主文组；可加包含全部主文的末尾综合组 | 1.1、1.2、2.1……；综合组 N+1.x |

`group_id`、`section_id` 各自在计划内唯一；`group.label` 是目录与过渡页的短题名，`section.label` 不含手写编号。组内 paper_ids 只列主文。内容页引用本篇及关联补充来源，不能把别篇正文穿插到本篇组中；综合组可同时引用各篇。真实证据归属仍逐项检查。编号由程序按实际组/小节顺序生成，与稳定来源编号 P1/P2 无关。

栏目按声明顺序使用，连续页可复用同一 section，不可倒序或留下未使用栏目。封面、目录、章节过渡和结束页不能填 section_id。`section-divider` 以 `render.group_id` 关联章节，不能把它登记为正文小节。完整信息页之后还须有本篇的实质内容及自身证据，书目信息与目录声明不能替代正文汇报。

无 profile 的旧计划保持历史导航兼容：single/by-theme 用 1、2……，by-paper 用 n.x；新计划不用旧方式绕过组会结构。

### 单篇、多篇与固定页面

新 profile 的封面唯一且在首页，`title: "组会汇报"`、`render: {"type":"cover"}`；署名与日期来自任务 report，render 不手填其他题名/引文。末页 `render: {"type":"closing"}` 显示固定中文结束语和相同署名日期，claims/evidence_ids 为空；总结讨论属于此前正文。固定封面、过渡和结束页不承载科学论点。

单篇无目录或过渡页，封面后直接进入文献信息。多篇在封面后设一页 agenda，然后依照 groups 每组一张章节过渡页：

```json
{"slide_id":"S03", "title":"第一篇短题名", "paper_ids":["P1"], "evidence_ids":[], "claims":[],
 "layout_id":"derived:section-divider", "layout_reason":"复用K105章节过渡设计", "render":{"type":"section-divider", "group_id":"paper-one"}}
```

每个过渡页后紧接对应的第一张正文（各篇为 paper-info，综合组为综合正文），高亮当前章节。多篇 agenda.items 的 `label` 与 group.label 一致，`paper_ids` 与组一致，`target_slide_id` 指向对应的 section-divider，顺序与 groups 一致，覆盖全部篇目和已安排的综合章节。实际起始页号自动计算。目录与过渡页都不能漏篇或夹带论文证据。

默认结构不通过脚本自动补页。仅用户明确要求其他结构时沿用 `structure_overrides` 对 `agenda`、`closing` 写非空原因；已有目录与结束页仍接受顺序及内容检查。用户要求极短提要且无法容纳本技能固定结构时先说明具体冲突，不用自行写 override 消除必需的信息页。旧任务与既有交付保持兼容。

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

按 [quality-check.md](quality-check.md) 完成核验及逐页版面检查后填写，不能预填。content_checked 可基于此前已核实、未变化的陈述，不要求在视觉检查时重读原文；layout_checked 须实际查看每页，复杂或修改页重点检查。editability_checked 按当前用户要求核对：默认文字/表格/简单流程原生可编辑，复杂原文公式及示意图可为独立可替换图片，不声称图片内部逐元素可编辑。记录按计划覆盖每页；三个散列分别绑定 PPTX、papers.json、deck-plan.json，并保存当前 theme_id、palette_sha256。

review 只需契约字段；额外备注仅记录实际问题、修正及沿用依据，不为每页重复相同的通过说明或重新抄写原生对象统计。文件改动后复核受影响内容及页面，不能只换散列；仅确实未受影响的结论可沿用。改色或配色表变化后重新制作并实际查看全部导出页，未变科学分析可复用。

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
