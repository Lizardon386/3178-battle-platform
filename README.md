# 3178-battle-platform · 设计思路与使用说明

> 面向使用者：这是什么、为什么这么设计、怎么用。玩法商标一律不出现，这是平台不是某个游戏的联机版。
> 任务进度、遗留问题与 agent 交接记录见同目录 [CONTEXT.md](file:///D:/agent_workspace/3178-battle-platform/CONTEXT.md)。
> 最近更新：2026-10-10
<!-- 日期必须留在这行 blockquote 上：check-docs.sh 的 [新]/[旧]/[期] 只读这一行，正文里写日期不算顶部日期。 -->

## 一句话说明

**游戏无关的宿主制联机对战平台内核**：每人本机一份可双击的客户端，房主建房当服务器，别人从局域网房间列表或邀请链接进房——war3 对战平台那个形状。房间、座位、房主权限、Ready、聊天、观战、AI 填充位、掉线宽限、版本闸、落盘、传输都在 `packages/`；具体玩法通过一个 `GameModule` 契约插进来，仓库里已带两个形状完全不同的合成游戏（`games/echo`、`games/turncount`）用来证明这层契约真的无关玩法。

被剥离的来源是同工作区的 [uno-online](file:///D:/agent_workspace/uno-online/README.md)：它的连接模型与牌类规则长在同一个类里，本平台把连接/身份/分发这一侧独立重写，**uno-online 的代码一行没动**。

## 设计思路

| 决策 | 理由 | 代价 |
|---|---|---|
| **TypeScript（Node ESM）编译后跑在官方签名 `node.exe` 上**，不自建单文件 exe | 本机 Smart App Control 实测为强制（注册表 `VerifiedAndReputablePolicyState=1`），未签名 exe 被拦且**没有"仍要运行"**；官方 `node.exe` 签名有效。Go/Rust/Electron 都要自带未签名二进制，在这台机器上是死路 | 交付物是"一个文件夹 + 快捷方式"，观感不像正经客户端；要单文件得先买代码签名证书 |
| **平台与玩法只经由 `GameModule` 契约通信**，平台源码内禁止出现任何玩法词（`tools/check-seam.sh` 当闸门） | 旧代码 `Room` 同时是座位管理器和规则引擎，回合游标被规则与 eject 两边改；不立字据的"分层"下一次重构就又被穿透 | 加一个游戏要写 manifest/normalizeConfig/create/resume 一套接口，比在旧代码里加个字段麻烦 |
| **引擎与传输分离**：`Engine` 只吐 `Outbound[]`，`WsTransport` 负责 socket | 证明"无关玩法"的契约测试不需要真端口、真网卡，毫秒级跑完 57 个用例；真 socket 另有一套端到端测试兜底 | 出站投递要显式 `publish()`，多一层心智负担 |
| **出站目标在创建时就解析成具体连接**（`Target.connIds`） | 关房与进程退出会先清会话表再投递，按"房间"寻址会让最后一条通知凭空消失——测试就是这么抓出来的 | 消息一旦生成就不能靠后续房间状态寻址 |
| **座位带 `slot / team / role / ready`，但颜色和队伍语义归游戏** | war3 的队伍/颜色本来就是地图自定义的；平台只需要知道"这是几号位、谁准备没准备、谁观战谁是电脑" | 客户端要渲染队伍得去读 `game` 里的自定义字段 |
| **游戏不许碰 socket，只能返回 `Effect[]`**（broadcast/toSeat/notice/system/end/kick） | 一旦游戏能直接发帧，投递、限流、视角、审计就各走各的；平台侧的"每次状态变更必须推进 revision"也守不住 | 游戏要做的动作得先设计成 Effect，跨端事件名没有集中枚举 |
| **`revision` 由 `Room` 的每个变更点自动推进**（入座/连上/断开/离座/聊天都算） | 客户端按 revision 去重。不推进的话新快照会被当重复帧丢掉，观感是"人进了房但桌上没显示" | 聊天这类高频事件也会推版本号，客户端不能拿它当"开局才变"的信号 |
| **入席下发票据，`seatResume` 必须带票据** | 旧项目 `rejoin` 只要猜中房号+座位号就能占座（座位 id 是 6 位 base36）；盘上只存摘要，拿到快照文件也占不了座 | 票据丢了（清浏览器数据）就只能重新入座，旧座位要等宽限到期 |
| **`deadline` 一律下发相对毫秒 + `serverNow`** | 旧客户端拿本地 `Date.now()` 比服务端的绝对时间戳，两台机器时钟不齐时倒计时直接失真 | 客户端要维护一个单调钟外推，UI 逻辑多一步 |
| **房间发现走 B+A 两档**：同网段 UDP 组播信标（要本地壳）+ 地址簿/邀请链接（纯浏览器也能用） | 房间列表在 war3 里由战网中央目录提供；没有常开公网节点就没有"随时上线逛房间"。组播是唯一不需要公共服务器的实时列表 | 组播只限同网段，且首次绑定会让 Windows 弹窗（由用户亲手点允许，脚本绝不写防火墙规则）；跨网只能靠房主发链接 |
| **落盘只发生在房主机**，玩家端不写 `data/` | 每个客户端都有自己的快照目录时，"谁是权威"就说不清了 | 房主机器关机=这局没了，这是宿主制而不是分布式 |
| **同时做两个合成游戏，而不是先接一个真游戏** | "平台无关玩法"是不可证的口号，除非有第二个形状不同的游戏。`turncount` 连回合游标都没有 | 多写约 300 行测试用游戏代码，但这是本轮最便宜的证据 |

## 快速开始

```bash
cd /d/agent_workspace/3178-battle-platform
npm install          # 只装 typescript / @types/node / @types/ws / ws
npm test             # 编译 + 57 个用例（含真 socket 端到端）
bash tools/check-seam.sh           # 平台包与玩法零耦合
bash /d/agent_workspace/tools/check-docs.sh 3178-battle-platform   # 双档合规
```

当前**还不能双击开局**：`packages/client`（浏览器 SDK 与房间界面）与 `packages/hostd`（宿主壳）在待办里，见 [CONTEXT.md](file:///D:/agent_workspace/3178-battle-platform/CONTEXT.md) 的阶段表。

## 使用说明

### 阶段状态

| 阶段 | 内容 | 状态 | 验收凭据 |
|---|---|---|---|
| P0 | monorepo + TS 构建 + `node --test` + 接缝闸门 | 已完成 | `npm test` exit 0；`check-seam.sh` 零命中 |
| P1 | 协议包：消息目录、错误码、握手、`rulesHash` 稳定摘要 | 已完成 | [protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) 9 例 |
| P2 | 座位模型与房主权限：`hostId`、票据、Ready 闸、kick/transfer/close | 已完成 | [room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) 14 例 |
| P3 | `GameModule` 契约 + 两个合成游戏 + 契约测试 | 已完成 | [contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) 19 例（同一断言集跑两个游戏） |
| P4 | 传输（ws/限流/Origin/心跳）、房间聊天、局域网信标 | 已完成（信标未实测） | [ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) 4 例；[store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) |
| P5 | 房主侧落盘与恢复：原子写、版本闸、票据幸存 | 已完成 | 同上：重启→恢复→旧票据回座；坏文件不挡启动 |
| P6 | 客户端 SDK 与房间界面骨架（地址可配、地址簿、槽位/聊天/列表） | **未开始** | — |
| P7 | `hostd` 宿主壳（host/join/组播浏览/邀请链接/诊断） | **未开始** | — |
| P8.5 | 游戏模块从房主下发（缺模块时拉 bundle + 哈希校验） | 未开始 | — |
| R1 | 绿色便携包（官方 `node.exe` + 代码 + 快捷方式） | 未开始 | — |

### 接一个新游戏要写什么

实现 [module-api.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/module-api.ts) 的 `GameModule`，共七个成员：`normalizeConfig` / `rulesHashOf` / `create` / `resume` / `serialize(viewer)` / `handle(action, by)` / `begin()`，可选 `tick` / `onSeatJoin` / `onSeatLeave` / `onTimeout` / `acceptsSnapshot`。放进 `games/<id>/`，构建产物落在 `games/<id>/dist/index.js`，房主端由 [loader.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/loader.ts) 在运行时按 id 动态加载——**平台源码不 import 它**。参考实现：[games/echo/src/index.ts](file:///D:/agent_workspace/3178-battle-platform/games/echo/src/index.ts)（回合制 + 隐私）与 [games/turncount/src/index.ts](file:///D:/agent_workspace/3178-battle-platform/games/turncount/src/index.ts)（无游标 + 无隐私 + 同时操作）。

### 线协议速查

| 方向 | 消息 | 要座位 | 要房主 |
|---|---|---|---|
| C→S | `hello` / `roomCreate` / `roomJoin` / `seatResume` / `resync` / `ping` | 否 | 否 |
| C→S | `ready` / `gameAction` / `chat` / `seatLeave` | 是 | 否 |
| C→S | `hostStart` / `hostClose` / `hostKick` / `hostTransfer` / `hostSeat` | 是 | **是** |
| S→C | `welcome` / `seatGranted` / `snapshot` / `event` / `chat` / `notice` / `error` / `pong` | — | — |

完整字段与中文错误码文案在 [wire.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/wire.ts) 与 [codes.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/codes.ts)。

### 已定语义（沿用上一轮拍板，未改）

| 事项 | 结论 |
|---|---|
| 只有房主能开局 / 踢人 / 关房 / 移交 | 是，越权分别报 `NOTHOST` / `HOSTONLY` |
| 房主主动离开 | 弹窗二选一：直接关局 / 移交房主。平台侧表现为 `seatLeave` 被拒并提示"先移交或关房" |
| 移交 | 只转移权限，进程仍在原房主机；原房主再发命令报 `HOSTONLY` |
| 房主进程退出/崩溃 | 无法弹窗 → 广播 `HOSTLEFT` 并删局 |
| 玩家主动离座 | 立刻离座，不触发终局 |
| 掉线 | 对局中保留座位 30 分钟（可配），超时收回；**房主**掉线过久直接终局 |
| 加入方式 | 4 位房号（去掉易混字符）+ 房主地址；版本/房规不符报 `VERSION` / `RULES` 挡在门外 |
| 房间列表 | 局域网组播实时列表（需本地壳）+ 地址簿 + 邀请链接；不做目录服务器 |

## 产物与目录

| 文件 | 用途 |
|---|---|
| [README.md](file:///D:/agent_workspace/3178-battle-platform/README.md) | 本档案：设计取舍、阶段状态、协议速查 |
| [CONTEXT.md](file:///D:/agent_workspace/3178-battle-platform/CONTEXT.md) | 交接档案：当前状态、待办、坑与不可逆操作 |
| [package.json](file:///D:/agent_workspace/3178-battle-platform/package.json) | npm workspaces 与 `build/test/seam` 脚本 |
| [tsconfig.json](file:///D:/agent_workspace/3178-battle-platform/tsconfig.json) / [tsconfig.base.json](file:///D:/agent_workspace/3178-battle-platform/tsconfig.base.json) | 项目引用（`tsc -b`）与共享编译选项 |
| [tools/check-seam.sh](file:///D:/agent_workspace/3178-battle-platform/tools/check-seam.sh) | 接缝闸门：平台包内不得出现玩法词或 `games/` import |
| [packages/protocol/src/wire.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/wire.ts) | 消息目录与房主命令表（含中文说明的 `MESSAGE_CATALOG`） |
| [packages/protocol/src/codes.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/codes.ts) | 平台错误码与通知码文案 |
| [packages/protocol/src/hash.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/hash.ts) | 稳定摘要（房规/版本闸） |
| [packages/protocol/src/manifest.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/manifest.ts) | `GameManifest` 形状检查与握手比对 |
| [packages/protocol/src/seats.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/seats.ts) | 座位/相位/房间视图与组播条目形状 |
| [packages/protocol/src/guard.ts](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/guard.ts) | 入站消息形状闸门（缺字段/多余字段/超长） |
| [packages/server/src/engine.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/engine.ts) | 引擎：线消息 → 房间/游戏操作 → 出站编排（心跳、终局语义、限流） |
| [packages/server/src/room.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/room.ts) | 座位表、房主标记、聊天环形缓冲、revision、落盘导出/恢复 |
| [packages/server/src/authority.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/authority.ts) | 权限判定集中处：房主/座位/票据/开局闸/加入闸 |
| [packages/server/src/module-api.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/module-api.ts) | `GameModule` / `GameInstance` / `Effect` 契约 |
| [packages/server/src/loader.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/loader.ts) | 运行时按 id 动态加载游戏模块并校验契约 |
| [packages/server/src/transport.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/transport.ts) | ws 薄壳：握手、编码、Origin 策略、心跳 |
| [packages/server/src/store.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/store.ts) | 房主侧原子落盘与坏文件处理 |
| [packages/server/src/discovery.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/discovery.ts) | 局域网组播信标：房主广播、浏览端过期表 |
| [packages/server/src/registry.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/registry.ts) | 房号分配与房间表 |
| [packages/server/src/ids.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/ids.ts) | 房号/座位 id/票据与摘要比对 |
| [games/echo/src/index.ts](file:///D:/agent_workspace/3178-battle-platform/games/echo/src/index.ts) | 合成游戏 A：回合制 + 隐私 |
| [games/turncount/src/index.ts](file:///D:/agent_workspace/3178-battle-platform/games/turncount/src/index.ts) | 合成游戏 B：无游标 + 无隐私 |
| [packages/protocol/test/protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) | 协议与摘要测试 |
| [packages/server/test/room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) | 房主权限/票据/座位模型测试 |
| [packages/server/test/contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) | 两游戏共用同一断言集的契约测试 |
| [packages/server/test/ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) | 真 socket 端到端 |
| [packages/server/test/store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) | 落盘恢复 + 信标编解码 |

## 限制与注意事项

- **还不是可用的桌面客户端**：缺 P6 浏览器 SDK/界面与 P7 `hostd` 宿主壳。现在能跑的是"引擎 + 传输 + 游戏"，靠测试驱动。
- **组播发现未实测**：本工作区只有一台机器，`discovery.ts` 的编解码与过期表有测试，但真网卡上的收发、以及"首次绑定触发 Windows 防火墙弹窗后用户点允许"这条路径**没有验证过**。
- **房主可作弊是宿主制固有代价**，不是 bug；要真防得引入仲裁/relay，那是另一个任务。
- **移交只移权限、不迁进程**：原房主断电时不存在"已移交的房主"。
- **禁止**：写 Windows 防火墙入站规则、建议关闭 Smart App Control（关掉后不重装系统无法再开）、`force push`。
- **混合内容方向性**：`http://127.0.0.1` 页面可以连 `ws://`（局域网房主）也可以连 `wss://`（隧道房主）；反过来 `https://` 页面连 `ws://` 会被浏览器拦。本地壳页面必须走 http。
- **隧道域名每次启动都变**：跨网"记住房主地址"不可靠，A 档的邀请链接才是跨网正路。
- 与 [uno-online](file:///D:/agent_workspace/uno-online/CONTEXT.md) 是同一份玩法的两种演进：玩法改动归那边，连接/身份/分发改动归这里；**不要两边同时动同一份逻辑**。
