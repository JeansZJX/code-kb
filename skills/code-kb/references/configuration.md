# 配置与代码源

需要初始化项目、调整目录、接入新语言、切换主干或设置本机映射时读取本文件。

## 项目入口

项目根的 `code-kb.project.json` 使用相对路径：

```json
{ "knowledge_base": ".code-kb" }
```

也可以指向项目内现有位置，例如 `Docs/Knowledge`。工具通过入口向上定位项目；明确指定知识库时使用 `--kb`，明确指定项目根时使用 `--project-root`。路径参数是当前机器上的路径，不写入共享索引。

manifest 的 `project_root_relative` 从知识库目录指向项目根。知识库放在项目根的 `.code-kb` 时填写 `..`；放在 `Docs/Knowledge` 时填写 `../..`。二者必须和入口定位的项目根一致。

## manifest schema 2

以下是虚构的目录布局，用于说明配置；使用前按自己的项目调整。代码源在核对实际代码之前都为 `planned`：

```json
{
  "schema_version": 2,
  "project_id": "sample-game",
  "project_root_relative": "..",
  "version_control": "svn",
  "local_mapping": "workspace.local.json",
  "code_index": "code/index.json",
  "catalog": "catalog/index.json",
  "rule_proposals": "proposals/",
  "rule_statuses": ["documented", "proposed", "accepted", "superseded"],
  "ignored_project_paths": ["artifacts"],
  "modules": {
    "client": {
      "active_source": "client-main",
      "inventory_roots": ["Assets/Scripts"],
      "extensions": [".cs", ".asmdef"],
      "exclude_dirs": ["Generated"],
      "rules": ["rules/shared.md", "rules/client.md"],
      "sources": {
        "client-main": {
          "project_relative_root": "apps/unity/trunk",
          "code_status": "planned",
          "role": "mainline"
        },
        "client-feature-example": {
          "project_relative_root": "apps/unity/branches/example-feature",
          "code_status": "planned",
          "role": "feature-branch"
        }
      }
    },
    "server": {
      "active_source": "server-main",
      "inventory_roots": ["src"],
      "extensions": [".go", ".proto"],
      "rules": ["rules/shared.md", "rules/server.md"],
      "sources": {
        "server-main": {
          "project_relative_root": "services/game/trunk",
          "code_status": "planned",
          "role": "mainline"
        }
      }
    }
  }
}
```

项目编号在团队各工作副本中保持一致。代码源编号只用字母、数字、点、横线和下划线，以字母或数字开头；本机映射按源编号查找，多个模块应使用不同源编号。

`project_relative_root` 相对项目根，`inventory_roots` 相对所选代码源。路径统一使用 `/`，不用盘符、用户名、反斜线或 `..` 跳出代码源。所有 source 都要明确状态：`available` 表示团队确认此处属于该代码源且可读；`planned` 表示待接入。目录已存在也不应自动确认它就是目标业务源码。

`extensions` 指定要进入文件清单的扩展名，包括开头的点。可设置 C#、Go、TypeScript、C++、Rust 等实际需要的语言。`exclude_dirs` 中单个目录名匹配任意层级同名目录，带 `/` 的路径匹配代码源中的对应子树。工具默认跳过 `.svn`、`.git`、`node_modules`、`Library`、`Temp`、`obj`、`bin`。生成代码是否排除取决于项目，涉及协议或生成入口时应另保留来源与生成规则。

`import_generated` 决定带标准自动生成标记的文件如何导入。默认 `types-only`，保留类型、枚举与来源，省略生成的函数、属性、字段和引用候选；`full` 按普通源码导入。文件清单仍保留这些文件及其摘要。没有生成标记的文件按普通源码处理，需要排除的路径由项目显式配置。

`ignored_project_paths` 相对项目根，防止误把备份、个人报告或包目录设为代码源。每个模块的 `rules` 登记其适用规则文件，公共规则可由多个模块引用。

## 分支与正式主干

新增功能分支时，为它登记独立源编号，例如 `client-feature-example`，虚构路径为 `apps/unity/branches/example-feature`。同时在 `code/index.json` 登记该源的 `records` 和清单路径。默认命令使用模块的 `active_source`，可用 `--source` 显式选择：

