# code-kb

供 Codex 使用的团队代码知识库技能。团队继续用 SVN 管理代码和项目知识；这个 GitHub 仓库分发通用技能、工具和格式说明。

开发前，技能读取已确认的项目规则，查找已有类、函数、模块和调用位置；开发后，更新受影响的代码记录并核对文件指纹。成员的磁盘、用户名和检出目录可以不同，共享记录使用项目相对路径和稳定的代码源编号。

## 存放什么

| 位置 | 内容 | 谁维护 |
| --- | --- | --- |
| 本仓库 | 技能、Node.js 工具、文档、示例目录配置 | 工具维护者 |
| 项目 SVN 中的 `.code-kb` | 项目规则、能力目录、类与函数记录、引用证据、规则提案 | 开发者与规则负责人 |
| 项目根的 `code-kb.project.json` | 知识库的相对位置 | 项目维护者 |
| 本机 `workspace.local.json` | 可选的本机代码源路径映射 | 当前成员，排除 SVN 提交 |

项目的协议、业务代码、内部架构和真实符号记录留在项目 SVN。示例只说明 Unity 客户端、待接入服务端和主干切换的目录配置。

## 安装技能

需要 Node.js 18 或更新版本。技能本身由 Codex 阅读；初始化、文件清单和验证仅使用 Node.js 标准库。首次解析已有源码时，安装技能包中固定版本的 Tree-sitter 运行时与 Repomix 发布的语言 grammar。已安装的 SVN 命令行可提供代码源身份与工作副本状态；没有命令行时，这些信息会标为未知。

团队建议使用同一个版本，并安装到各自工作副本的 `.agents/skills/code-kb`。从本仓库下载团队选定版本的 ZIP 并解压，在 SVN 项目根打开 PowerShell：

```powershell
$packageDir = Read-Host 'code-kb 的解压目录'
node (Join-Path $packageDir 'scripts/install.mjs') --project-root .
```

已有技能时，安装器会停止。核对新版本后加 `--replace` 更新；它只覆盖包中同名文件，保留其他文件，不修改项目知识。安装完成后重新打开 Codex 项目或开始新会话，确认技能列表包含 `code-kb`。

也可以在 Codex 中通过全局技能安装器安装：

```text
$skill-installer 安装 https://github.com/JeansZJX/code-kb/tree/main/skills/code-kb
```

`main` 适合首次体验。团队稳定使用时，把链接中的 `main` 换成维护者选定的 tag 或完整 commit SHA，记录在团队文档中。全局安装影响当前成员的多个项目，版本由各自维护。安装不会自动追踪 GitHub 更新。

## 项目负责人做一次

安装通用技能后，在 SVN 项目根执行：

```powershell
node .agents/skills/code-kb/scripts/kb.mjs init --project-root . --preset unity-svn
```

其他技术栈用 `--preset generic`，再按实际语言设置模块路径和扩展名。初始化会生成知识库和项目入口；它保留已有文件，不提交 SVN，也不自动确认项目规则。安装技能与初始化项目是两项独立操作。

随后修改 `.code-kb/manifest.json`：确认项目编号、代码源目录、扫描范围和排除项。登记现有临时主干和未来正式主干时，为它们保留不同的 `source_id`；正式主干尚未接入时保持 `planned`。配置说明见 [configuration.md](skills/code-kb/references/configuration.md)。

补充团队已经确认的规范，并记录确认依据。名称、模块职责、依赖方向、禁止直接调用的入口、生成代码的位置、协议约束等都放进项目知识库。初始化的规则状态包括 `accepted`、`proposed`、`documented` 和 `superseded`；已有项目保留自己的状态名。新生成的实现不能自行变成团队规范。

在项目根现有 `AGENTS.md` 中追加以下约定，保留其他指令：

```markdown
代码开发、重构和协议变更使用 code-kb 技能。
读取已安装的 code-kb 技能，再按 code-kb.project.json 定位团队知识库。
项目内安装时，技能入口是 .agents/skills/code-kb/SKILL.md；全局安装时使用当前成员的技能目录。
开发前读取适用的已确认规则并查询已有能力；开发后更新受影响的代码事实和引用。
知识库中的规则状态与代码源状态必须保留。新规则写入提案，由团队确认。
普通文本和策划任务不触发代码索引流程。
```

