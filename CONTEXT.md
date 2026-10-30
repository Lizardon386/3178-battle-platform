# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-10-30　模式：三档（README / DESIGN / CONTEXT）　锚点：`87baa72`（master）　当前接盘：待接（上一写者 WorkBuddy，已收工）
<!-- 日期要保持 README、DESIGN、INTEGRATION_GUIDE、CONTEXT 顶部同一天。 -->

## 1. 文档目录

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](README.md) | 玩家 / 房主 | 平台概述、运行环境与入口、对局流程、网络连接、数据存储、命令行用法、使用限制 |
| [DESIGN.md](DESIGN.md) | 开发者 / 方案评审 | 设计方向（目标 / 约束 / 验收）、运行模式、核心流程、架构与三处接缝、线协议、构建、关键决策与边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 游戏开发者 / 接入方 | SDK 安装与接入、GameModule/GameInstance/Effect[]、客户端入口、单文件包、回合制边界、game-kit、沙箱限制、版本自检 |
| [CONTEXT.md](CONTEXT.md)（本文） | 维护者 / 交接 agent | 当前状态、下一步、关键约束、验证命令、关键入口、交接记录 |
| [压卡备份.md](压卡备份.md) | 维护者 / 交接 agent | 2026-10-28 压卡前的旧正文：逐阶段验收凭据、历史变更记录、旧追加区 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 测试 / 维护者 | 15 条问题（4 高 / 9 中 / 2 低）、修法、实测证据、猴测台自身 9 个缺陷 |

## 2. 目标与完成定义

做成类 war3 的联机对战平台：房主建房、座位/观战/电脑位、Ready 闸、房主权限与移交、断线重连、落盘恢复、局域网房间发现；游戏以单文件 `.bpmap` 包导入，游戏开发者只依赖 `@lizardon386/game-sdk`。

完成定义：`npm test` 全绿、接缝闸门零命中、`tsc -b` 通过；外部开发者按 INTEGRATION_GUIDE 从零接入能通过 smoke；SDK 四个包可从 npm 安装。

## 3. 现在在哪

**2026-10-30：`npm test` 233/233，`npm run seam` 零命中，`npx tsc -b` 通过，外部消费者 smoke `[smoke] OK`。**

