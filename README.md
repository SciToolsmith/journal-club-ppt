<div align="center">

<h1>Journal Club PPT</h1>

<p><strong>将一篇或多篇论文，整理成可编辑的中文组会汇报。</strong></p>

<p>面向 Codex 的文献组会 Skill，支持单篇精读与多篇比较。</p>

<p>
  <a href="https://github.com/SciToolsmith/journal-club-ppt/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SciToolsmith/journal-club-ppt/ci.yml?branch=main&amp;style=flat-square&amp;label=checks" alt="CI 检查状态" /></a>
  <a href="SKILL.md"><img src="https://img.shields.io/badge/Codex-Skill-32497B?style=flat-square" alt="Codex Skill" /></a>
  <a href="#交付内容"><img src="https://img.shields.io/badge/PPTX-Editable-2F6B76?style=flat-square" alt="可编辑 PPTX" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-626873?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <a href="#快速开始">快速开始</a> ·
  <a href="#交付内容">交付内容</a> ·
  <a href="#开发与维护">开发与维护</a>
</p>

</div>

---

| 单篇精读 | 多篇比较 | 可编辑交付 |
| :--- | :--- | :--- |
| 讲清研究问题、方法与关键发现 | 按论文的真实关联组织介绍与对比 | 生成一个可继续修改的 PowerPoint 文件 |

## 快速开始

**使用环境：** 需要具备 PDF、Presentations 和配套工作区运行时的 Codex。普通使用无需手写构建代码。

### 1. 安装技能

在 Codex 中发送：

```text
使用 $skill-installer，从 https://github.com/SciToolsmith/journal-club-ppt
安装仓库根目录的 journal-club-ppt 技能。
```

<details>
<summary>手动安装</summary>

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
git clone https://github.com/SciToolsmith/journal-club-ppt.git \
  "${CODEX_HOME:-$HOME/.codex}/skills/journal-club-ppt"
```

已有安装时，先核对并保留本地修改，再执行更新。上述克隆命令不会覆盖已有的非空目录。

</details>

### 2. 上传论文并发起汇报

附上一篇或多篇论文 PDF，然后发送：

```text
使用 $journal-club-ppt，根据我上传的论文制作组会汇报。
重点讲清研究问题、方法、关键证据和结论的适用边界。
```

接着确认**总页数与主题色**，例如回复：`15页，紫色`。如果请求中已经写明，技能会直接沿用，不重复询问。

主题色可选**蓝、青、红、紫**。封面、栏目、表格与流程统一配色，论文原图保留原色。

### 3. 获取 PPTX

技能完成论文分析、页面制作和逐页复核后，交付一个 **`journal-club.pptx`**。

<details>
<summary>多篇论文的调用示例</summary>

```text
使用 $journal-club-ppt，把上传的三篇论文做成18页、青色的组会汇报。
围绕共同研究问题，比较各篇的方法、关键证据和结论边界。
```

论文之间缺少可靠关联时，采用分篇介绍，保留各自的来源和实验条件，不强行归纳共同结论。

</details>

## 汇报如何组织

| 环节 | 处理重点 |
| :--- | :--- |
| 论文理解 | 阅读全文，审阅主图主表，识别研究问题与方法逻辑 |
| 证据选择 | 保留关键结果、实验条件与结论边界，为实质结论关联来源 |
| 页面规划 | 在确认的总页数内组织叙事，按内容选择版式 |
| 成品复核 | 核对科学内容，完整渲染最终 PPTX 并逐页检查 |

总页数包含封面、目录和结束页等全部实际页面。单篇默认不设目录；两篇及以上独立论文在封面后安排目录，补充材料和重复文件不额外计为一篇。栏目随论文类型与论证需要调整。

## 交付内容

| 内容 | 在 PowerPoint 中的形式 |
| :--- | :--- |
| 标题、正文、图注 | 可编辑文本 |
| 表格、简单流程 | 原生表格、形状与连线 |
| 论文科研图 | 独立图片，可移动和缩放；图内曲线与数值仍属于图片 |

**默认只交付 PPTX。** 提取文本、裁图、计划、预览和检查记录留在内部工作目录；讲稿、PDF 或源码包仅在另行要求时提供。

## 使用说明

- **用于文献组会。** 支持单篇精读和多篇汇报；个人研究进展、开题及毕业答辩不属于当前范围。
- **保留证据边界。** 区分作者结论、分析判断与假设；跨论文比较需要核对研究对象、指标和实验条件。
- **材料需要可读。** 扫描质量差、文字错序或缺失关键材料时，可能需要进一步处理或补充。
- **检查覆盖不同层面。** 自动检查验证文件与数据结构，科学解读和实际版面仍需结合原文与最终渲染复核。

## 开发与维护

<details>
<summary><strong>运行依赖与本地检查</strong></summary>

Codex 桌面通过 `load_workspace_dependencies` 定位 Python、Node.js 和配套库。构建器使用宿主提供的 `@oai/artifact-tool`、`sharp` 与 Presentations 工具，不从公共 npm 安装私有 `@oai/artifact-tool`。

PDF 预处理依赖 `pypdf`、`Pillow` 和 `pypdfium2`；也可显式选择已安装的 Poppler 后端。

在开发环境中运行基础检查：

```sh
python -m pip install -r requirements-test.txt
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_navigation.mjs tests/test_build_deck.mjs
```

公共 CI 运行 Python 与可移植 Node 测试。另有 3 项 PPTX 集成测试依赖 Codex 宿主环境，未配置时明确跳过；CI 状态不能替代成品的科学与视觉复核。

</details>

<details>
<summary><strong>目录结构与详细文档</strong></summary>

```text
journal-club-ppt/
├── SKILL.md       # 技能入口与执行规则
├── agents/        # Codex 显示与调用配置
├── assets/        # 干净模板、配色与版式索引
├── references/    # 分析、制作与检查说明
├── scripts/       # 来源处理、构建与交付工具
└── tests/         # 工作流和构建测试
```

| 文档 | 内容 |
| :--- | :--- |
| [来源预处理](references/source-preparation.md) | 全文提取、页面预览与裁图 |
| [构建接口](references/build-api.md) | 制作入口与组件字段 |
| [质量检查](references/quality-check.md) | 科学内容、版面与交付复核 |
| [设计记录](references/design-notes.md) | 设计取舍、验证范围与维护依据 |

</details>

## 许可与素材

代码与文档采用 [MIT License](LICENSE)。公开版包含原生组件及其生成的干净模板；原始参考 PPT、原版截图和示例论文内容不随仓库发布。

用户论文与其他第三方材料保留各自权利，详见 [第三方说明](THIRD_PARTY_NOTICES.md)。