把 `code-kb.project.json`、`.code-kb` 及这段项目约定加入 SVN；排除 `.code-kb/workspace.local.json`。技能目录是否也加入 SVN，由团队决定：加入便于统一版本；各自安装则应在团队文档记录版本。先验证、检查差异，再由团队按现有流程提交。

## 首次整理已有代码

确认实际代码目录后，把对应源的 `code_status` 改为 `available`。负责人在项目根安装源码解析依赖，然后导入已有代码：

```powershell
npm install --prefix .agents/skills/code-kb --ignore-scripts --no-audit --no-fund
node .agents/skills/code-kb/scripts/kb.mjs import --project-root . --module client
```

导入使用 Tree-sitter AST 获取源码中的定义与位置，保留已有人工整理记录。初始支持 C#、TypeScript、JavaScript、Go 和 Python；其他配置扩展名报告为未支持文件。自动发现的符号和同文件标识符引用先登记为候选；Codex 再核对常用公共入口的职责、签名和真实调用，更新为已核验记录。覆盖范围和解析问题以工具输出为准。AST 不提供完整的编译器调用关系，不能用同名文本命中确认重载或反射引用。

带有标准自动生成标记的文件，默认只整理类型及来源，不收录大量重复的序列化方法与同名引用。模块配置 `import_generated: "full"` 可改为完整候选导入；默认值是 `types-only`。需要了解生成类型的字段或具体方法时，仍应查询原文件或语言服务。

这一步读取已开发的源码，给知识库提供初始数据；后续开发只需继续维护受影响记录。团队规则、推荐用法和协议语义仍由团队确认，不从现有写法自动推成标准。`node_modules` 留在本机，排除 SVN 提交。

## 成员日常使用

1. 安装团队指定版本，按现有流程更新 SVN 工作副本，确认代码与知识库都已获取。
2. 从自己的项目根或其中的客户端/服务端目录打开 Codex。首次可明确输入：`使用 $code-kb 开发这个功能，先查团队规范和已有实现，结束后更新受影响的知识记录。`
3. 给出需求。Codex 会读取适用规则、查复用入口、核对当前代码源，再实现和更新知识记录。提交前查看代码与知识库差异，执行有关验证。
4. 新的共同规则交给规则负责人确认；分支能力合入主干后重新核验，不能把分支记录直接当作主干事实。

SVN 项目需要让 Codex 识别项目根。若从子目录打开时未读取上级 `AGENTS.md`，在自己的 Codex `config.toml` 中合并配置：

```toml
project_root_markers = [".git", ".svn"]
```

不要覆盖已有配置。也可以直接从有 `AGENTS.md` 的项目根打开。技能发现和项目指令的机制见 [OpenAI 技能文档](https://learn.chatgpt.com/docs/build-skills) 与 [AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。

## 工具能验证什么

```powershell
node .agents/skills/code-kb/scripts/kb.mjs status --project-root .
node .agents/skills/code-kb/scripts/kb.mjs inventory --project-root . --module client
node .agents/skills/code-kb/scripts/kb.mjs verify --project-root .
```

`status` 查看项目和代码源状态；`inventory` 按配置生成文件清单与 SHA-256；`verify` 核对登记的定义和引用位置、证据与文件指纹。文件清单不会自动成为完整的语义索引。类的职责、调用者和复用建议需要 Codex 阅读实际代码后登记；符号解析器、LSP 或语言工具可以辅助查找，但仍要保留证据和核验范围。

这套流程帮助团队持续维护约定，不能靠提示词保证每次实现都符合规范。已有格式检查、编译器、测试和代码评审仍然是验收依据。工具不自动执行 `svn update`、提交、合并或改动 SVN 属性。

具体协作步骤见 [团队流程](docs/team-workflow.md)，记录格式见 [record-format.md](skills/code-kb/references/record-format.md)，成熟工具的选择依据见 [工具比较](docs/existing-tools.md)。