- 平台内核（P0–P7）已交付：协议、座位与房主权限、`GameModule` 契约 + 测试夹具、ws 传输、落盘恢复、客户端界面、hostd 壳（host / join / diagnose / stop）。
- 包边界：`@lizardon386/core-abi`（游戏 ABI）· `@bp/protocol`（wire）· `@lizardon386/pack-format`（.bpmap）· `@lizardon386/game-sdk`（公共门面 + game-kit）· `@lizardon386/sdk-tools`（bpmap CLI / doctor / 模板）。平台包仍是 `@bp/server`、`@bp/client`、`@bp/hostd`、`@bp/testkit`。
- 游戏下发与兼容闸：`/api/games`、`/games/<id>/*`、客户端 SHA-256 校验（无 `crypto.subtle` 时纯 JS 回退）、`sandbox=allow-scripts` iframe；`mode` / `apiVersion` 写入 `.bpmap` 包头，宿主只加载 `turn` / `1`，`/api/version` 与 `bpmap doctor` 用同一组常量；`fixture-kit` 覆盖事件流 / 资源 / 拒绝。
- **座位级选项**（SDK 0.4.0 契约 `c326314`）：`SeatOptionsSpec` / `parseSeatOptions`，`SeatView.options` / `GameSeatInfo.options`，`hostSeat {op:'setOptions'}`；平台把颜色直接映射到席位左侧色条/图标/号码牌，房主点号码牌选色；电脑行内显示难度下拉，无通用“设置”按钮；只房主、只 lobby，服务端用游戏 `normalizeSeatOptions`/spec 收口，`RoomExport` 随座位持久化。**变色对决 0.2.0 已声明并用真实包实测**：房主座位蓝/红/绿可切，电脑 1/2 各自选简单/中等/冷酷；非房主看不到颜色入口，难度下拉只读。1280×800 截图 [seat-options-1280.png](docs/images/seat-options-1280.png)。232/232。
- 房间 UI（2026-10-30 四块）：① **房间信息**横贯顶部（房号 / 房间名 / 游戏 / 房间状态 / 局域网地址 / 游戏资料，1256 实测 132px）；下面从左到右 ② **规则配置** ③ **席位配置** ④ **房间聊天**（310 / 542 / 325，同高 319px，共用 `clamp(280px, calc(100vh - 389px), 760px)`），页面总高等于视口。席位每行六格：图标 / 座位号 / 名字 / 身份（房主·玩家·电脑·观战）/ 准备 / 行内操作；空位行右侧 **+** 按位加电脑（`hostSeat {op:'addAi', slot}`，点名占位冲突报 `FULL`），席位与空位按座位号合并排序，先加 4 号再补 2 号也不会显示成 1、4、2、3。房主桌子级动作（加电脑位 / 请出 / 解散 / 开始）在席位卡底栏，开局后只留「解散房间」。**颜色全部沿用原令牌，未新增色值**，仍无渐变/关键帧/发光。规则默认收起成一行摘要，点「展开修改」出表单，「保存规则」sticky 在栏底。非房主看不到底栏与邀请链接，规则只有只读摘要。`playing` 时房间信息收进顶部条，游戏区拉通整行，席位横向状态条（卡底保留解散房间），聊天/规则卡进右侧侧栏（`D` / `Esc`，焦点归还）；无 deadline 不显示倒计时块。房间页「本局规则」由房主在 lobby 编辑（`ruleConfig`，非房主 HOSTONLY），改后刷新 `RoomView.config` / `rulesHash`、重置真人 ready 并发系统消息；`RoomExport.config` 落盘。`manifest.reference` 首次展开才请求，`parseGameReference` 校验，文本 `textContent`、图片走 `/games`。服务端加载时校验 `ruleConfig` / `reference`，坏声明跳过并记 `errors`；包头与模块 reference 不一致拒绝加载。
- 单入口壳：根目录只有 `3178对战平台.bat`，启动 `cli.js shell`；先只开 `127.0.0.1:3178` 与本机大厅，点「建房」时调 `/api/host/ready` 再开 `0.0.0.0:3000`、组播与 `HostStore`。纯进房不创建 `HostStore`、不写 `data/`；建房后 `run-<port>.json` / `stop` / `diagnose` 与旧入口一致。`host` / `join` 子命令保留给命令行。
- SDK 0.4.0 已发 npm（四包 `latest` 均为 0.4.0，2026-10-30；tag `sdk-v0.4.0`、Release 资产含 SHA256SUMS，`setup-sdk.mjs --release sdk-v0.4.0` 实测可装）；0.3.0 仍可回退。座位选项契约 `c326314` 已随 0.4.0 发布；color-duel 依赖已切 `^0.4.0`（lock 指向 registry）。
- **第一款真游戏「变色对决」已落地为独立公开仓库 `Lizardon386/color-duel`：main `d761737`，v0.2.0 已发布（tag `v0.2.0`，Release 附 `.bpmap` + SHA256SUMS）。** 完整版：2~8 人、观战、三档电脑、5 个规则开关 + 手牌上限 + 关闭倒计时、规则资料、rule-config 与 seatOptions（座位颜色 + 每电脑位难度）声明。`npm test` 37/37、`npm run build`、`bpmap doctor` 通过；本地与远端一致。SDK 依赖已切 `^0.4.0`、lock 指向 registry；不再 link。**联调 PASS**（协议级 7/7、1280×800 UI 端到端、断线/票据与重启恢复）。运行包 `72410de4f486fffcfe880a6586299cbe1e1a35326184390e881d65406eb9b3ac`（104,268 字节，0.2.0），`games/color-duel.bpmap` 已是该包（gitignored）；**运行中的壳在启动时加载旧包，必须重启平台才会出现颜色/难度控件**；`uno-online` 未动。

## 4. 下一步

