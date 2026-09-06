# 制作执行方式

本文件只用于执行入口定位；字段见 [build-api.md](build-api.md)，检查边界见 [quality-check.md](quality-check.md)。不把三份文件的同义说明重复读写成新清单。

## 准备一次

页数、颜色与汇报人已有真实回答，阅读和计划完成后制作。通过 load_workspace_dependencies 取得 Python、Node 和库路径，设置 RUNTIME_NODE、RUNTIME_NODE_MODULES、RUNTIME_PYTHON；按当前 Presentations 技能完成其必需读取及 authoring marker，核实字体可用。新任务从 get-report 取得生成日期，封面和结束页共用同一署名信息。

普通任务直接使用现有组件，不重新生成 starter、运行技能回归或阅读全部源码。原文公式/示意图采用清晰裁图加可编辑说明即可；只有现成组件不能表达内容时才写 custom。未知字段或容量报错只查对应接口。

## 首稿与修订

通过 check-plan 后构建首稿，使用 `--preview representative`。explanation 按 `composition`、组数及有/无结论条组合各选最长一页，省略 `composition` 按 `prose` 处理；同时覆盖 custom 及诊断页。查看本轮所选页，集中修改影响正确性、可读性或不符合用户明确版式要求的问题。

修订稿使用 `--preview 3,8` 等实际改动页号；共享组件改变时包括所有受影响页。若最终导出字体有疑点，才用 `--render-pptx` 选看对应页。不要对无关页反复重看、反复修改同样合理的留白或整稿重排。

## 终验一次

稳定候选调用 `--finalize-pptx`，传当前 Presentations 技能路径。这个入口已完成验收和最终 PPTX 全页重新导入渲染，直接查看其结果，不再另写验收脚本或重复全稿渲染。

实际查看全页、确认无实质问题后写 review，运行 workflow finalize 得到唯一交付。科学内容和未变版面复用已完成的核验，改色后全页查看。若最终文件确有新问题，修复后重新验收，不能因为预期“一次”而带错交付。

接口失败才查当前 Presentations 验收文档。备用渲染仅使用 load_workspace_dependencies 定位的 bundled LibreOffice，不能使用用户桌面安装版；字体缺字需修复。
