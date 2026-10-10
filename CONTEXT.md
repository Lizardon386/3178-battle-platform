# 3178-battle-platform · 会话上下文与进展

> 本文件是任务交接档案，供后续 agent 实时跟进。改动产物后请更新「当前状态」「变更记录」。
> 最近更新：2026-10-10（Qoder）
<!-- 日期必须留在这行 blockquote 上：check-docs.sh 的 [新]/[旧]/[期] 只读这一行，正文里写日期不算顶部日期。改完本档也要把 README 顶部改成同一天，否则 [期] 判失败。 -->
> 面向使用者的设计思路与使用说明见同目录 [README.md](file:///D:/agent_workspace/3178-battle-platform/README.md)。

## 背景与目标

用户 2026-10-10 指令：**本会话只做类 war3 的联机对战平台**，把这部分能力从 [uno-online](file:///D:/agent_workspace/uno-online/CONTEXT.md) 里剥离出来重做，"不要怕麻烦，用合适的语言重构"；代码就落在本目录（原 `game-host-platform` 改名而来），不在别处新建仓库。

上一轮（同日、同目录的评估档）给出的取舍已被本会话按新指令改掉两条：

- **改判 1**：旧结论"不做多游戏容器"作废。平台化本身就是要装多个游戏，`GameModule` 契约与两个合成游戏是本轮的核心交付。
- **改判 2**：旧结论"房间列表/大厅只做地址簿 + 邀请链接"被用户驳回，要求尽量贴合 war3 的房间设计。落地为 **B+A 两档**：同网段 UDP 组播实时房间列表（需要本地壳）+ 地址簿/邀请链接（纯浏览器可用）；目录服务器仍然不做（需要常开公网节点，`render.yaml` 从未端到端验证过）。

目标产物：一个可被两个形状不同的游戏驱动、带房主权限与终局语义、能落盘恢复、能真 socket 联机的**平台内核**，以及尚未开始的客户端壳。

## 当前状态

**P0–P5 完成，`npm test` 57/57 全绿；`tools/check-seam.sh` 零命中；P6/P7/P8.5/R1 未开始。** 代码全部在本目录，`uno-online` 工作树未动一行（HEAD 仍是 `e9ad2cc`）。

| 已交付 | 位置 | 凭据 |
|---|---|---|
| 协议包（消息目录、错误码、握手、稳定摘要、形状闸门） | [packages/protocol/src](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/wire.ts) | [protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) 9 例 |
| 座位模型 + 房主权限 + 票据 + Ready 闸 | [room.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/room.ts) / [authority.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/authority.ts) | [room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) 14 例 |
| `GameModule` 契约 + `echo`/`turncount` + 同一断言集跑两游戏 | [module-api.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/module-api.ts) / [engine.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/engine.ts) | [contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) 19 例 |
| ws 传输、限流、Origin 策略、心跳、真 socket 双游戏 | [transport.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/transport.ts) | [ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) 4 例 |
| 房主侧落盘/恢复（原子写、版本闸、票据幸存、坏文件不挡启动） | [store.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/store.ts) | [store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) |
| 局域网组播信标（编解码 + 过期表；真网卡未实测） | [discovery.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/discovery.ts) | 同上 |

本会话读码核实的旧代码事实（决定切割面的位置，行号对 `uno-online` HEAD `e9ad2cc`）：

| 事实 | 证据 |
|---|---|
| `Room` 同时是座位管理器和规则引擎：第 1 行就 import 玩法模块 | [server/room.js:1](file:///D:/agent_workspace/uno-online/server/room.js) |
| 房间对象里座位字段与玩法字段同居一处，回合游标 `this.turn` 被规则与 eject 两边改写 | [server/room.js:10-43](file:///D:/agent_workspace/uno-online/server/room.js) |
| 广播路径带玩法：`broadcastState` → `room.serialize(p.id)` 内部算 peng/stack 选项 | [server/index.js:192-198](file:///D:/agent_workspace/uno-online/server/index.js) |
| 唯一漏斗是 `commit()`（广播+落盘+机器人调度） | [server/index.js:201-206](file:///D:/agent_workspace/uno-online/server/index.js) |
| 无房主概念：任何 socket 发 `start` 都能开局；`rejoin` 只要猜中房号+座位号即占座 | [server/index.js:426-433](file:///D:/agent_workspace/uno-online/server/index.js)、[server/index.js:401-414](file:///D:/agent_workspace/uno-online/server/index.js) |
| 不校验 Origin / 无 verifyClient（对本机壳连远程房主是好事，保留为默认放行） | [server/index.js:105](file:///D:/agent_workspace/uno-online/server/index.js) |
| 客户端连接地址写死 `location.host`，且倒计时拿本地钟比服务端绝对时间戳 | [public/client.js:156-157](file:///D:/agent_workspace/uno-online/public/client.js) |
| `ready` 字段存在但 `start()` 完全忽略它 | [server/room.js:236-239](file:///D:/agent_workspace/uno-online/server/room.js) |

## 计划 / 待办

- [x] P0 工程骨架 + 接缝闸门 + `node --test`
- [x] P1 协议包
- [x] P2 房主身份与座位模型
- [x] P3 `GameModule` 契约 + 两个合成游戏 + 契约测试
- [x] P4 传输 / 房间聊天 / 局域网信标（信标本身仍需双机实测）
- [x] P5 房主侧落盘与恢复
- [ ] **P6 客户端 SDK 与房间界面骨架**：连接地址可配（替掉 `location.host`）、localStorage 地址簿 + 会话票据、指数退避重连、单调钟外推（配合 `serverNow`）、错误码→UI、四个屏幕（局域网房间列表 / 加入页 / 房间内槽位+聊天 / 对局挂载点）、邀请链接 `?h=&g=&r=` 解析
- [ ] **P7 `hostd` 宿主壳**：`host` 模式（起平台 + 可选 cloudflared + 打印邀请链接）、`join`/`shell` 模式（本机 http 页面 + 组播浏览 + 代理 `GET /discovery/rooms` 带 CORS）、`diagnose`、`stop`；只读 `node.exe` 自己，绝不写防火墙规则
- [ ] P8.5 游戏模块从房主下发：客户端缺模块时拉 bundle + 哈希校验后挂载（war3 的"地图自动下载"位）
- [ ] P8 把 uno 接成第一个真游戏（`uno.js` 规则包成 `GameModule`，**不动 uno-online**）
- [ ] 双机实测组播发现：同 WiFi 下两台机器能否互相看见；首次绑定的防火墙弹窗行为
- [ ] R1 绿色便携包：官方签名 `node.exe` + `dist/` + `games/` + 快捷方式，干净目录双击开局
- [ ] 待做实验（做单文件 exe 之前必须跑）：Node SEA 打一个 hello-world，看这台机器的 SAC 拦不拦。**别在未跑实验前投入打包链路**
- [ ] 未做且刻意不做：目录服务器 / 账号 / 好友 / 段位 / 匹配 / 反作弊仲裁 / 自动写防火墙规则

## 关键约束与注意事项

- **接缝闸门必须保持绿**：`bash tools/check-seam.sh` 扫 `packages/*/src` 里的玩法词与 `games/` import。重构中最容易发生的退化就是"顺手把旧 `room.js` 搬过来"，这条是唯一的机械防线。**不要在闸门里加例外**（例外一旦存在就形同不存在）；平台代码的注释也不要提旧游戏名字，历史来源写在本档案里。
- **revision 不变式**：任何可见状态变更都要推进 revision（`Room.addSeat/removeSeat/attach/detach/pushChat/bump` 已内置）。新加变更点时忘了 bump 的表现是"客户端收到了却不更新"，排查成本很高——本会话就是靠端到端测试抓到这个 bug 的。
- **出站目标在创建时解析成 connIds**：任何"先改会话表再投递"的写法都会让最后一条通知丢掉（`hostClose`、`shutdown` 两处踩过）。新增广播入口时用 `Engine.toRoom/toSeat`，别自己拼 target。
- **游戏侧红线**：不许直接持有 socket、不许改 `Room.phase`/座位表、不许把玩法错误码塞进平台错误码（走 `event`）。`Effect` 是唯一的对外出口。
- **玩家端绝不写 `data/`**：权威只有一份才说得清谁是房主。`Engine.persistable/syncStore/restoreFrom` 只允许 `hostd host` 模式调用。
- **明文票据不落盘**：盘上只有 `secretHash` 摘要；房间密码同理（`RoomExport.secretHash`），不存的话重启后密码房变公开房。
- **`HostStore.fileFor` 卡死房号字符集**：文件名来自磁盘内容，不做校验就是路径注入面。
- **不可逆 / 高危动作清单**（任何实现细节都不许顺带触发）：① 写 Windows 防火墙入站规则；② 建议用户关闭 Smart App Control（关掉后不重装系统无法再开）；③ `force push`。
- **混合内容方向性**：`http://127.0.0.1` 页面可连 `ws://`（局域网房主）与 `wss://`（隧道房主）；`https://` 页面连 `ws://` 会被浏览器拦。本地壳页面必须是 http。
- 环境事实：本机 Smart App Control = `On`（`VerifiedAndReputablePolicyState=1`），官方 `node.exe` 签名有效；node v24.19.0 / npm 11.17.0；registry 可达；无全局 `tsc`（走 `npx tsc -b`）；in-app Browser **无可见视口**，UI 类改动只能 `evaluate_script` + `take_snapshot` 核结构。
- 测试写法：`node --test` 跑目录参数在 Windows 下不可靠，**必须用引号包住的 glob**（`node --test "packages/*/test/*.test.mjs"`），并带 `--test-timeout`，否则未决的 await 会让整轮挂死。测试里"等一条消息"要用 predicate 等**符合条件的那一帧**，在途的旧快照会先到。
- **版本管理**：本目录已 `git init`（本地仓库，提交 `a606f33`，**无远程、未 push**）。P7 引入 `.bat` 双击入口时要一并加 `.gitattributes`——`.bat` 必须 CRLF，否则双击行为异常且 diff 一片红。
- 收工跑 `bash /d/agent_workspace/tools/check-docs.sh`（**不加管道**，`[链]`/`[期]` 是失败项），exit 0 才算收尾。

## 变更记录

- 2026-10-10 Qoder：**目录改名 `game-host-platform` → `3178-battle-platform`，并由评估档转为实施档**（用户指令：本会话就在本目录继续开发对战平台）。同时改判两项：计划 D2「代码落新目录 battle-platform」作废，代码就落本目录；D6「房间列表/大厅」用户不接受"只做地址簿 + 邀请链接"，要求**尽量贴合 war3 的房间设计**，发现层级改为 B+A（见 README「房间形态」）。顺带修掉本档 4 处 `[链]` 违规。
- 2026-10-10 Qoder：**开工 P0–P5，交付平台内核第一版**（用户"选 B+A，其他默认，直接开工"）。新建 npm workspaces + TS 工程（`tsc -b` 项目引用、`node --test`），`packages/protocol`（消息目录/错误码/握手/稳定摘要/形状闸门）、`packages/server`（`Engine` 引擎、`Room` 座位与 revision 不变式、`authority` 权限集中处、`HostStore` 房主侧落盘、`WsTransport`、`discovery` 组播信标、`loader` 运行时动态加载）、`games/echo` + `games/turncount` 两个形状不同的合成游戏。测试 57 例全绿：19 例契约套件用**同一组断言**跑两个游戏，4 例真 socket 端到端跨游戏换房，含落盘重启后旧票据回座。**修掉两个实现缺陷**：① 出站按房间寻址会在 `hostClose`/`shutdown` 清空会话表后丢掉最后一条通知 → 改为创建时即解析 connIds；② 入座/连接/聊天不推进 revision → 按版本号去重的客户端会把新状态当重复帧丢弃。新增 `tools/check-seam.sh`（平台包禁玩法词与 `games/` import）。改名遗留：本档与 [uno-online/CONTEXT.md](file:///D:/agent_workspace/uno-online/CONTEXT.md)、[uno-online/README.md](file:///D:/agent_workspace/uno-online/README.md) 内引用已全部替换为新名（uno-online 那两处经用户授权后修改，其工作树现为未提交状态）。

## 给下一个 agent 的追加区

（后续会话请在此追加一行 `- YYYY-MM-DD <来源>：<结论/改动/遗留问题>`，或直接更新上面各节）

**开工顺序建议**：先 P6 客户端 SDK（`packages/client`，地址可配 + 票据 + 地址簿 + 屏幕骨架），因为 P7 `hostd` 与 P8.5 模块下发都要挂在它身上；P6 完成后立刻做一次"本机两个浏览器页面对打"的联调，再谈 R1 打包。**组播发现必须双机实测**，单机仓库里只能证伪编解码。参考入口：README 的阶段表 → 本档案「关键约束」→ [engine.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/engine.ts)。