1. **等用户自测 color-duel 0.2.0**：包在 `games/color-duel.bpmap`（gitignored，SHA `72410de4…`），用「3178对战平台.bat」建房/改规则/开局即可；**如果平台窗口在换包前就开着，先关掉重开**。用户反馈后先修游戏或平台，不急着发下一版。平台侧猴测结果：协议猴测 seed 707 夹具 0 违规；强制 color-duel 的协议猴测 seed 717 0 违规；UI 猴测 seed 909（4 用户 60 步）0 违规。
2. **color-duel v0.2.0 已发布**（tag/Release `v0.2.0`，包 SHA `72410de4…`）；游戏会话已完成 37/37、build、doctor 与协议/UI 猴测。后续只剩可选 UI 布局改造（Hallmark 3 critical / 4 major，待用户选 A/B）和公开仓库例行维护。
3. **双机与交付实测**：同 WiFi 组播、首次防火墙弹窗、`--tunnel` 真隧道（cloudflared）；便携包上无 Node 机器；单文件 exe 前先做 Node SEA hello-world 实验（SAC = On 可能直接拦）。
6. 刻意不做：目录服务器 / 账号 / 好友 / 段位 / 匹配 / 反作弊仲裁 / 自动写防火墙规则。

## 5. 关键约束与易踩的坑

