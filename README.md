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
| **表现层底座用成熟开源框架 `@tabler/core`（MIT），上面只盖一层纯色扁平主题**：无渐变、无阴影、无动画（框架自带的 transition 也一并归零）；尺度整体放大一档（正文 16.5px、控件 52px、席位行 68px、房号 58px 展示体）；字体换成 **Tektur（展示）+ Outfit（拉丁正文）+ Geist Mono（数字/标签）**，身份符号用同源图标字体 `@tabler/icons-webfont`（皇冠/机器人/眼睛/圆勾，不再堆 emoji），logo 是内联 SVG 几何徽记（菱形套菱形 + 两翼，不再是色块里塞"3178"） | 用户三轮否掉手写 CSS 的观感（"排版小气"、"颜色也丑"），继续手搓只会第四轮返工；方向 C 由效果图选定。Tabler 是成熟面板风，卡片/表单/按钮/徽章/栅格都是别人打磨过的，且它自带 Bootstrap 5、纯 CSS 文件、样式不需要 JS，"无构建 + 离线双击"仍然成立 | **Tabler 的颜色用 oklch → 浏览器底线抬到 Chrome/Edge 111+**（因此我们自己的 CSS 仍不写 oklch，也不写 `@layer`）；`tabler.min.css` 635KB + 图标字体 520KB 从 `node_modules` 挂 `/vendor/` 同源路由（不把产物复制进仓库），**便携包必须带 node_modules 或预拷这两个 dist 目录**；`.hidden` 要自己留着（Bootstrap 5 不再提供）——这条和"左轨靠特异度而不是书写顺序"都由 `style-hooks.test.mjs` 钉住；三套字体约 290KB（Tektur 152KB + Outfit 110KB + Geist Mono 157KB 里取三个文件），中文没有随包（体积与授权都不划算），仍走系统黑体；扁平意味着反馈只靠换色，没有位移/淡入这类动效 |

## 快速开始

双击（推荐给日常使用）：

