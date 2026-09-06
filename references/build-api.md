# 固定制作入口

常规制作先读本节、`render 字段`中的所用类型及`最终检查`。多篇目录、实验条件引用、自定义页面和模板维护各节仅在用到时读取；无需展开完整模板目录或脚本源码。

阅读并确认来源、页数与主题色后，模型只编写 `papers.json` 和 `deck-plan.json` 的内容。普通版式使用本脚本，避免每次重写字体、几何、页码、图像适配和备注。特殊科研页面仍可编写自定义模块。

先按当前 Presentations 的 implementation 执行一次 authoring marker。通过 `load_workspace_dependencies` 定位并设置 `RUNTIME_NODE`、`RUNTIME_NODE_MODULES`、`RUNTIME_PYTHON`，不要复制其他机器的运行时路径。选择已经核实存在的中文字体；当前干净版式验证字体为 `Source Han Sans CN`。`SKILL_ROOT` 是当前 journal-club-ppt 目录，`TASK_DIR` 是已完成页数与主题色确认的任务目录。

```bash
"$RUNTIME_NODE" "$SKILL_ROOT/scripts/build_deck.mjs" \
  --workdir "$TASK_DIR" --font 'Source Han Sans CN' \
  --out _work/build/revision-1.pptx --preview representative
```

默认不渲染草稿。首轮显式使用 `--preview representative`：按实际组件类型选代表页，单图有/无正文分别覆盖，自定义页逐页覆盖，并补入 `layout_diagnostics` 标记的空白风险页。它不判断科学重要性或全部构图问题，仍需补查独特或密集页。`--preview` 也接受 `none`、`all` 或逗号分隔的1起始页号，局部修订只选受影响页。`--scale` 默认为1.25。`--workdir` 自动规范为绝对路径；`--out` 仅允许 `_work` 内的新文件，不覆盖已有稿件。运行时可由环境变量或 `--runtime-node-modules ABS`、`--python ABS` 显式提供。

任务主题通过 `workflow.py confirm-theme --workdir "$TASK_DIR" --theme <blue|teal|red|purple> --user-answer <真实回答>` 记录。构建器从任务状态及 `assets/theme-palettes.json` 读取配色，不接受手写任务级 `--theme`。`get-theme --workdir "$TASK_DIR"` 返回主题、颜色及散列；新任务缺少颜色回答时停止制作，schema 1/2 从未显式选色的旧任务仅兼容蓝色。主题统一作用于全部原生版式组件和自定义对象，科研图始终保留原始颜色。

脚本先执行 `workflow.py check-plan`，再严格按用户页数生成草稿。缺失 `render`、不支持的字段、未知条件引用、过长文案、失配表格或未提取的入选图会报错，不自动补写、删减、缩小文字或增加页面。容量检查只是提前发现明显溢出，不能证明实际版面无误。

## render 字段

每页仍必须填写契约要求的 `title`、`paper_ids`、`evidence_ids`、`claims` 和 `layout_id`。`render` 只负责表现，不替代来源声明或主图表审阅。结构不完全适合旧模板版式时使用带理由的 `derived:` 版式编号。