- **包边界**：游戏运行时只依赖 game-sdk；server/client 不 import game-sdk；wire 类型留在 protocol，`GameModule` 留在 core-abi，别互相塞。
- **接缝闸门必须绿**：`tools/checks/check-seam.sh` 扫 `packages/*/src` 的玩法词与 `games/` import；不加例外，注释也别提旧游戏名。
- **revision 不变式**：任何可见状态变更都要 bump（`Room.addSeat/removeSeat/attach/detach/pushChat/bump` 已内置），否则表现为"客户端收到却不更新"。
- **出站目标在创建时解析成 connIds**：别"先改会话表再投递"，会丢最后一条通知；新增广播走 `Engine.toRoom/toSeat`。
- **游戏侧红线**：不持有 socket、不改 `Room.phase`/座位表、玩法错误码走 `event`；`Effect` 是唯一出口。
- **权威只有一份**：`Engine.persistable/syncStore/restoreFrom` 只允许 `hostd host`；host 的两个监听必须共享同一个 `Engine`/`HostStore`（[dual-listener.test.mjs](packages/hostd/test/dual-listener.test.mjs)）。
- **端口语义**：`--port` 本机界面（默认 3178，只绑 127.0.0.1），`--lan-port` 对外（默认 3000）；`--no-lan` 关监听与组播，`--no-announce` 只关组播。
- **明文票据不落盘**：盘上只有 `secretHash`（房间密码同理）；`HostStore.fileFor` 卡死房号字符集防路径注入。
- **高危动作与方向性**：不写防火墙入站规则、不建议关 Smart App Control、不 `force push`；本地壳页面必须 http，才能连局域网 `ws://` 与隧道 `wss://`。注入的宿主方法不能 `this.x()` 调用（`fetch` 存字段再调用会 `Illegal invocation`，静默 catch 会表现为局域网列表永远空白）。
- **收尾两条硬规则**：Windows `kill('SIGTERM')` 是硬杀，测试别靠 kill 断言 `run.json` 被删，要断言"留下了、`stop` 收掉"；`server.close()` 有 keep-alive/WS 时不回调，先 `closeAllConnections()` + 超时竞速，`transport.close()` 先 `terminate()`。
- **`.bat` 是启动器**：`start "标题" node …` + `exit /b 0` 结尾；UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`，中文只在 chcp 之后；生成走 [gen-bat.mjs](tools/packaging/gen-bat.mjs)（Git Bash 会把 `nul` 改写成 `/dev/null`），由 [bat-entries.test.mjs](packages/hostd/test/bat-entries.test.mjs) 钉住。环境检查失败分支的 `pause` 是故意的。
- **测试写法**：`node --test` 必须用带引号的 glob（`node --test "packages/*/test/*.test.mjs"`）并带 `--test-timeout`；等消息要按 predicate 等符合条件的那一帧。
- **UI 验证**：in-app Browser 无可见视口，用 `navigate_page` + `evaluate_script` 驱动 DOM，观感仍需人工确认；要精确量多档桌面尺寸时用无头 Edge + CDP `Emulation.setDeviceMetricsOverride`（本轮 1280×800 / 1440×900 就是这样量的）。房间高度是一条链：`--bp-room-col-h` 与房间信息块高度绑定（1256×708 下信息 132 / 三栏 319 / `calc(100vh - 389px)`），改房间信息块的内边距或席位行高就要重算，否则页面立刻多出外层滚动条；自绘下拉 `.bp-listbox-trigger` 自带 `min-height:40px`，只写 `height` 会被顶回去，必须同时写 `min-height`。
- **规则表单与资料**：`ruleConfig` 的字段 key 必须小写（SDK 口径），游戏自己的 `normalizeConfig` 负责把表单 key 映射到玩法配置；资料入口先过 `isValidGameReferenceEntry`，文档过 `parseGameReference`，图片路径只走 `/games` 同源路由，文本一律 `textContent`。
- **单入口与加入**：加入/重连的 hello 不带大厅选中的游戏版本，只有建房才声明；纯进房不写 `data/`、不写 `run-<port>.json`，`stop` / `diagnose` 只在建过房后生效。若要让纯进房也能被 `stop` 收掉，需要允许一个非房间的 run 文件。
- **多会话共享一个工作区**：只 stage 自己的文件，禁止 `git add -A` / `git stash`；SDK 包（`core-abi` / `game-sdk` / `sdk-tools` / `INTEGRATION_GUIDE.md`）与平台/客户端分属不同会话，抢写会让 `tsc -b` 和测试互相打断。
- **color-duel 的坑在它自己的 CONTEXT**：卡牌高度变量、`[hidden]`、`no-turn-timer`、不要用 `end` 收尾、tick 必须出 effect；不要在本仓库重复维护这些细节。
- **房主面板每个动作按钮**都要在渲染时判断"此刻合法吗"，不合法就置灰并写原因（`aiFillBlocker` 是范例）；别把服务端错误码当提示。

## 6. 验证命令

```bash
npm test                         # 233 例
npm run seam                     # 接缝闸门
npx tsc -b                       # 类型检查
node tools/checks/smoke-sdk.mjs  # 外部消费者 smoke
```

提交前跑 `npm test` + `npm run seam`；提交后直接 push 并核对远端 HEAD，禁止 force push。便携包 `dist-portable/` 不入库。

## 7. 关键入口

| 关注点 | 位置 |
|---|---|
| 游戏 ABI / 版本常量 | [packages/core-abi/src](packages/core-abi/src/module-api.ts) |
| 房间 / 座位 / 房主权限 | [room.ts](packages/server/src/room.ts) / [authority.ts](packages/server/src/authority.ts) |
| 引擎与广播 | [engine.ts](packages/server/src/engine.ts) / [transport.ts](packages/server/src/transport.ts) |
| 落盘与局域网发现 | [store.ts](packages/server/src/store.ts) / [discovery.ts](packages/server/src/discovery.ts) |
| 游戏包加载 / 沙箱 | [loader.ts](packages/server/src/loader.ts) / [module-loader.ts](packages/client/src/module-loader.ts) |
| 客户端界面 | [app.ts](packages/client/src/app.ts) |
| 宿主壳 CLI | [cli.ts](packages/hostd/src/cli.ts) |
| 测试夹具 | [fixture-turn](tools/testkit/src/test-games/turn-based) / [fixture-kit](tools/testkit/src/test-games/kit-client) |
| SDK 发布 | [bump-sdk.mjs](tools/packaging/bump-sdk.mjs) / [pack-sdk.mjs](tools/packaging/pack-sdk.mjs) / [publish-sdk.yml](.github/workflows/publish-sdk.yml) |

## 8. 交接记录

- 2026-10-30 WorkBuddy：**收工（四块布局定稿）**：房间页四块（房间信息 / 规则配置 / 席位配置 / 房间聊天）已推送 `81fb3ce`，截图更新为房主 / 客人 / 对局中三张（`87baa72`）；`npm test` 233/233、seam OK、`tsc -b` 通过；三档文档同步（README 对局流程、DESIGN 4.5 与验收表、CONTEXT 第 3 节），横幅版旧记录原样沉降到 [压卡备份.md](压卡备份.md)。**留给下一家的两件事**：① 左栏在规则收起时只占 42px、下方留白，可选优化是收起态把摘要铺成清单填满整栏（会改摘要渲染，未擅自做）；② 等用户对四块布局观感与 color-duel 0.2.0 自测的反馈。
- 2026-10-30 WorkBuddy：**房间 UI 改为四块 + 逐位加电脑**：① 房间信息横贯顶部（房号/房间名/游戏/房间状态/局域网地址/游戏资料，1256×708 实测 132px）；下面从左到右 ② 规则配置 ③ 席位配置 ④ 房间聊天（310/542/325，同高 319px，`clamp(280px, calc(100vh - 389px), 760px)`），页面总高 708 = 视口，规则展开只让左栏自己滚（319/793）。席位每行六格（图标/座位号/名字/身份/准备/行内操作），空位行右侧 **+** 按位加电脑：`hostSeat {op:'addAi', slot}`，引擎点名占位冲突报 `FULL` 不再偷偷换位，电脑名跟着座位号（`电脑 3`）；席位与空位按座位号合并排序，先加 4 号再补 2 号也不会显示成 1、4、2、3。房主桌子级动作（加电脑位/请出/解散/开始）并入席位卡底栏，开局后只留解散；`host-console` 卡片删除，规则卡独占左栏。席位行压到 41px、4 行全显示（`scrollHeight 178 < clientHeight 179`）。颜色沿用原令牌，仍无渐变/关键帧/发光。`npm test` 233/233、seam OK、`tsc -b` 通过；新增「按座位加电脑」服务端测试。
- 2026-10-28 Qoder：**联调 + 初版包 + 猴测**：color-duel 用 SDK 0.3.0 本地 link，协议 7/7、UI E2E、断线/重启恢复 PASS；初版包 `games/color-duel.bpmap`（102,353 字节，SHA256 `b85db75129c4adbb807c631854aa6cb129d02239fedfb41125b6a05bc70916c8`，gitignored）留给用户自测。猴测：协议 seed 707（夹具）/717（强制 color-duel）0 违规，UI seed 909（4 用户 60 步，强制 color-duel）0 违规；`npm test` 216/216。收工前压卡，旧记录沉降到 [压卡备份.md](压卡备份.md)。
- 2026-10-28 Qoder：**规则移入房间 + 单入口壳**：规则卡由房主在 lobby 编辑（ruleConfig 命令，非房主 HOSTONLY），改后重算 rulesHash/revision、重置 ready、`RoomExport.config` 落盘；根目录只留 `3178对战平台.bat`，shell 建房时才开 LAN/HostStore，纯进房不写 `data/`。无头 Edge 实测 1280/1440；`npm test` 216/216、seam OK、`tsc -b` 通过；提交 `521b641` / `4753ab4`。
- 2026-10-28 Qoder：**接盘确认**：新会话 `835cf812` 已按「接盘」核对锚点（平台 `3c9cffa`、游戏 `8c68c06`）并复跑验证：平台 215/215 + seam + tsc，游戏 33/33 + build + doctor；只读，未改文件。此后写者切到该会话。
- 2026-10-28 Qoder：**交接**：平台侧 SDK 0.3.0 契约、全宽对局区、规则表单与资料面板已交付（`7d5b4c3` / `7697d62` / `9495dba`，215/215）；第一款真游戏「变色对决」重构为独立仓库 `D:\agent_workspace\color-duel`（33/33，本地 3 笔，未公开）；下一步是联调、SDK 0.3.0 发布（待用户确认）与公开仓库。交接给会话 `835cf812`。
- 2026-10-28 Qoder：**收工**：UNO 开工前置条件（四项拍板、外部改名工程、不搬源码）写进「下一步」；锚点 `8dffb71`；最旧一条交接记录沉降到 [压卡备份.md](压卡备份.md)。
- 2026-10-28 Qoder：**压卡**：CONTEXT 压到 100 行以内，原第 6–8 节（逐阶段凭据、变更记录、旧追加区）逐字移入 [压卡备份.md](压卡备份.md)；四份文档顶部日期统一到 2026-10-28。
- 2026-10-30 Qoder：**房间三栏定稿 + color-duel 0.2.0 发布**：平台 lobby 改按比例三栏（左栏房信息与规则同一卡、宽度 495/426/301@1280）、席位状态/动作列对齐、房主「解散房间」、真人行内「转交房主」；提交 `ff2a30b` / `d87f201`，232/232、seam、tsc 通过。真实 color-duel 0.2.0 已公开：main `d761737`、tag/Release `v0.2.0`、包 `72410de4…`（104,268B），平台 `games/` 已装该包；游戏 37/37、doctor、协议 717/UI 909 猴测 0 违规。换包后必须重启壳才加载新 manifest；平台文档日期已统一 2026-10-30。
