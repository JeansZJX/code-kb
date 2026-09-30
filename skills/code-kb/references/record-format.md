# 定义、引用与能力记录

登记或更新代码事实时读取本文件。每个源单独存放记录；业务模块可进一步拆文件，避免多人同时重写大索引。

## 索引位置

`code/index.json` 只登记项目、模块、代码源与记录位置。下面使用虚构项目和代码源：

```json
{
  "schema_version": 2,
  "project_id": "sample-game",
  "modules": {
    "client": {
      "sources": {
        "client-main": {
          "records": ["code/client/client-main/resources.json"],
          "inventory": "code/client/client-main/file-inventory.json"
        }
      }
    }
  }
}
```

记录路径相对知识库根，必须位于 `code/<module>/<source_id>/`。源编号与 manifest 一致。未接入的源可保留 `records: []`，不要为它填入其他源的记录。

## 符号文件

符号文件的顶层格式是：

```json
{
  "schema_version": 2,
  "project_id": "sample-game",
  "module": "client",
  "source_id": "client-main",
  "verification": {
    "method": "text-search-and-source-context-review",
    "coverage": "selected-public-entries",
    "references_coverage": "selected-confirmed-usages-only",
    "runtime_validation": "not-performed"
  },
  "symbols": []
}
```

这是空记录的格式示例，不能作为已核验结果。实际记录按任务所需填写核验时间、来源与覆盖范围。

每个符号保留以下字段。工具验证定位字段；职责、语义及动态绑定还需要阅读代码核对。

| 字段 | 内容 |
| --- | --- |
| `id` | 稳定符号标识，区分所属类型、函数签名及重载；同一文件内不重复 |
| `kind`, `name`, `signature`, `declaring_type` | 实际类型、名称、签名、所属类或包；不适用项可省略 |
| `definition` | 定义位置：代码源内相对 `path`、从 1 开始的 `line`、该行非空 `evidence`、64 位小写十六进制 `file_sha256` |
| `retrieval_method` | `language-service`、`ast` 或 `text-search`；必要时写明工具与版本 |
| `references` | 已知引用位置，同样有路径、行证据和指纹；另有 `status` 与核验方法 |
| `dynamic_references` | 序列化、反射、配置、场景或注册表绑定，写清证据与未查项 |
| `related_rules`, `related_capabilities` | 对应规则和能力条目的编号 |
| `status` | `candidate`、`verified`、`stale` 或 `deleted` |

`references` 中，文本搜索命中先为 `candidate`。核对语境确实引用目标符号后改为 `confirmed`；同名、重载和注释命中不能直接确认。没有查到引用时，可以登记空数组，但核验范围不能写成完整调用图。

指纹由文件实际字节计算 SHA-256。行号按 LF 分隔，即 CRLF 文件中的 CR 不单独计行。证据是指定行中的真实文本，不能只填自然语言说明。文件改动后，原指纹涉及的记录应重新核验；不能只刷新指纹却保留旧行号或过时引用。

删除或重命名符号时，更新旧记录状态并查相关调用位置与能力目录，避免新旧入口同时被推荐。可记录替代符号和迁移依据。

## 文件清单

`inventory` 生成 `file-inventory.json`，内容包含 `project_id`、`module`、`source_id`、配置的 `source_identity`、相对文件路径和指纹。`source_identity` 是 manifest 中的代码源路径，用于发现源编号被改指到另一分支；它不是个人绝对路径。

清单里的 SVN 状态可为 `unknown`，或含实际查询到的仓库 UUID、仓库相对路径、源根基础修订、dirty 状态。未查询文件级混合修订时明确为 `not-inspected`，不要自行补成统一修订。

清单只表明扫描范围内哪些文件存在及其内容指纹。它不提供类继承图、函数签名解析、调用图或 Unity 场景绑定。

## 验证结果

`verify` 检查登记的 `verified` 定义和 `confirmed` 引用：文件存在、SHA-256 匹配、行号有效、行证据仍存在、项目和代码源一致。仅 `candidate` 的记录不会形成已验证位置。

| 退出码 | 含义 |
| --- | --- |
| `0` | 至少检查了一个位置，登记范围内未发现定位错误 |
| `1` | 配置、来源或记录有错误，或证据已经过期 |
| `2` | 没有可检查的已核验位置；不能报告验证通过 |

验证成功不证明函数行为正确、引用完整或工作副本已同步。`--module` 和 `--source` 可以限定核验范围，交付说明应保留这个范围。

## 公共能力与规则

能力目录放在 manifest 的 `catalog` 位置。条目建议包括编号、职责、入口符号、适用场景、调用示例、限制、负责人、替代关系和状态。真实签名与源码位置可以随代码核验更新；推荐入口、限制、业务语义和替代判断的改变先写为提案，保留原有 `accepted` 判断。

规则文件说明命名与目录的对应、类和函数应该存放的位置、允许引用的模块、禁止的依赖方向及特殊约束。规则编号由符号与能力条目引用，避免逐条复制正文。每条 `accepted` 规则保留决策依据，文档证据与团队确认分别记录。

首次整理已有代码时，先用语言服务、AST 工具或阅读源码取得真实候选，再逐步核验团队常用入口。不能从目录名和说明文档推测具体类或函数，更不能把候选自动提升为标准。

内置 `import` 使用 Tree-sitter AST 解析实际文件。它生成独立的候选记录，保留已经人工整理的符号文件；同名文本引用也保持 `candidate`。解析结果的覆盖范围和错误需要保留，只有回到当前源码确认后，才把重要定义或引用升为 `verified`、`confirmed` 并进入验收范围。

导入按源文件输出到 `code/<module>/<source_id>/imported/<源码相对路径>.json`，例如 `imported/Assets/Scripts/Example.cs.json`，再追加索引登记。文件带有 `managed_by: "code-kb-import"` 和 `source_file`，包含 AST 定义、源码头部签名及导入指令；同文件标识符引用候选限量保存，默认每个符号最多 30 条，覆盖范围明确为局部。

重复导入只刷新导入器维护且仍为候选的记录。已核验、过期、删除状态或非导入器维护的文件会保留并给出提醒；原源码消失时，仍属于自动候选的旧记录标为过期。旧 schema 1 的输出按其原模块目录存放，不自动增加 schema 2 的源目录层。

检测到标准自动生成标记时，记录保留 `generated_code` 及实际标记证据。默认 `types-only` 只导入类型与枚举等定义，不收录生成的成员和引用；需要这些内容时配置 `full` 或直接查询源码。每份记录的覆盖范围必须与实际模式一致。