| 双击 | 干什么 |
|---|---|
| [房主建房.bat](file:///D:/agent_workspace/3178-battle-platform/房主建房.bat) | 弹出一个「3178 房主端」控制台窗口跑房主端，监听 3000，窗口里打印局域网地址与隧道状态；浏览器打开 `http://localhost:3000` 建房 |
| [玩家本机壳.bat](file:///D:/agent_workspace/3178-battle-platform/玩家本机壳.bat) | 弹出一个「3178 本地壳」控制台窗口起本地壳（3178）并自动打开页面：能看局域网房间列表，也能填地址进别人的房；**自己开房玩也可以**，但只绑 127.0.0.1，别人连不进来——要当房主请用左边那个 |

双击的那个窗口**只是启动器**：把 node 开进它自己的控制台窗口后立刻退出，所以你会看到它一闪就没，对局跑在新开的那个窗口里。要停就在**新窗口**里按 Ctrl+C——信号直接给 node，落盘收尾后进程退出，那个窗口自己关闭，**不会问你"终止批处理操作吗(Y/N)"**。反过来，如果 .bat 自己留在前台等 node，Ctrl+C 打断的是批处理，就会多出那句 Y/N。两头都有测试钉着：末行必须是 `exit /b 0`（[bat-entries.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/bat-entries.test.mjs)），SIGINT 之后必须落盘、删掉 `data/run-<端口>.json` 并以 0 退出（[sigint-shutdown.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/sigint-shutdown.test.mjs)）。

缺环境时启动器不会一闪而过：检查 `node` 在不在 PATH、依赖与编译产物在不在，缺了就打印该跑哪条命令并**停在那儿等你看**（这种分支留着 `pause`），不静默装东西、不碰防火墙。

脚本本身由 [tools/gen-bat.mjs](file:///D:/agent_workspace/3178-battle-platform/tools/gen-bat.mjs) 生成（`node tools/gen-bat.mjs`）：批处理对编码极敏感，手写容易踩下面「限制」里那两条坑，所以文案与结构改在生成器里，改完重跑一次。

命令行（开发用）：

```bash
cd /d/agent_workspace/3178-battle-platform
npm install          # typescript / @types/node / @types/ws / ws，没别的
npm run build
npm test             # 95 个用例（含真 socket、宿主壳 HTTP 集成与 SIGINT 收尾）
bash tools/check-seam.sh
node packages/hostd/dist/cli.js host --port 3000 [--tunnel] [--no-lan] [--game echo]
node packages/hostd/dist/cli.js join --port 3178   # 本地壳：也能建房，但只绑 127.0.0.1（别人连不进来）
node packages/hostd/dist/cli.js diagnose     # 打环境事实：node 版本、已装游戏、cloudflared、网卡、在跑的壳
node packages/hostd/dist/cli.js stop [--port N]   # 按 data/run-<端口>.json 精确收尾，不按镜像名杀 node；不带 --port 收掉本机所有壳
bash /d/agent_workspace/tools/check-docs.sh 3178-battle-platform
```


## 使用说明

### 阶段状态

| 阶段 | 内容 | 状态 | 验收凭据 |
|---|---|---|---|
| P0 | monorepo + TS 构建 + `node --test` + 接缝闸门 | 已完成 | `npm test` exit 0；`check-seam.sh` 零命中 |
| P1 | 协议包：消息目录、错误码、握手、`rulesHash` 稳定摘要 | 已完成 | [protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) 9 例 |
| P2 | 座位模型与房主权限：`hostId`、票据、Ready 闸、kick/transfer/close | 已完成 | [room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) 14 例 |
| P3 | `GameModule` 契约 + 两个合成游戏 + 契约测试 | 已完成 | [contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) 19 例（同一断言集跑两个游戏） |
| P4 | 传输（ws/限流/Origin/心跳）、房间聊天、局域网信标 | 已完成（信标未双机实测） | [ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) 4 例；[store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) |
| P5 | 房主侧落盘与恢复：原子写、版本闸、票据幸存 | 已完成 | 同上：重启→恢复→旧票据回座；坏文件不挡启动 |
| P6 | 客户端 SDK 与房间界面骨架（地址可配、地址簿、票据、退避、校时、槽位/聊天/房主面板） | 已完成 | [client-logic.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/client/test/client-logic.test.mjs) 12 例 + 浏览器实测（记录见 CONTEXT） |
| P7 | `hostd` 宿主壳：host/join/diagnose/stop + 静态路由 + 邀请链接 + 双击入口 | 已完成（隧道未实测） | [hostd-http.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/hostd-http.test.mjs) 6 例 |
| P8.5 | 游戏模块下发通道：`/api/games` + `/games/<id>/*`(CORS) + 客户端哈希校验 + blob 导入；缺入口时占位渲染 | 通道已通，**游戏自带界面还没有** | 同上：产物可跨源取、穿越被挡 |
| R1 | 绿色便携包（官方 `node.exe` + 代码 + 快捷方式） | 未开始 | — |

### 房间界面能做什么

| 位置 | 房主 | 玩家 | 观战 |
|---|---|---|---|
| 大厅 | 选游戏、房名、座位数、密码、允许观战、隐藏房 → 建房坐 1 号位 | 填房主地址 + 房号进房；地址簿填/忘；局域网列表点一下即进 | 同一入口，勾"以观战身份进" |
| 房间内 | 开局（按钮会写明"等准备：谁"）、加电脑位、移交房主、请出座位、复制邀请链接、关房 | 准备 / 离开 | 只看桌，不能动作 |
| 对局中 | 同上（房主面板一直开着） | 游戏自己的界面挂在牌桌位置 | 同玩家的公开视角 |

房主点"离开房间"会被挡住并提示"要么移交要么关房"——这是 war3 式房主语义，不是防误操作的兜底。

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
| [packages/client/src/endpoint.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/endpoint.ts) | 房主地址解析与邀请链接（含 https 连明文 ws 的拦截提示） |
| [packages/client/src/connection.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/connection.ts) | ws 连接层：指数退避重连、心跳、协议帧校验 |
| [packages/client/src/clock.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/clock.ts) | 服务端时间轴：`serverNow` + 单调钟外推 + 半个 RTT 补偿 |
| [packages/client/src/local-store.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/local-store.ts) | 地址簿、昵称、座位票据保管（按房主 + 房号隔离） |
| [packages/client/src/view-model.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/view-model.ts) | 帧流 → UI 状态归约（revision 去重、聊天环形缓冲、开局阻碍清单） |
| [packages/client/src/module-loader.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/module-loader.ts) | 游戏模块拉取 + sha256 校验 + blob 导入；缺入口时占位渲染 |
| [packages/client/src/app.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/app.ts) | 界面装配：大厅 / 房间内 / 对局挂载点 |
| [packages/client/public/index.html](file:///D:/agent_workspace/3178-battle-platform/packages/client/public/index.html) | 页面骨架与 import map（浏览器原生 ESM，无打包步骤） |
| [packages/client/public/style.css](file:///D:/agent_workspace/3178-battle-platform/packages/client/public/style.css) | 主题层：覆盖 Tabler 变量 + 大气尺度 + 席位名册/HUD/动效（不重写框架组件） |
| [design-refs/](file:///D:/agent_workspace/3178-battle-platform/design-refs/E-cyber-minimal.png) | 八张方向效果图（A–H），选定的是 [C-tabler-dashboard.png](file:///D:/agent_workspace/3178-battle-platform/design-refs/C-tabler-dashboard.png) |
| [packages/client/public/fonts/](file:///D:/agent_workspace/3178-battle-platform/packages/client/public/fonts/Tektur-Medium.ttf) | 同源分发的 OFL 字体：Tektur 展示体 + Outfit 拉丁正文 + Geist Mono 数字，含各自许可文本 |
| [packages/hostd/src/cli.ts](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/src/cli.ts) | 宿主壳：host / join / diagnose / stop 四个模式 |
| [packages/hostd/src/webroot.ts](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/src/webroot.ts) | 静态与接口路由（`/app/`、`/vendor/protocol/`、`/games/`、`/api/games`、`/discovery/rooms`） |
| [packages/hostd/src/tunnel.ts](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/src/tunnel.ts) | cloudflared 查找与隧道网址解析（找不到就退回本地地址，不下载） |
| [房主建房.bat](file:///D:/agent_workspace/3178-battle-platform/房主建房.bat) / [玩家本机壳.bat](file:///D:/agent_workspace/3178-battle-platform/玩家本机壳.bat) | 双击入口（CRLF，由 [.gitattributes](file:///D:/agent_workspace/3178-battle-platform/.gitattributes) 锁住） |
| [tools/gen-bat.mjs](file:///D:/agent_workspace/3178-battle-platform/tools/gen-bat.mjs) | 生成上面两个 .bat，保证编码不变式（UTF-8 无 BOM / CRLF / chcp 先于中文） |
| [packages/hostd/test/bat-entries.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/bat-entries.test.mjs) | 双击入口的编码与结构防呆 |
| [packages/client/test/client-logic.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/client/test/client-logic.test.mjs) | 客户端无 DOM 逻辑测试 |
| [packages/hostd/test/hostd-http.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/hostd-http.test.mjs) | 宿主壳集成测试（真起子进程、真 WS 连接、路径穿越） |
| [packages/hostd/test/sigint-shutdown.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/sigint-shutdown.test.mjs) | Ctrl+C 收尾：SIGINT 后落盘、删 run 记录、退出码 0、端口释放 |
| [packages/hostd/test/shell-join.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/shell-join.test.mjs) | 本地壳也带 WS：建房→加电脑→开局，并按端口各留一份记录 |

| [games/turncount/src/index.ts](file:///D:/agent_workspace/3178-battle-platform/games/turncount/src/index.ts) | 合成游戏 B：无游标 + 无隐私 |
| [packages/protocol/test/protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) | 协议与摘要测试 |
| [packages/server/test/room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) | 房主权限/票据/座位模型测试 |
| [packages/server/test/contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) | 两游戏共用同一断言集的契约测试 |
| [packages/server/test/ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) | 真 socket 端到端 |
| [packages/server/test/store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) | 落盘恢复 + 信标编解码 |

## 限制与注意事项

- **浏览器底线被 Tabler 抬到 Chrome/Edge 111+**：Tabler 的颜色变量用 `oklch()`，更老的内核算不出颜色（表现为按钮发灰、边框消失）。我们自己的 CSS 因此仍不写 `oklch` 与 `@layer`。给旧机器装包之前先确认浏览器版本。
- **底座体积**：`tabler.min.css` 635KB + 图标字体 520KB，从 `node_modules` 挂 `/vendor/` 同源路由（不复制进仓库）。R1 便携包要么带 `node_modules`，要么在打包脚本里预拷 `@tabler/core/dist/css` 与 `@tabler/icons-webfont/dist`。
- **字体随包分发，许可文本不能丢**：`public/fonts/` 里的 Tektur、Outfit、Geist Mono 来自 `ui-styling` skill 的 `canvas-fonts/`，OFL 许可；打包（R1）时必须连 `.ttf` 带 `*-OFL.txt` 一起拷，测试里已经钉住"CSS 引用的字体文件必须存在于盘上"。没有中文字体随包（体积与授权都不划算），中文仍走系统黑体。
- **`.bat` 的编码是硬约束，不是风格问题**：必须 UTF-8 无 BOM + CRLF + 第二行 `chcp 65001`，且中文只能出现在 chcp 之后。否则 cmd 按 cp936 解析 UTF-8 字节，第二个字节落进 GBK trail 区（里面有个 `|`），**中文会被拼成命令分隔符**——表现为平白一句"系统找不到指定的路径"加一行乱码。另一个坑：在 Git Bash 里用 `node -e '...'` 写批处理，argv 里的 `nul` 会被 MSYS 路径转换改成 `/dev/null`，直接写坏文件；所以走 `tools/gen-bat.mjs`，并由 [bat-entries.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/bat-entries.test.mjs) 钉住这些不变式。
- **`.bat` 只做启动器，不留在前台**：`start "标题" node …` 之后立刻 `exit /b 0`，所以双击的窗口一闪就没，进程跑在它自己的控制台窗口里。好处是 Ctrl+C 直接送给 node——落盘收尾后进程退出，窗口自己关，**不问"终止批处理操作吗(Y/N)"**（那句话只在批处理本身被 Ctrl+C 打断时出现）。代价是启动器拿不到 node 的退出码，环境缺失只靠那三条 `if not exist` 拦；失败分支特意留着 `pause`，双击的人看得见原因。
- **"按下 Ctrl+C 会收尾"验证到哪一步**：收尾处理器本身有测试（在壳自己的进程里 `process.emit('SIGINT')`，走同一个监听器：落盘 → 删 run 记录 → 退出码 0 → 端口释放）。但**"Windows 把控制台里的 Ctrl+C 投递成 SIGINT"这一步没法从外部模拟**——本机既不能向别人的控制台发 CTRL_C_EVENT，MSYS 的 `kill -INT` 也只认自己生的进程。那一跳靠的是 Node/libuv 自身的控制台控制处理器（装了 Node 就一直如此工作），不是我写的代码。
- **观感只能由你确认**：in-app Browser 无可见视口（`innerWidth` 报 0），我能证明"字体加载成功、规则命中、DOM 结构对了"，不能证明"好看"。
- **游戏自带界面还没有**：模块下发通道（清单、CORS、哈希校验、blob 导入）已通，但两个合成游戏没有客户端入口，对局区目前走占位渲染（把房主发来的状态原样摊开 + 通用动作按钮）。真游戏的牌桌 UI 属于游戏侧工作。
- **双击能建房，但还不是"发给朋友的那份包"**：R1 绿色便携包（官方 `node.exe` 随包走、对方不装 Node）没做。现在两台机器都要自己装 Node + `npm install` + `npm run build`。
- **组播发现未实测**：本工作区只有一台机器，`discovery.ts` 的编解码与过期表有测试，但真网卡上的收发、以及"首次绑定触发 Windows 防火墙弹窗后用户点允许"这条路径**没有验证过**。
- **从房主拉游戏模块 = 在你浏览器里执行房主给的代码**。哈希校验只保证"传过来的字节和房主声明的一致"，不保证"房主写的代码无害"。今天两个合成游戏没有客户端入口，实际跑的是内置占位渲染器，所以这条风险还没落地；**接真游戏前要把它关进沙箱 iframe（`sandbox=allow-scripts`，不给 `allow-same-origin`）**，否则房主能读你本机的座位票据与地址簿。
- **宿主制天然放弃一部分防作弊**：权威进程在房主机上，房主可改自己的秘密与判定；"按视角裁剪"只防透视，不防房主。
- **移交只移权限、不迁进程**：原房主断电时不存在"已移交的房主"。
- **禁止**：写 Windows 防火墙入站规则、建议关闭 Smart App Control（关掉后不重装系统无法再开）、`force push`。
- **混合内容方向性**：`http://127.0.0.1` 页面可以连 `ws://`（局域网房主）也可以连 `wss://`（隧道房主）；反过来 `https://` 页面连 `ws://` 会被浏览器拦。本地壳页面必须走 http。
- **隧道域名每次启动都变**：跨网"记住房主地址"不可靠，A 档的邀请链接才是跨网正路。
- 与 [uno-online](file:///D:/agent_workspace/uno-online/CONTEXT.md) 是同一份玩法的两种演进：玩法改动归那边，连接/身份/分发改动归这里；**不要两边同时动同一份逻辑**。