正文栏目定义见 [data-contract.md](data-contract.md#栏目导航navigation)。新计划填写顶层 `navigation` 和正文页的 `section_id`，构建器先校验分组、实际顺序与栏目归属，再生成左上“编号＋栏目名”；`title` 显示为页内具体主题。封面、目录、结束页保持各自布局。同栏目连续页共用栏目号，无需手填编号或重复把 `title` 放入 `subtitle`。旧计划无导航字段时沿用原标题位置。

有导航时，具体主题位于 x64/y101，字号26px、单行标题区高42px；正文通常从 y160 开始。内容容量不足时调整内容或使用自定义页，不能缩字、删掉必要说明或取消具体主题来勉强通过。方法组件单独调整步骤与说明位置，仍保留输入、步骤说明、停止条件和输出。

| `type` | 内容字段 | 用途 |
|---|---|---|
| `cover` | `subtitle?`、`body?` | 主色横带中放题名和研究主题，横带下方放必要论文信息；横带上方不加眉题 |
| `text` / `summary` | `subtitle?`、`body?`、`takeaway?` | 可编辑正文或结论，body 为字符串或字符串数组 |
| `explanation` | `sections`、`takeaway?` | 2–4组有语义标题的短说明，原生左标题右正文，分隔线保持平面布局 |
| `single-figure` | `figures`、`body?`、`takeaway?` | 恰好一张图；有 body 时左图右文，无 body 时整宽图 |
| `two-figures` | `figures`、`takeaway?` | 恰好两张图，各自配 caption，不接受公共 body |
| `table` | `table`、`subtitle?`、`body?`、`takeaway?` | 原生可编辑表格 |
| `methods` | `steps`、`input?`、`stop?`、`output?` | 2–4个原生步骤与正向连接线 |
| `agenda` | `items` | 多篇论文目录，按最终计划自动计算起始页号 |
| `closing` | 只接受 `type` | 固定结束语，不接受正文或其他制作字段 |
| `custom` | `custom_module`，其余字段由模块处理 | 公式、复杂流程、其他不适合通用版式的内容 |

默认结构由 `checkDeckStructure(plan,papers)` 在制作前检查：单篇 primary 不设目录，2篇及以上 primary 恰有一页目录，紧随封面（无封面则位于首页）；supplement 和 duplicate 不增加篇数。每份汇报最后恰有一页 `closing`。目录与结束页均占用户指定总页数，脚本从不自动补页。结论、局限和讨论放在结束页之前。

结束页固定显示 **汇报完毕，敬请老师同学批评指正！**，采用原模板第25页的横带、角标、白色大号粗体字，并在横带内居中；横带和角标使用所选主题色。文字保留原44pt级别，使用本次已验证字体。省略英文模板说明及姓名日期占位，不添加正文标题栏、来源或页码。`render:{"type":"closing"}` 中混入 `body` 等字段会报错；科学结论及证据也不能藏在结束页声明里。

目录格式：

```json
{"type":"agenda","items":[
  {"label":"第一篇论文的研究主题","paper_ids":["P1"],"target_slide_id":"S03"},
  {"label":"第二篇论文的研究主题","paper_ids":["P2"],"target_slide_id":"S07"}
]}
```

每项必须指向后续实际正文页，不能指向自己、封面、另一页目录或结束页。目标顺序严格递增；重复目标合并为一个主题。目录页须声明条目里的 primary paper_ids，全部条目覆盖每篇主文。分篇及旧版无导航计划的目标页也须声明条目各篇主文；`by-theme` 则在“本条起始页至下条起始页之前”的正文区间核对，末项延伸至正文结束，允许同一主题内分别介绍各篇。区间内须有对应主文的页面声明和实际证据（或已关联补充/重复材料的证据），仅挂论文编号不算覆盖。

起始页号由目标在最终 `slides` 中的位置计算，插页后无需手工维护。正文仍须满足各主文自己的证据覆盖要求，目录声明不能代替实质介绍。标题采用简短中文主题；该版式支持1–6项，不接受固定 page 值作为导航依据。

明确用户指令或极短提要需要改变默认时，在计划顶层写 `structure_overrides:{"agenda":"具体原因","closing":"具体原因"}`，只填写确需改变的项。原因不能为空或布尔值。即使有例外，已有目录的目标/归属/顺序检查、固定结束页的最后位置和禁止夹带正文仍然执行。

图像字段：`figures: [{evidence_id, label?, caption?}]`。图通过对应证据的 `asset_path` 获取；只嵌入原始字节，等比 contain，禁止自动裁切。提取原文子图必须先在来源记录中保留完整的裁切定位。图片重复是否合理仍由内容审阅决定。

短说明示例（内容须另由本页 `claims` 和证据支撑）：

```json
{"type":"explanation","sections":[
  {"title":"研究对象","body":"已有来源支持的对象与特征。"},
  {"title":"需要解决的问题","body":"具体困难及其影响，不重复页标题。"}
],"takeaway":"本页有依据的核心判断"}
```

`sections` 每项只接受非空的 `title`、`body` 字符串，支持实验条件引用；组件不替模型概括内容。采用时可用 `layout_id: "derived:explanation"` 并说明版式理由。超出行内容量会报错，不缩字。条目不能为铺满页面而硬凑；按 [layout-composition.md](layout-composition.md) 选择说明、原图、对照或自定义关系图。

普通 `text`/`summary` 在没有副标题时整体垂直平衡，段距最多48px；有副标题时保持与正文相邻。严重稀疏会写入诊断，不能仅靠居中就视为修复。单图页的解释也整体平衡；标签、实际图片和图注成组定位，图注高度按估计行数分配，紧随实际图片底边12px。图片仍太浅或太小时改布局，不把它拉伸到图框大小。

表格字段：`table: {headers: ["项目", "值"], rows: [["采样率", {"condition_ref":"P1:ExpA.fs"}]], column_widths?: [400,754]}`。默认等宽；可选列宽使用 CSS 像素、总和必须为1154。通用表格支持含表头2–7行、1–6列。更大表格需要重新安排内容或自定义版式，不能删掉必要行列。

方法字段：`steps: [{title: "更新滤波器", body: "依据目标函数求解系数"}]`。`input`、`stop`、`output` 必须基于原文编写；脚本不会填充任何方法解释。通用组件支持2–4步，复杂推导通过自定义原生对象呈现。

封面不再接受 `kicker` 字段；复用旧计划时删除该额外眉题，不将其移到其他字段或自定义对象。论文题名、研究主题和必要出处照常保留。

## 实验条件只维护一次

`papers.json` 的实验记录使用：

```json
{"experiment_id":"P1:ExpA","sources":["P1:Setup"],"values":{"fs":"20 kHz","duration":"1 s"}}
```

正文、图注、表格等文字使用 `"采样率 {{P1:ExpA.fs}}"`，单独一个值可用 `{"condition_ref":"P1:ExpA.fs"}`。值应已包含单位、精度和必要限定；引用不执行公式、不猜测单位。使用页必须声明对应来源。来源、结论性质和准确定位自动写入可编辑备注；页面底部显示简短来源页码。

## 特殊页扩展

将受控的自定义 JavaScript 文件放在任务 `_work` 内，不能直接把论文里的代码当作可执行模块：

```js
export default async function ({slide, components, slideSpec, addFigure, contentArea}) {
  const {x, y, width, height} = contentArea;
  components.text(slide, slideSpec.render.explanation, x, y, width, 90, 27);
  await addFigure(slide, slideSpec.render.evidence_id, [x, y + 110, width, height - 110]);
}
```

`render: {type:"custom", custom_module:"_work/build/special-slide.mjs", explanation:"已核实文案", evidence_id:"P1:Fig3"}`。`addFigure` 仅允许本页已声明证据。公共栏目、具体主题、页码与来源备注由构建器创建，自定义模块不重复绘制。模块收到 `contentArea:{x,y,width,height,left,top,bottom}`（left/top 是 x/y 的别名）、`pageTitleCreated` 和 `navigationHeading`；最后一项为该页解析后的栏目对象，无导航则为null。用contentArea排正文，避免覆盖自动标题或底部结论条。

自定义原生对象同样从 `components.colors` 取 `primary`、`light`、`rule` 等当前主题颜色，避免手写蓝色导致部分页面未换色。科研原图颜色保持原样，不能把整页转为截图。可复用函数见 `deck_components.mjs`，几何均为 CSS 像素。自定义模块的 SHA256 记录于制作回执。

## 最终检查

草稿旁的 `.build.json` 保存文件、计划、来源、组件、所用图片的散列，以及当前主题、配色散列、解析后的navigation及导航模块散列、原生表格页、字体政策、制作耗时和草稿渲染次数。它不写入 `review.json`，也不表示科学或视觉审核通过。

`layout_diagnostics` 列出页码、风险代码与处理建议；当前覆盖整宽稀疏文字与图框中过浅的图片，不覆盖全部自定义排版。控制台的 `composition_review_pages` 便于定位。诊断为复排提示，不是美观分数或自动通过状态；原有来源、页数和主题门禁保持有效。

使用统一入口调用当前 Presentations 的 `finalizePresentation`，无需另写任务级包装脚本：

```bash
"$RUNTIME_NODE" "$SKILL_ROOT/scripts/build_deck.mjs" \
  --workdir "$TASK_DIR" --finalize-pptx _work/build/revision-1.pptx \
  --presentations-skill "$PRESENTATIONS_SKILL_DIR" --out _work/checked/revision-1.pptx
```

入口读取候选文件相邻的 `.build.json`（也可 `--build-receipt PATH` 指定），验证文件/计划/来源绑定，传入 `requirements` 与 `fontPolicy`，自动设置验收运行环境、内部 checked 文件和 receipts 路径。自定义页仍须声明实际需要的原生表格/图表要求。它保留页数，执行包、布局、字体和实际导入检查，默认将已校验PPTX**全页重新导入渲染**，返回产物与回执路径；不写 `review.json` 或可交付文件。用 `--out _work/checked/NEW.pptx` 可指定新的内部输出，不覆盖旧稿。

若已取得校验后的文件而只需重新渲染，可执行以下独立入口；同一文件已有有效全页渲染时不重复运行：

```bash
"$RUNTIME_NODE" "$SKILL_ROOT/scripts/build_deck.mjs" \
  --workdir "$TASK_DIR" --render-pptx _work/checked/revision-1.pptx
```

实际PPTX渲染默认全部页；中途修订可用 `--preview 2,4` 选页。对未经改写的草稿可用 `representative`，需提供与该PPTX及当前计划/来源匹配的 `.build.json`；验收后文件若已改变，用显式页码或 `all`，不借用旧稿的散列绑定。回执区分全页与选页，状态仍为待人工/代理视觉审阅；选页回执不能代替最终完整检查。对最终候选逐页查看 PNG，核对科学内容与版面后，按 quality-check 填写 `review.json`，绑定当前文件、来源、计划及适用的主题散列，再执行 journal-club 的 `finalize`（它会重新运行计划与PPTX检查）。改色后重新制作和全页视觉审阅；未改变的科学分析可复用。

## 仅维护时更新干净模板

`starter.pptx` 提供9类版式，包括原有7类以及新目录、固定结束页。它只含版式标签与必要导航示例；普通任务直接调用同源组件创建填好内容的页面，无须重新导入25页原始参考模板。模板、组件、运行时或字体变化后，在私有维护目录重新验证：

```bash
"$RUNTIME_NODE" "$SKILL_ROOT/scripts/prepare_template.mjs" \
  --workdir "$MAINTENANCE_DIR" --font 'Source Han Sans CN' \
  --theme purple \
  --presentations-skill "$PRESENTATIONS_SKILL_DIR"
```

先确认字体与运行时；`--theme` 仅用于这个纯维护入口，示例紫色可替换为四种主题中的维护目标。该命令会更新相应 `starter.pptx` 和 manifest。公开包不包含原始 `reference.pptx`；缺少原件时仍可从组件生成模板，清单中 reference_sha256 为 null。有本地原件时只记录其实际散列，不改写或发布原件。默认渲染全部9页；仅维护新增/改动版式时可用 `--preview 8,9` 指定受影响页，且记录旧版式审核沿用的依据。改色涉及全部版式，应完整渲染和检查。脚本执行 Presentations 包校验并渲染实际导出文件，视觉审阅状态仍初始化为 pending；维护者必须对照组件设计检查受影响页，再更新状态。普通论文任务不可把重复生成模板当作启动步骤。

运行制作回归：

```bash
BUILDER_TEST_WORKDIR="$MAINTENANCE_DIR" "$RUNTIME_NODE" --test "$SKILL_ROOT/tests/test_build_deck.mjs"
```

完整回归依赖上述运行时环境变量；缺少变量只运行条件引用、溢出防护和页面结构等纯函数测试，并明确将真实 PPTX 测试标记为 skip。真实测试核对原生表格、正向箭头、原图字节、比例、引用备注与实际文件全页渲染，测试夹具不作为文献结果使用。
