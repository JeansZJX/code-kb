# 简短记录与协作约定

以下路径和代码名均为虚构示例。实际记录按团队现有职责与状态填写，路径默认相对项目根；卡片明确声明来源根时，源码路径也可相对此根。来源根本身相对项目根，不写个人绝对路径。

## 知识库入口

知识库 `README.md` 只需说明维护者、来源表和查找方式。例如：

```markdown
# 团队代码知识库

维护者：各来源的功能负责人；公共规范由技术负责人确认。

| 来源 ID | 相对项目根的代码或文档根 | 状态 | 适用规范 |
| --- | --- | --- | --- |
| client-main | Client/main | 可读 | rules/common.md、rules/client.md |
| client-ui-branch | Client/branches/ui | 可读 | rules/common.md、rules/client.md |
| server-main | Server/main | 尚未接入 | rules/common.md、rules/server.md |

按来源和功能关键字搜索 features/，再查 changes/ 中提到相同功能 ID 或入口的记录，并核对源码。
```

来源 ID 稳定且区分分支。状态说明是否能读取实际代码；尚未接入的代码源不能据此建立已核验功能卡。适用规范只引用实际存在的文件。

## 功能卡

文件：`features/client-main/inventory-refresh.md`。功能 ID 使用 `来源ID/功能ID`，变更单按此引用，避免不同来源同名混淆。

```markdown
# inventory-refresh：背包刷新

- 功能 ID：client-main/inventory-refresh。
- 状态：可用；维护者：客户端功能负责人。
- 职责：在背包数据变更后通知界面刷新。
- 入口：Client/main/Assets/Scripts/Inventory/InventoryRefresh.cs，InventoryRefresh.Notify(int itemId)。itemId 为发生变化的物品编号；无返回值。
- 调用方式：业务更新背包数据后调用 Notify，不由界面直接修改数据。
- 调用线索：Client/main/Assets/Scripts/Harvest/HarvestResult.cs 的 ApplyResult 已核验；用 InventoryRefresh.Notify 检索其他调用。这里记录实例，未核验全部调用者。
- 约束：主线程调用；遵守 rules/client.md 中的界面更新约定。
```

按需要补充关键事件、配置绑定或资源入口，不固定条数。删除无助于复用的实现细节；行号可帮助定位，但不能替代类、方法或配置键。废弃功能保留状态和迁移入口，不让旧调用无处可查。

## 独立变更单

文件：`changes/2026-10-09-harvest-refresh-8d2c4e69-a1b5-47c0-9f63-26de4b718c92.md`。文件名日期按任务实际日期填写，UUID 每任务新建；提交后不把旧单据当成下一任务的共享日志。

```markdown
# 采集结果复用背包刷新

- 作者：本任务开发者；类型：代码变更。
- 功能：client-main/inventory-refresh，修改。
- 实际变化：HarvestResult.ApplyResult 在数据更新完成后调用 InventoryRefresh.Notify；公共入口签名未变。
- 原因：复用已有刷新入口，移除本任务原拟新增的重复通知逻辑。
- 检查：核验 Notify 入口和 ApplyResult 调用顺序，执行相关模块测试。
- 未查项：其他玩法的反射或配置调用未覆盖。
- 汇总：交客户端功能负责人核对功能卡。
```

新增、改动、删除的功能和实际入口或调用变化都写清楚；没有变化的字段不堆写。检查只记录实际执行结果，未执行不能写通过。规则变更将类型写为“规则提案”，注明影响、理由和待维护者确认的事项；提案不等于已确认规则。历史修订号可从 SVN 日志查，单据不填未来提交号。

## 并发与汇总

- 两人改不同功能：各写独立变更单。维护者只汇总受影响的卡片，不重写整个目录。
- 两人改同一功能：单据仍分开保存；汇总时逐项核对有效增量和合并后的源码，不能仅按时间采用最后一份。
- 卡片尚未汇总：开发者同时查卡片、相关变更单和源码。若出现矛盾，先核实当前入口与调用约束，记录具体分歧。
- 同一物理工作区：先划分文件修改范围；同一脚本由成员协调或在独立工作副本中开发，单据独立不能解决源码写入冲突。
- 汇总后的单据：保留原任务事实。下一任务建立新单据；历史纠正也用新单据说明，不覆盖掉原来的决策依据。

汇总卡片只保留当前可复用事实，过程由独立单据与 SVN 日志追溯。缺少维护者或授权时先保留单据，不自动修改他人的共享卡片。不同分支的事实分别记录；合并到主干后按主干源码重新核验。