```text
node <技能目录>/scripts/kb.mjs inventory --project-root <项目根> --module client --source client-feature-example
node <技能目录>/scripts/kb.mjs verify --project-root <项目根> --module client --source client-feature-example
```

为新的正式主干保留新编号，确认代码后改为 `available`，核验其记录，再调整 `active_source`。已有清单记有代码源路径；原编号改指向另一路径会被工具拒绝。工具不会执行 SVN 切换或合并。

## 成员的本机路径

完整检出的成员只需要相同相对布局，不必填写映射。知识库在另一盘符也不会影响定位。

部分检出或单独检出模块时，可以把 `workspace.local.example.json` 复制成 `workspace.local.json`，在 `roots` 下按代码源编号填写自己的路径。这是唯一允许个人绝对路径的配置文件，排除 SVN 提交。

为了防止把另一分支当作当前代码源，替代路径必须有对应的 SVN 身份绑定。在 source 中登记实际 `svn info --xml` 返回的 `repository_uuid` 和 `repository_relative_path`：

```json
"svn": {
  "repository_uuid": "填写实际仓库 UUID",
  "repository_relative_path": "^/apps/unity/trunk"
}
```

工具只读查询 `svn info` 和 `svn status`，确认 UUID 与仓库相对路径匹配。缺少绑定、SVN 命令不可用或身份不匹配时，替代映射会被拒绝。正常项目相对布局在无法查询 SVN 时仍可读取文件，SVN 状态保留 `unknown`；这不能证明工作副本已同步。

SVN 元数据只记录源根目录的基础修订与 dirty 状态，文件级混合修订没有逐个检查，不能把源根修订当成每个文件的已提交版本。共享输出省略本机根路径与仓库服务器地址。

## 旧知识库

工具可读取已有 schema 1 项目知识库，保留原索引和规则状态。schema 1 的目录根按 `../..` 推导，模块的单个源在工具内部记为 `legacy`。这种兼容用于既有布局，新项目用 schema 2；需要移动旧库或拆分多分支时，先保留原数据并明确迁移，不静默重写格式。

## 常用命令

| 命令 | 用途 | 结果限制 |
| --- | --- | --- |
| `init --project-root . --preset unity-svn` | 新建 Unity/SVN 项目框架 | 所有源先为 planned；已有知识库时拒绝 |
| `init --project-root . --preset generic --project-id team-app` | 新建其他技术栈项目框架 | 再按项目配置路径、扩展名和规则 |
| `status --project-root .` | 查看源与可读状态 | 不能代替更新工作副本 |
| `inventory --project-root . --module client` | 更新当前源的文件指纹清单 | 不解析类、函数或引用 |
| `import --project-root . --module client` | 从已有源码提取 AST 定义候选 | 语言支持和未覆盖范围以输出为准，引用仍需核对 |
| `verify --project-root . --module client` | 验证该模块已登记的源位置 | 不编译，不证明调用关系完整 |

`--source` 必须配合 `--module`。初始化只接受 `--project-root`、`--preset`、`--project-id`；其余命令可以使用 `--kb` 定位知识库。

## 源码解析依赖

核心 `init`、`status`、`inventory` 和 `verify` 不需要额外依赖。首次使用 `import` 时，在项目根安装技能 `package.json` 声明的固定版本：

```text
npm ci --prefix .agents/skills/code-kb --ignore-scripts --no-audit --no-fund
```

全局安装的技能改用当前成员的实际技能目录作为 `--prefix`。依赖放在本机 `node_modules`，不加入 SVN。安装器不会复制已有的 `node_modules` 或 `.git`。

源码提取使用 `web-tree-sitter` 与 `@repomix/tree-sitter-wasms`，不复制 Repomix 应用源码。固定包版本和上游许可由技能包及依赖包记录。自动结果先为候选，已核验条目仍由 Codex 阅读源码后登记；团队规范和能力推荐状态不随导入改变。

初始导入支持 `.cs`、`.ts`、`.tsx`、`.js`、`.mjs`、`.cjs`、`.go`、`.py`。配置里的其他扩展名仍可进入文件清单，在导入结果中报告为 `unsupported_files`。导入要求 `--module`，`--source` 可选，默认使用模块的当前源。
