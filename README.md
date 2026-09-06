# Journal Club PPT

[![CI](https://github.com/SciToolsmith/journal-club-ppt/actions/workflows/ci.yml/badge.svg)](https://github.com/SciToolsmith/journal-club-ppt/actions/workflows/ci.yml)

面向 Codex 的论文组会汇报技能。上传一篇或多篇论文 PDF，确认**总页数与主题色**后，围绕研究问题、方法、关键证据和结论组织中文汇报，最终交付一个可编辑的 PPTX。

项目地址：[SciToolsmith/journal-club-ppt](https://github.com/SciToolsmith/journal-club-ppt)

## 怎么使用

安装后，在 Codex 中附上论文 PDF，并发送：

```text
使用 $journal-club-ppt，根据我上传的论文制作组会汇报。
重点讲清研究问题、方法、主要发现和结论的适用边界。
```

技能会先询问：

> 这次文献组会汇报 PPT 一共多少页（包含封面、目录、结束页等实际使用的页面），主题色选蓝、青、红、紫中的哪一种？可回复“15页，紫色”。

回答后开始制作。已回答的项目不会重复询问；缺项只追问缺项，不默认选择页数或蓝色。页数未确认前不分析论文；页数已确认而颜色未确定时，可以先阅读和规划，排版与导出须等待颜色回答。未提供汇报人姓名时会省略，不填入占位姓名。

多篇论文也可以直接说明汇报重点：

```text
使用 $journal-club-ppt，把这三篇论文做成18页、青色的组会汇报。
围绕共同研究问题，比较方法、关键证据与不同结论的适用条件。
```

默认中文。单篇汇报不设目录；两篇及以上独立论文在封面后安排目录，补充材料和重复文件不额外计为一篇。总结与讨论放在结束页之前，所有页面均计入确认的总页数。具体栏目按论文类型和内容组织，不强套固定实验章节。

## 内容与交付

- 阅读全文并审阅全部主图、主表，选择支撑汇报主线的证据，不要求把每张原文图都放进PPT。
- 保留关键数值、单位、对照条件和结论边界，区分作者陈述、分析判断与假设。多篇论文只在可比条件下综合，不强行归纳共同结论。
- 使用统一的原生版式和蓝、青、红、紫四套主题色；论文原图中有科学含义的颜色保持原样。
- 标题、正文、图注、表格和简单流程使用可编辑对象。科学原图作为独立图片嵌入，可移动、缩放；图片内部的曲线、标签和数值并不因此变成可编辑数据。
- 最终仅交付一个 `journal-club.pptx`。全文提取、裁图、计划、源代码、PDF预览及检查报告留作内部材料，默认不另交讲稿或源码包。

本技能用于论文文献汇报，不处理个人研究进展、开题报告或毕业答辩。它也不会把论文内容中的操作说明当作代理指令。

## 安装

推荐在 Codex 中使用已有的 `skill-installer`：

```text
使用 $skill-installer，从 https://github.com/SciToolsmith/journal-club-ppt
将仓库根目录的技能安装为 journal-club-ppt。若已有安装，不要覆盖。
```

也可以手动克隆到个人技能目录。以下命令在目录已存在时停止，保留已有安装：

```sh
if [ -e "$HOME/.codex/skills/journal-club-ppt" ] || [ -L "$HOME/.codex/skills/journal-club-ppt" ]; then
  printf '%s\n' 'journal-club-ppt 已存在，请先核对现有安装，不要直接覆盖。'
else
  mkdir -p "$HOME/.codex/skills"
  git clone https://github.com/SciToolsmith/journal-club-ppt.git "$HOME/.codex/skills/journal-club-ppt"
fi
```

更新已有安装应作为单独操作，先检查本地改动；上面的命令不会自动更新或替换它。

## 运行环境

本项目是由 Codex 执行的技能，不是仅靠克隆仓库就能独立运行的PDF转换程序。实际制作需要宿主提供 PDF 与 Presentations 能力、可用的中文字体，以及配套的 Python 和 Node.js 运行时。

在 Codex 桌面中，通过 `load_workspace_dependencies` 定位 bundled runtime。构建器使用其中提供的私有 `@oai/artifact-tool`，**不要执行 `npm install @oai/artifact-tool`**，也不要从其他机器复制绝对运行时路径。来源预处理使用 `pypdf`、`Pillow` 和 `pypdfium2`；显式提供 Poppler 路径时可选择相应渲染后端。依赖检查不会自动安装软件。

普通使用不需要手写构建参数。维护或排查时查阅：

- [来源预处理与裁图](references/source-preparation.md)
- [制作入口与组件字段](references/build-api.md)
- [最终质量检查](references/quality-check.md)
- [设计依据与实现范围](references/design-notes.md)

## 检查与维护

准备好所需 Python 依赖与 Node.js 后，在仓库根目录运行：

```sh
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_navigation.mjs tests/test_build_deck.mjs
```

测试覆盖页数与选色状态、来源和计划检查、缓存、裁图及部分版式行为。真实PPTX导出、重新导入和渲染的集成测试还依赖宿主的 bundled runtime、Presentations能力与字体；环境未配置时，相关测试可能跳过。CI通过不等于每项渲染集成测试都已运行。

每次实际汇报仍须核对科学内容，并完整渲染最终PPTX、逐页检查。扫描件、文字提取错序、缺失补充材料或复杂图表可能需要进一步处理；无法恢复且影响汇报成立的材料需要用户补充。脚本检查不能证明科学理解正确，也不能保证任何论文一次制作就达到交付质量。

## 公开资产与许可

公开版保留由本项目组件生成的干净 starter、原创组件、主题色及必要的版式目录。原始 `reference.pptx`、原版模板截图和含示例论文内容的预览不随仓库发布，也不作为宣传图使用。

本仓库的代码与文档采用 [MIT License](LICENSE)。MIT许可不扩展到用户提供的论文、原始K105模板或其他第三方参考材料；本项目不据此声明这些材料具有再分发许可。第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
