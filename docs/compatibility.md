# 组合兼容矩阵

宿主0.2.1-rc.1，DevKit0.2.6。PASS仅指该层已测行为；挂载成功、原生工具通过，不能证明压缩、记忆、技能或团队的模型语义组合无干扰。全部试验使用隔离DSH_HOME和项目。

| 编号 | 组合 | 原生工具层 | 完整语义组合 | 实测范围/限制 |
|---|---|---|---|---|
| B | DevKit | FAIL | BLOCKED | 17 native cases pass; browser startup fails under workspace-write (Chrome crashpad OpenProcess denied). |
| B-browser-full | DevKit + actual browser, isolated explicit full permission | PASS | BLOCKED | 19 cases pass, including real generator→auto smoke→milestones→delivery→user inbox feedback→span patch→browser. No inference in these cases. |
| C | DevKit + billion-context 0.1.202 | PASS | BLOCKED | Single policy/context and native state guards pass. No long-history compression trigger or end-to-end model comparison. |
| D | DevKit + dsh-memory 0.8.1 | PASS | BLOCKED | Mount and native guards pass with isolated aux storage; stale-memory semantic conflict not exercised. |
| E | DevKit + Superpowers 0.1.2 | PASS | BLOCKED | Skill plugin mounts and native guards pass; live skill selection/cost not measured. |
| CD | DevKit + compression + memory | PASS | BLOCKED | 17 native guards pass together. Combined compression/retrieval inference not exercised. |
| F | DevKit + official team/auto-review 0.2.1-rc.1 | PASS | BLOCKED | Native guard suite passes; shared workspace concurrent writers denied. Live teammate scheduling and review inference not exercised. |
| G | DevKit + Vision Router 3.0.4 | PASS | BLOCKED | Root mounts, SDK web bridge pending; visual inference not executed. |
| H | All selected components (SDK) | PASS | BLOCKED | 17 guard cases pass; vision web bridge pending in SDK. No all-capability autonomous model task. |
| H-web | All selected components (real Web/standard) | FAIL | BLOCKED | 17 cases pass, web bridge mounts and UI opens. One real browser startup case fails under workspace-write. Vision first-use modal dismissed normally. |

本轮最终版本原生组合共174例：PASS 172，FAIL 2，SKIP 0，BLOCKED 0。两个失败均为受限模式的真实浏览器启动；不能剔除后称“全部通过”。详细案例时间、原生执行索引、产物引用见 docs/evidence/native-summary.json（公开脱敏摘要）。

另有23项单元检查、桌面单条目生命周期、真实宿主崩溃后恢复及独立浏览器评分，分层记录，不加总冒充许愿成功率。共享项目的多写入者会被拒绝，因此团队兼容不意味着支持多人同时写同一个工作区；并行任务应使用分离工作区。
