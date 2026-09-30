# code-kb

可分享的 Codex 技能，用于在各自项目中建立和维护团队代码知识库。适用于 SVN 等本地工作副本，成员可以使用不同的盘符和检出目录。

本仓库只分发通用技能、运行工具和安装说明，不包含任何业务项目的源码、协议、团队规范、真实符号索引或接入报告。使用技能产生的知识库保存在使用者自己的项目中。

## 能力

- 开发前读取已确认规则，查询已有类、函数和复用入口。
- 从存量源码导入定义及同文件引用候选，保留已有人工核验记录。
- 开发后更新受影响的定义、引用和文件指纹；新规范先登记为提案。
- 按模块和代码源隔离主线与分支记录，使用项目相对路径。

## 安装

在 Codex 中使用技能安装器：

```text
$skill-installer 安装 https://github.com/JeansZJX/code-kb/tree/main/skills/code-kb
```

也可以下载本仓库并解压，在自己的项目根目录运行：

```powershell
$packageDir = Read-Host 'code-kb 的解压目录'
node (Join-Path $packageDir 'scripts/install.mjs') --project-root .
```

项目内安装位置是 `.agents/skills/code-kb`。升级前核对版本，安装器加 `--replace` 更新；团队应统一使用同一个 tag 或 commit SHA。安装后在 Codex 中开始新会话，确认能够选择 `code-kb`。安装技能不会自动初始化或同步项目知识库。

## 依赖

`code-kb` 不依赖其他 Codex 技能。`skill-installer` 只是可选安装方式；`humanizer-zh` 等个人审校技能也不是运行要求。团队自己的 `AGENTS.md` 若引用额外技能，应约定未安装时的处理方式。

| 工具 | 何时需要 |
| --- | --- |
| Node.js 18 或更新版本 | 运行内置脚本 |
| npm 与锁定的两个解析包 | 使用 `import` 时安装 `web-tree-sitter` 和 `@repomix/tree-sitter-wasms`；其他命令只使用 Node.js 标准库 |
| SVN 命令行 | 查询代码源身份、修订和本地改动；正常相对目录下缺少它时保留未知状态，替代本机路径映射则必须用它核验身份 |

## 接入自己的项目

工具需要 Node.js 18 或更新版本。以下命令按项目内安装展示；全局安装时，把 `.agents/skills/code-kb` 换成实际技能目录。

尚未建立知识库的项目，在项目根执行一次：

```powershell
node .agents/skills/code-kb/scripts/kb.mjs init --project-root . --preset generic
```

Unity/SVN 项目可使用 `--preset unity-svn`。预设目录均为虚构示例，必须按自己的项目调整 `.code-kb/manifest.json` 中的路径、语言、扫描范围和状态。已有知识库的项目直接配置入口，不重复执行 `init`。[配置说明](skills/code-kb/references/configuration.md)

在项目自己的 `AGENTS.md` 中加入：

```markdown
代码开发、重构和协议变更使用 code-kb 技能。
按 code-kb.project.json 定位项目知识库。
开发前读取适用规范并查询已有能力，开发后更新受影响的代码记录。
新规范先写提案，由团队确认；项目知识保存在本项目中，不加入技能分发仓库。
```

首次整理存量代码时，安装锁定的解析依赖，再导入实际模块：

```powershell
npm.cmd ci --prefix .agents/skills/code-kb --ignore-scripts --no-audit --no-fund
node .agents/skills/code-kb/scripts/kb.mjs import --project-root . --module app
```

`app` 是 generic 预设的模块编号；使用其他配置时替换为实际模块。初始支持 C#、TypeScript、JavaScript、Go 和 Python。自动导入结果属于候选，不能直接当作完整调用图或团队规范。[记录格式](skills/code-kb/references/record-format.md)

## 日常使用

从自己的项目根打开 Codex，输入：

```text
$code-kb 实现这次功能：先读取适用规范并查询已有实现，完成验证后更新受影响的代码知识。
```

提交前审查代码与知识记录，执行项目需要的构建和测试。技能不自动更新、提交或合并 SVN；没有可用 SVN 命令行时，相关元数据保留为未知。知识库与本机依赖由使用者在自己的项目中维护，不回传到本仓库。

## 多人协作

SVN 能检查同一文件的过期提交，但不同文件仍可能基于旧规则提交成功，文本合并也不能确认代码与知识一致。成员开工前同步相关代码和知识库，日常只更新任务涉及的记录；提交前再次同步、合并并重读发生变化的规则，再核验代码与证据。同一 SVN 仓库中的代码和对应知识记录应在同次提交中交付。

人工记录按模块、代码源和业务职责拆文件，公共规则及中心索引的变更集中审查。全量 `import` 由指定维护者执行；当前工具不支持按变更文件增量导入，也没有并发锁或事务保证。同一工作副本不要并行运行写入命令。完整流程与冲突处理见 [多人协作说明](skills/code-kb/references/collaboration.md)。
