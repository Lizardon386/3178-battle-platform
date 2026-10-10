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

**P0–P7 完成（P8.5 通道已通、游戏自带界面未做），`npm test` 87/87 全绿；`tools/check-seam.sh` 零命中；界面在 in-app Browser 里真点过三遍。** 表现层底座已换成 `@tabler/core` + `@tabler/icons-webfont`（MIT，从 node_modules 同源挂 `/vendor/`）。代码全部在本目录，`uno-online` 的代码未动一行（HEAD 仍是 `e9ad2cc`，只有两档文档因改名被授权修改，仍是未提交状态）。

浏览器实测（`hostd host --port 3289 --no-lan`，页面内 `evaluate_script` 驱动，in-app Browser 无可见视口所以不截图）走过的路径：大厅取到 `/api/games` 两个游戏 → 建房坐 1 号位 → 客人 ws 入座 2 号、观战入 901 → 加电脑位 → 未准备时开局按钮写"等准备：客人乙"且 `disabled` → 客人准备后变"开始对局" → 开局后牌桌区渲染按视角裁剪的状态、倒计时 `剩 58 秒 → 剩 56 秒`（服务端时间轴生效）→ 房主点"离开房间"被中文提示挡住 → 踢观战生效 → 移交后 👑 跳到 2 号位、房主面板自动隐藏、通知条"房主已移交给 客人乙" → 此后离席成功回到大厅。

