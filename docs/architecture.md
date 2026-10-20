# 架构与执行边界

唯一根入口 `src/plugin.js` 注册七个内部工具，复用宿主的模型循环、原生工具、权限及事件。没有新的监督模型、记忆库或历史压缩器。

| 模块 | 职责 |
|---|---|
| core.js | 原子状态、写入锁、版本/epoch、任务模式、执行回执、证据和预算门禁 |
| intent.js | 来源片段、启发式愿望识别、上下文相关口语修订 |
| materials.js | TypeScript 编译器解析、内容缓存、导入邻接、片段引用和补丁准备 |
| workflow.js | 里程碑 DAG、证据驱动状态、checkpoint |
| scaffold.js / local-app-engine.js | 参数化本地应用生成；模型给业务配置，包给可复用实现 |
| smoke.js / browser-helper.js | 配置派生的真实浏览器步骤、截图和下载内容校验 |
| usage.js | 共享请求账本、提供商 usage、可选已报告 token 阈值 |

直接用户愿望进入受管任务，先形成契约、范围及验收条件再修改。原生执行前记录 pending，返回后结算 receipt。证据绑定需求版本、epoch、项目快照和有限环境指纹；外部修改、修订或恢复可能使它失效。技术验证与交付、用户反馈分开。

材料缓存是可重建派生数据，不是第二套任务状态。扫描默认最多3000文件/12MiB，快照最多4000文件/32MiB。默认避开常见凭据文件，不等于完整秘密扫描。共享工作区只允许一个契约写入者，团队任务应分离工作区。

运行中停止会传递 AbortSignal，旧结果不能推进新需求。重启遇到遗留 pending 后要求核对，不自动重放未知动作；不承诺撤销已经发生的外部副作用。宿主 shell 权限仍是权限边界。

配置项包括 stateRoot、workspaceRoots、maxRequests、maxTools、maxFailures、globalRequestLimit、globalBudgetRoot、reportedTokenLimit、contextCharacters、outputCharacters。全局 usage 账本在配置共享限制时启用。默认每项目累计100请求、200受管工具、连续验收失败上限3。
