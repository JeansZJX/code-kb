# 现有工具与采用范围

以下信息核对于 2026-09-30。Stars 表示关注度，不能证明工具符合某个团队的需求；项目说明、作者评测和用户问题也分别看待。这里没有安装或实测这些工具在当前业务项目中的表现。

| 工具 | 当日 Stars / 最近推送 | 可用能力 | 本地 SVN 与 Unity C# 的适用性 |
| --- | --- | --- | --- |
| [Repomix](https://github.com/yamadashy/repomix) | 28,608 / 09-29 | 把源码整理为 AI 可读内容，按路径过滤，Tree-sitter 压缩，MCP | CLI 读取本地目录；C# grammar 已提供，适合初次读取与概览 |
| [Serena](https://github.com/oraios/serena) | 29,914 / 09-29 | 语言服务或 IDE 提供符号查询、引用查找和编辑，自动更新索引 | 以项目目录工作，可作为 SVN 工作副本的语义工具；C# 需要配置语言服务 |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | 47,657 / 09-29 | AST 知识图、引用与影响分析、MCP 和技能 | 支持 C#；`analyze --skip-git` 可索引普通目录，SVN 本地目录在此范围内 |
| [CodeWiki](https://github.com/FSoft-AI4Code/CodeWiki) | 1,748 / 09-30 | 从依赖图生成模块文档、架构概览与图表 | 有 C# 分析器，允许非 Git 目录生成；Git 差异不可用时，更新路径会退回完整生成 |

本地 SVN 适用判断来自工具的目录接口和源码检查，不表示已经执行过 SVN 兼容性测试。

## 对本技能的选择

采用 Repomix 发布的 Tree-sitter grammar 包配合 `web-tree-sitter` 取得已有源码的 AST 候选，避免另写一套简单文本解析器。Repomix 本体按 MIT 发布；所使用的 grammar 包及其上游 parser 的许可分别随依赖保留。源码整理不能替代精确的编译器引用分析。[Repomix 源码](https://github.com/yamadashy/repomix/blob/main/src/core/treeSitter/languageConfig.ts)

Serena 可作为后续的语义查询工具，特别是查类、重载方法和真实引用。当前文档中，默认 C# 后端是 Roslyn，需要 .NET 10+；Windows 还需要 PowerShell 7，可选 `csharp_omnisharp`。语言服务会查找 `.sln`、`.slnx` 或 `.csproj`，Unity 项目应选自身代码源根，避免在包含多个工程的 SVN 根加载错误工程。Serena 应用使用 GPL-3.0-or-later，SolidLSP 使用 MIT，分发或改造时分别核对许可。[语言支持](https://oraios.github.io/serena/01-about/020_programming-languages.html)、[项目流程](https://oraios.github.io/serena/02-usage/040_workflow.html)、[许可](https://github.com/oraios/serena/blob/main/LICENSE)

GitNexus 的图分析很接近“类、函数、引用知识库”，但当前许可是 PolyForm Noncommercial。商业开发团队不把它设为默认依赖，应先确认自己的用途是否取得适用授权。技术支持 SVN 本地目录不能消除许可条件。[当前 LICENSE](https://github.com/abhigyanpatwari/GitNexus/blob/main/LICENSE)

CodeWiki 适合生成供人阅读的架构文档，按 MIT 发布。它需要 Python 3.12+、Node.js/npm、Git 与模型接入；非 Git 目录可以生成文档，但 SVN 修订不等于它的 Git 增量依据。更适合单独评估文档生成，不承担团队规范的确认流程。[生成逻辑](https://github.com/FSoft-AI4Code/CodeWiki/blob/main/codewiki/cli/commands/generate.py)

这些工具解决源码读取或理解问题。项目规则状态、SVN 代码源身份、分支隔离和团队决策仍由 code-kb 的项目层维护；导入结果不自动成为 `accepted` 规范。

## 可核对的维护与反馈

Repomix 最近 release 是 [v1.18.1](https://github.com/yamadashy/repomix/releases/tag/v1.18.1)，发布于 2026-09-21；Serena 为 [v1.7.0](https://github.com/oraios/serena/releases/tag/v1.7.0)，发布于 2026-08-09；GitNexus 为 [v1.6.12](https://github.com/abhigyanpatwari/GitNexus/releases/tag/v1.6.12)，发布于 2026-09-12。能力和许可还应按团队最终固定的版本复核。

近期用户反馈提供了具体测试方向：Serena [#2122](https://github.com/oraios/serena/issues/2122) 报告 Windows 下 MCP 关闭与重载问题；GitNexus [#3421](https://github.com/abhigyanpatwari/GitNexus/issues/3421) 报告 Swift 项目增量索引后的全文搜索退化；CodeWiki [#126](https://github.com/FSoft-AI4Code/CodeWiki/issues/126) 认可文档质量，同时反映大型 Java 项目初次生成耗时长。这些是各自环境中的用户报告，不能直接推断所有 Unity 项目都会遇到同样问题。