| 已交付 | 位置 | 凭据 |
|---|---|---|
| 协议包（消息目录、错误码、握手、稳定摘要、形状闸门） | [packages/protocol/src](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/src/wire.ts) | [protocol.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/protocol/test/protocol.test.mjs) 9 例 |
| 座位模型 + 房主权限 + 票据 + Ready 闸 | [room.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/room.ts) / [authority.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/authority.ts) | [room-authority.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/room-authority.test.mjs) 14 例 |
| `GameModule` 契约 + `echo`/`turncount` + 同一断言集跑两游戏 | [module-api.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/module-api.ts) / [engine.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/engine.ts) | [contract.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/contract.test.mjs) 19 例 |
| ws 传输、限流、Origin 策略、心跳、真 socket 双游戏 | [transport.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/transport.ts) | [ws-live.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/ws-live.test.mjs) 4 例 |
| 房主侧落盘/恢复（原子写、版本闸、票据幸存、坏文件不挡启动）+ 局域网组播信标（编解码/过期表；真网卡未实测） | [store.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/store.ts) / [discovery.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/discovery.ts) | [store-discovery.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/server/test/store-discovery.test.mjs) 11 例 |
| 客户端 SDK + 房间界面（地址可配、地址簿、票据、退避、校时、槽位、聊天、房主面板、邀请链接） | [packages/client/src/app.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/app.ts) | [client-logic.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/client/test/client-logic.test.mjs) 12 例 + 上面的浏览器实测 |
| 宿主壳 host/join/diagnose/stop + 静态路由 + 双击入口 | [packages/hostd/src/cli.ts](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/src/cli.ts) | [hostd-http.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/hostd-http.test.mjs) 6 例（含路径穿越与真 ws） |

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
- [x] P6 客户端 SDK 与房间界面骨架：地址可配、地址簿、票据、指数退避、`serverNow` 校时、错误码→UI、四个屏幕、邀请链接解析
- [x] P7 `hostd` 宿主壳：`host`（引擎 + ws + 静态 + 组播广播 + 可选隧道 + 邀请链接）、`join`（本地壳：静态页 + 组播监听 + `/discovery/rooms`）、`diagnose`、`stop`；不写防火墙规则
- [~] P8.5 游戏模块下发：`/api/games`、`/games/<id>/*`(CORS)、客户端 sha256 校验 + blob 导入已通；**游戏自带界面还没有**，两个合成游戏走占位渲染
- [ ] P8 把 uno 接成第一个真游戏（`uno.js` 规则包成 `GameModule`，**不动 uno-online**）
- [ ] 给真游戏写沙箱挂载：`sandbox=allow-scripts` 的 iframe，不给 `allow-same-origin`，否则房主能读玩家本机票据
- [ ] 双机实测组播发现：同 WiFi 下两台机器能否互相看见；首次绑定的防火墙弹窗行为
- [ ] 双机实测隧道：`--tunnel` 需要本机装了 cloudflared，本会话未验证过一条真隧道
- [ ] R1 绿色便携包：官方签名 `node.exe` + `dist/` + `games/` + 快捷方式，干净目录双击开局
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
- **`fetch` 不能存成字段再 `this.fetchImpl(...)` 调用**：浏览器里接收者变成 app 对象，直接 `Illegal invocation`，而且如果外面包了静默 `catch` 就表现为"局域网列表永远空白"。要么裸调用，要么箭头包一层（见 `app.ts` 构造函数注释）。同类坑：任何注入的宿主方法都别指望 `this.x()` 保留接收者。
- **Windows 上 `child.kill('SIGTERM')` 是硬杀（TerminateProcess），不走信号处理器**：所以房主端优雅收尾只在真人按 Ctrl+C / `hostd stop` 的路径上成立。测试里不能靠 kill 断言 `run.json` 被删，要断言"`run.json` 留下了、`stop` 子命令把它收掉"。
- **`server.close()` 在有 keep-alive/WS 连接时回调不触发**：收尾要 `closeAllConnections()` + 超时竞速，否则停服流程挂在半路（`transport.close()` 同样必须先 `terminate()` 再 `close()`）。
- **`.bat` 编码不变式**：UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`，中文只出现在 chcp 之后。原因是 cmd 按 cp936 解析 UTF-8 时，汉字的第二字节会落进 GBK trail 区（含 `|`），**把中文拼成命令分隔符**，表现为"系统找不到指定的路径"+ 一行乱码（本会话真踩过，用户截图回来的）。另一个坑：**Git Bash 的 argv 路径转换会把 `nul` 改写成 `/dev/null`**，所以 `node -e '...'` 内联生成批处理会写坏文件——必须走 `tools/gen-bat.mjs`，并由 `packages/hostd/test/bat-entries.test.mjs` 钉住。
- **UI 验证方式**：in-app Browser 无可见视口，不能截图/像素点击；用 `navigate_page` + `evaluate_script` 驱动 DOM（`.click()`、原生 `WebSocket` 当第二个玩家），观感仍需人工确认。
- 环境事实：本机 Smart App Control = `On`（`VerifiedAndReputablePolicyState=1`），官方 `node.exe` 签名有效；node v24.19.0 / npm 11.17.0；registry 可达；无全局 `tsc`（走 `npx tsc -b`）。
- 测试写法：`node --test` 跑目录参数在 Windows 下不可靠，**必须用引号包住的 glob**（`node --test "packages/*/test/*.test.mjs"`），并带 `--test-timeout`，否则未决的 await 会让整轮挂死。测试里"等一条消息"要用 predicate 等**符合条件的那一帧**，在途的旧快照会先到。
- **版本管理**：本目录已 `git init`（本地仓库，提交 `a606f33`，**无远程、未 push**）。P7 引入 `.bat` 双击入口时要一并加 `.gitattributes`——`.bat` 必须 CRLF，否则双击行为异常且 diff 一片红。
- 收工跑 `bash /d/agent_workspace/tools/check-docs.sh`（**不加管道**，`[链]`/`[期]` 是失败项），exit 0 才算收尾。

## 变更记录
- 2026-10-10 Qoder：**目录改名 `game-host-platform` → `3178-battle-platform`，并由评估档转为实施档**（用户指令：本会话就在本目录继续开发对战平台）。同时改判两项：计划 D2「代码落新目录 battle-platform」作废，代码就落本目录；D6「房间列表/大厅」用户不接受"只做地址簿 + 邀请链接"，要求**尽量贴合 war3 的房间设计**，发现层级改为 B+A（见 README「房间形态」）。顺带修掉本档 4 处 `[链]` 违规。
- 2026-10-10 Qoder：**开工 P0–P5，交付平台内核第一版**（用户"选 B+A，其他默认，直接开工"）。新建 npm workspaces + TS 工程（`tsc -b` 项目引用、`node --test`），`packages/protocol`（消息目录/错误码/握手/稳定摘要/形状闸门）、`packages/server`（`Engine` 引擎、`Room` 座位与 revision 不变式、`authority` 权限集中处、`HostStore` 房主侧落盘、`WsTransport`、`discovery` 组播信标、`loader` 运行时动态加载）、`games/echo` + `games/turncount` 两个形状不同的合成游戏。测试 57 例全绿：19 例契约套件用**同一组断言**跑两个游戏，4 例真 socket 端到端跨游戏换房，含落盘重启后旧票据回座。**修掉两个实现缺陷**：① 出站按房间寻址会在 `hostClose`/`shutdown` 清空会话表后丢掉最后一条通知 → 改为创建时即解析 connIds；② 入座/连接/聊天不推进 revision → 按版本号去重的客户端会把新状态当重复帧丢弃。新增 `tools/check-seam.sh`（平台包禁玩法词与 `games/` import）。改名遗留：本档与 [uno-online/CONTEXT.md](file:///D:/agent_workspace/uno-online/CONTEXT.md)、[uno-online/README.md](file:///D:/agent_workspace/uno-online/README.md) 内引用已全部替换为新名（uno-online 那两处经用户授权后修改，其工作树现为未提交状态）。
- 2026-10-10 Qoder：**P6 客户端 + P7 宿主壳，界面在浏览器里跑通**。`packages/client`（地址解析 / 地址簿+票据 / 指数退避 / 服务端时间轴 / 帧归约 / 模块下发与 sha256 校验 / 大厅+房间内+对局三层界面）与 `packages/hostd`（host/join/diagnose/stop、静态与接口路由、cloudflared 解析、`房主建房.bat` + `玩家本机壳.bat` 双击入口 + `.gitattributes` 锁 CRLF）。测试从 57 涨到 **77 例全绿**（新增 12 例客户端逻辑 + 6 例宿主壳集成，含路径穿越与真 ws）。**修掉四个真实缺陷**：① `this.fetchImpl(...)` 丢接收者 → 浏览器 `Illegal invocation`，表现为局域网列表永远空白，且被静默 `catch` 吞掉（现在把原因写进提示）；② `safeJoin` 用正斜杠比前缀，Windows 上 `resolve` 给反斜杠 → `/app/`、`/games/` 全部误判越界 404；③ `server.close()`/`wss.close()` 在有 keep-alive 与 WS 连接时回调不触发 → 收尾挂死，改 `closeAllConnections()` + 超时竞速、`terminate()` 先行；④ 客户端 `until('snapshot')` 拿到的是在途旧帧 → 测试助手改成带 predicate 等"符合条件的那一帧"。**验证方式**：in-app Browser 无可见视口，用 `evaluate_script` 真点：建房→客人入座→观战入座→加电脑位→未准备时开局按钮写明"等准备：客人乙"并 `disabled`→准备后变亮→开局后倒计时 58→56 秒（服务端时间轴生效）→房主离席被中文提示挡住→踢观战→移交后 👑 换位、房主面板隐藏、通知条正确→离席回大厅。
- 2026-10-10 Qoder：**界面视觉重做，按用户要求改用官方 skill `frontend-design`（已安装并启用）而不是我自己的审美**。方向「冰封指挥台」：单一主色（深冰蓝黑）+ 一处黄铜强调 + 就绪翡翠/风险铁锈，房号·槽位号·倒计时统一等宽数字，面板用双层斜面 + 斜切铭牌标题条，载入做成分层阶梯浮现，主按钮一条慢扫光，`prefers-reduced-motion` 全关。**为离线与老浏览器做了两个取舍**：不引外网字体（内网双击是可用的前提，层次靠字阶字距撑）；不用 `@layer`（未知 at-rule 会让老 Chromium/Edge 把整块样式一起跳过 → 整站裸奔）。**顺带修掉一处从未生效的 bug**：`style.css` 里写的是 `.seat-ready/.seat-me/.seat-offline`，而 `app.ts` 发的类名是 `is-ready/is-me/is-offline`，所以"已准备/我的座位/离线"三种状态在上界版本里根本没有样式——实测计算样式已命中（房主行黄铜轨 + 白字粗体 + "你"角标、就绪行翡翠轨、观战行石板轨、空位斜织）。浏览器复核 `document.styleSheets` 108 条规则解析通过，控制台只剩预期内的 `/games/echo/client.js` 404（占位渲染路径）。**像素级观感仍未确认**（in-app Browser `innerWidth/innerHeight` 报 0，无可见视口），要用户自己打开看一眼。
- 2026-10-10 Qoder：**用户仍不满意，改从 GitHub（skills.sh）找能力**：搜到并（经用户点选）安装 `nextlevelbuilder/ui-ux-pro-max-skill@ui-styling`，按它做 v2 视觉。取用的三层：CSS 变量主题层、`references/canvas-design-system.md` 的构成原则（≤5 语义色、字号巨大反差、"参考刻度"式重复结构、第二遍只磨不加）、以及它 `canvas-fonts/` 里的 OFL 字体——**BigShoulders 做展示体、Geist Mono 做 HUD 数字，拷进 `public/fonts/` 同源分发（372KB + 许可文本）**，这才补上 v1 的妥协（离线不能用外链字体）。它的 shadcn/Tailwind 组件层与"无 React、无打包"冲突，明确弃用；两个 python 脚本一个没跑。连带改动：`app.ts` 席位行改成 `seat-slot/seat-name/seat-state` 三段（仍 `createElement`+`textContent`，昵称绝不进 innerHTML），房号独立成 `.hud-code` 铭牌；`webroot.ts` 补 `.ttf/.otf/.woff2` 的 MIME；测试新增"CSS 引用的字体文件必须在盘上 + 只准同源 `/fonts/` + 禁 `@import`/外链/`@layer`"，总数 **82/82**。**浏览器复核**：`document.fonts` 四个 face 全部加载、房号用 BP Display 渲染、名册三段结构正确、控制台只剩预期内的 `/games/echo/client.js` 404。**顺带确认一处设计生效**：页面点"加入"时命中了本机存的房号票据，直接 `seatResume` 回到主座（"准备"因此落在 1 号位），是预期行为不是 bug。**观感结论仍归用户**（in-app Browser 无可见视口）。
- 2026-10-10 Qoder：**修用户双击 `房主建房.bat` 报的"系统找不到指定的路径"+ 乱码**。根因不是 node 缺失，是我把 UTF-8 中文写进了按 cp936 解析的批处理：汉字第二字节落进 GBK trail 区（含 `|`），**中文被拼成命令分隔符**，`||` 分支被打断后才误打"没找到 node"。修法：`@echo off` → `>nul chcp 65001` → 中文只出现在其后，UTF-8 无 BOM + CRLF；生成逻辑收进 [tools/gen-bat.mjs](file:///D:/agent_workspace/3178-battle-platform/tools/gen-bat.mjs)（顺带发现第二个坑：Git Bash 的 argv 路径转换会把 `nul` 改写成 `/dev/null`，所以不能用 `node -e` 内联生成 .bat）。新增 [bat-entries.test.mjs](file:///D:/agent_workspace/3178-battle-platform/packages/hostd/test/bat-entries.test.mjs) 钉住这些不变式。**实测**：`cmd //c 房主建房.bat` 正常起房主端、横幅中文无乱码、无"找不到路径"；`npm test` **85/85**，接缝与双档闸门均过。
- 2026-10-10 Qoder：**表现层换成成熟底座 @tabler/core（用户从 8 张效果图里点了方向 C），并把尺度整体放大一档**。做法：`webroot.ts` 新增 `/vendor/tabler/` 与 `/vendor/tabler-icons/` 两条同源路由（从 `node_modules` 直读，不把 635KB 产物复制进仓库，许可与版本跟着包走）；`index.html` 全面改用 Tabler 的 `page/card/form-*/btn/badge/list-group` 结构，**所有 id 一个没动**（app.ts 按 id 绑定）；`style.css` 缩成一层主题（覆盖 `--tblr-*` 变量 + 席位名册 + HUD + 动效），字号 16.5px / 控件 52px / 席位行 66px / 房号 56px 展示体；席位身份符号从 emoji 换成图标字体（`ti-crown/ti-robot/ti-eye/ti-circle-check`），`seatLabel` 因此改成纯文案悬浮。**测试抓到两个真 bug**：① 重写时丢了 `.hidden { display:none }`，而 app.ts 靠它切屏 → 大厅与房间会同时显示（Bootstrap 5 已不再提供该类）；② "已准备"的翡翠左轨被后面的角色规则按同特异度覆盖 → 改用 `.seat.is-ready` / `.seat.seat-host` 靠特异度定优先级，不靠书写顺序。守卫测试相应放宽为"类名可以来自我们的 css 或 Tabler 底座"，并新增 `.hidden` 与字体令牌两条断言。**浏览器实测**：三张样式表 3557/5249/101 条规则全部加载、`document.fonts.check('18px "tabler-icons"')` true、切屏正确、房主轨黄铜 / 已准备轨翡翠 / 状态文案齐、开局闸解锁，控制台只剩预期内的 `/games/echo/client.js` 404。**新底线**：Tabler 用 oklch → 需要 Chrome/Edge 111+，已写进 README 限制；便携包要带 node_modules 或预拷两个 dist。测试 **87/87**。

