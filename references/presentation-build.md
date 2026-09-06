# 制作执行方式

页数与主题色确认、阅读与计划完成后制作，先通过check-plan。页数已答而颜色未答时可先完成阅读和内容规划，排版与导出须等待颜色回答。仍使用当前环境的Presentations技能及其原生可编辑对象能力；组件封装常用代码，不取消其运行时、导出和验收要求。

## 一次准备运行时

调用load_workspace_dependencies获取实际Python、Node与Node库目录。将RUNTIME_NODE_MODULES、RUNTIME_PYTHON设为本次返回的绝对路径，使用返回的Node执行脚本，并定位当前Presentations技能目录。完成其要求的authoring marker；不重复展开已读的通用说明。字体从当前可用字体中选择并传入；缺字时处理字体并重新渲染。

## 复用构建组件

按[build-api.md](build-api.md)给deck-plan中的页面增加render字段。常规页面使用现成封面、目录、正文、单图/双图、表格、方法、总结和固定结束页组件，来源说明与备注自动从papers/claims生成。单篇省略目录，多篇按实际顺序编排目录；固定结束页须在已确认总页数内预留。实验数值用命名引用统一维护。

构建器从run中已确认的主题读取统一配色，不手写任务级`--theme`。封面、标题、角标、目录、表格、流程和结束页共同换色，自定义原生对象也使用组件主题；科研原图颜色不变。K105版式与汇报范围不随颜色改变。

保留页数与原始科学内容，不能为了适配组件删掉必要信息。容量检查失败时精简重复文字、改图框或调整页面分配；内容独特时用custom页面扩展原生对象。不要通过持续缩字或整页截图解决问题。

内容过少也需要调整：按[layout-composition.md](layout-composition.md)选择有语义标题的explanation、相关证据图或真实关系图，协调主体位置与图文比例。严重稀疏不能只居中后继续交付。查看回执中的layout_diagnostics；代表预览会自动包含这些风险页，但没有报警的页面仍须实际检查美观。

构建器只生成内部候选PPTX与回执，不写最终output，不生成已复核状态。首轮使用`--preview representative`覆盖实际组件变体，额外检查独特或密集页；局部修改后仅预览受影响页。先检查实际中文换行、公式和图内字号，再进入终检。字段、几何和完整命令只在[build-api.md](build-api.md)维护；常规任务不用读取组件源码。

## 导出后

优先使用构建器的`--finalize-pptx`入口，传入当前`--presentations-skill`路径。它调用该技能的finalizePresentation，复用制作回执中的要求与字体政策，自动设置内部产物及回执路径，默认完整渲染实际校验后的PPTX；不要另写任务级验收包装脚本，也不重复执行同一份文件的完整渲染。选页渲染仅供中途修订，不代替最终全页检查。接口不兼容时查看当前Presentations的验收文档，不绕过校验。备用渲染只能用已定位的bundled LibreOffice，不能用用户桌面安装版；缺字须修复。

通过[quality-check.md](quality-check.md)后写review并调用workflow finalize；schema 3及已显式选色的旧任务须绑定当前theme_id与palette_sha256。改色后重新制作并实际查看全部导出页，科学分析可复用。最终只有该命令生成的单个PPTX可交付。