## 给下一个 agent 的追加区

（后续会话请在此追加一行 `- YYYY-MM-DD <来源>：<结论/改动/遗留问题>`，或直接更新上面各节）

**下一步顺序建议**：① **P8 把 uno 接成真游戏**——这是唯一能证伪"契约够不够宽"的检验（No Mercy 规则有碰/接龙/质疑/弃牌阶段，比两个合成游戏刁钻得多），做完 `tools/check-seam.sh` 必须仍然零命中；② 接真游戏前先把**沙箱挂载**补上（`sandbox=allow-scripts` 的 iframe，不给 `allow-same-origin`），否则房主可向玩家浏览器注入可读票据的代码；③ **双机实测**组播发现与隧道，本会话只在一台机器上证伪了编解码与 HTTP 路由；④ R1 绿色便携包（官方 `node.exe` 随包走）。**别先去弄单文件 exe**：SAC 实验还没跑，且就算通过也不解决别人机器的问题。
参考入口：README 阶段表 → 本档案「关键约束」→ [engine.ts](file:///D:/agent_workspace/3178-battle-platform/packages/server/src/engine.ts) 与 [app.ts](file:///D:/agent_workspace/3178-battle-platform/packages/client/src/app.ts)。双击入口是 `房主建房.bat` / `玩家本机壳.bat`，改它们要记得 CRLF。
