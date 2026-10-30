# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-10-28　模式：三档（README / DESIGN / CONTEXT）　锚点：`a15f687`（master）
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

**2026-10-28：`npm test` 232/232，`npm run seam` 零命中，`npx tsc -b` 通过，外部消费者 smoke `[smoke] OK`。**

- 平台内核（P0–P7）已交付：协议、座位与房主权限、`GameModule` 契约 + 测试夹具、ws 传输、落盘恢复、客户端界面、hostd 壳（host / join / diagnose / stop）。
- 包边界：`@lizardon386/core-abi`（游戏 ABI）· `@bp/protocol`（wire）· `@lizardon386/pack-format`（.bpmap）· `@lizardon386/game-sdk`（公共门面 + game-kit）· `@lizardon386/sdk-tools`（bpmap CLI / doctor / 模板）。平台包仍是 `@bp/server`、`@bp/client`、`@bp/hostd`、`@bp/testkit`。
- 游戏下发与兼容闸：`/api/games`、`/games/<id>/*`、客户端 SHA-256 校验（无 `crypto.subtle` 时纯 JS 回退）、`sandbox=allow-scripts` iframe；`mode` / `apiVersion` 写入 `.bpmap` 包头，宿主只加载 `turn` / `1`，`/api/version` 与 `bpmap doctor` 用同一组常量；`fixture-kit` 覆盖事件流 / 资源 / 拒绝。
- **座位级选项**（SDK 0.4.0 契约 `c326314`）：`SeatOptionsSpec` / `parseSeatOptions`，`SeatView.options` / `GameSeatInfo.options`，`hostSeat {op:'setOptions'}`；平台把颜色直接映射到席位左侧色条/图标/号码牌，房主点号码牌选色；电脑行内显示难度下拉，无通用“设置”按钮；只房主、只 lobby，服务端用游戏 `normalizeSeatOptions`/spec 收口，`RoomExport` 随座位持久化。**变色对决 0.1.0+c6836 已声明并用真实包实测**：房主座位蓝/红/绿可切，电脑 1/2 各自选简单/中等/冷酷；非房主看不到颜色入口，难度下拉只读。1280×800 截图 [seat-options-1280.png](docs/images/seat-options-1280.png)。232/232。
- 房间 UI 增量：lobby 改三栏——三栏按内容比例分宽（左栏至少 430px，1280×800 实测左 495 / 席位 426 / 聊天 301），房信息与「本局规则与房主操作」合成一张连续卡（房信息 184px、房主台 407px），规则区紧贴房号下方，规则说明 13px，控制台在栏内滚动；席位行固定列（状态 64px、动作列 88px），电脑难度与转交按钮同列，状态右边界一致。三栏共用 `clamp(520px, calc(100vh - 208px), 760px)` 高度（1280×800 实测 592px）。非房主左栏只保留只读规则摘要，房主操作/开局/邀请/颜色入口全部隐藏，电脑难度下拉只读。房主顶部按钮改为「解散房间」（直接 hostClose），真人席位行右侧由房主直接「转交房主」。`playing` 时房间头移到顶部，游戏区拉通整行，席位横向状态条，聊天/控制台进右侧侧栏（`D` / `Esc`，焦点归还）；无 deadline 不显示倒计时块；“规则与资料”改为接近全屏双栏弹层。1280×800 实测游戏区 1248×560；截图 [房主](docs/images/room-host-lobby-1280.png) / [非房主](docs/images/room-guest-lobby-1280.png) / [对局中](docs/images/room-playing-1280.png)。房间页「本局规则」卡由房主在 lobby 编辑（`ruleConfig` 命令，非房主 HOSTONLY），改后刷新 `RoomView.config` / `rulesHash`、重置真人 ready 并发系统消息；`RoomExport.config` 落盘，重启保持。`manifest.reference` 首次展开才请求，`parseGameReference` 校验，文本用 `textContent`、图片走 `/games`，图片 404 显示 alt，失败只影响面板。服务端在模块加载时还会校验 `ruleConfig` / `reference` 文档，坏声明跳过并记 `errors`；`manifestOf` 再挡一次；包头与模块 reference 不一致拒绝加载。
- 单入口壳：根目录只有 `3178对战平台.bat`，启动 `cli.js shell`；先只开 `127.0.0.1:3178` 与本机大厅，点「建房」时调 `/api/host/ready` 再开 `0.0.0.0:3000`、组播与 `HostStore`。纯进房不创建 `HostStore`、不写 `data/`；建房后 `run-<port>.json` / `stop` / `diagnose` 与旧入口一致。`host` / `join` 子命令保留给命令行。
- SDK 0.3.0 已发 npm（四包 `@lizardon386/*`，`latest` 均为 0.3.0，2026-10-29）；Trusted Publisher + [publish-sdk.yml](.github/workflows/publish-sdk.yml) 的首次真实 CI 发布已绿；`sdk-v0.3.0` tag/Release 已建（Release 资产来自 `dist-sdk/`，含 SHA256SUMS）。`sdk-v0.2.0` 保留可回退。**SDK 0.4.0 座位选项契约已在仓库（`c326314`），未打包/未发 npm/未打 tag**；游戏侧需本地 link 0.4.0。
- **第一款真游戏「变色对决」已落地为独立仓库 `D:\agent_workspace\color-duel`，公开仓库尚未创建/推送。** 完整版：2~8 人、观战、三档电脑、5 个规则开关 + 手牌上限 + 关闭倒计时、规则资料、rule-config 与 seatOptions（座位颜色 + 每电脑位难度）声明。`npm test` 33/33、`npm run build`、`bpmap doctor` 通过；本地提交 HEAD `70ec433`。SDK 依赖已切 `^0.3.0`、lock 指向 npm registry；本地 link 的 `game-sdk` 为 0.4.0。**联调 PASS**（协议级 7/7、1280×800 UI 端到端、断线/票据与重启恢复）。运行包在 `games/color-duel.bpmap`（104,268 字节，SHA256 `c6836db7b333106a70212511d7a9aa07998e2c398d75a4ae6099a09fea731569`，gitignored），已含 seatOptions；**运行中的壳在启动时加载旧包，必须重启平台才会出现颜色/难度控件**；`uno-online` 未动。

## 4. 下一步

1. **等用户自测 color-duel 包**：包在 `games/color-duel.bpmap`（gitignored，已含 seatOptions），用「3178对战平台.bat」建房/改规则/开局即可；**如果平台窗口在换包前就开着，先关掉重开**。用户反馈后先修游戏或平台，不急着发版。平台侧猴测结果：协议猴测 seed 707 夹具 0 违规；强制 color-duel 的协议猴测 seed 717 0 违规；UI 猴测 seed 909（4 用户 60 步）0 违规。
2. **SDK 0.3.0 已发布（2026-10-29）**，color-duel 依赖已切 `^0.3.0` 并提交（`1a78b9e`，lock 指向 registry）；下一步 `gh repo create Lizardon386/color-duel --public` 推首个提交，CI 绿后打 `v0.1.0`。
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
- **UI 验证**：in-app Browser 无可见视口，用 `navigate_page` + `evaluate_script` 驱动 DOM，观感仍需人工确认；要精确量多档桌面尺寸时用无头 Edge + CDP `Emulation.setDeviceMetricsOverride`（本轮 1280×800 / 1440×900 就是这样量的）。
- **规则表单与资料**：`ruleConfig` 的字段 key 必须小写（SDK 口径），游戏自己的 `normalizeConfig` 负责把表单 key 映射到玩法配置；资料入口先过 `isValidGameReferenceEntry`，文档过 `parseGameReference`，图片路径只走 `/games` 同源路由，文本一律 `textContent`。
- **单入口与加入**：加入/重连的 hello 不带大厅选中的游戏版本，只有建房才声明；纯进房不写 `data/`、不写 `run-<port>.json`，`stop` / `diagnose` 只在建过房后生效。若要让纯进房也能被 `stop` 收掉，需要允许一个非房间的 run 文件。
- **多会话共享一个工作区**：只 stage 自己的文件，禁止 `git add -A` / `git stash`；SDK 包（`core-abi` / `game-sdk` / `sdk-tools` / `INTEGRATION_GUIDE.md`）与平台/客户端分属不同会话，抢写会让 `tsc -b` 和测试互相打断。
- **color-duel 的坑在它自己的 CONTEXT**：卡牌高度变量、`[hidden]`、`no-turn-timer`、不要用 `end` 收尾、tick 必须出 effect；不要在本仓库重复维护这些细节。
- **房主面板每个动作按钮**都要在渲染时判断"此刻合法吗"，不合法就置灰并写原因（`aiFillBlocker` 是范例）；别把服务端错误码当提示。

## 6. 验证命令

```bash
npm test                         # 232 例
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

- 2026-10-28 Qoder：**联调 + 初版包 + 猴测**：color-duel 用 SDK 0.3.0 本地 link，协议 7/7、UI E2E、断线/重启恢复 PASS；初版包 `games/color-duel.bpmap`（102,353 字节，SHA256 `b85db75129c4adbb807c631854aa6cb129d02239fedfb41125b6a05bc70916c8`，gitignored）留给用户自测。猴测：协议 seed 707（夹具）/717（强制 color-duel）0 违规，UI seed 909（4 用户 60 步，强制 color-duel）0 违规；`npm test` 216/216。收工前压卡，旧记录沉降到 [压卡备份.md](压卡备份.md)。
- 2026-10-28 Qoder：**规则移入房间 + 单入口壳**：规则卡由房主在 lobby 编辑（ruleConfig 命令，非房主 HOSTONLY），改后重算 rulesHash/revision、重置 ready、`RoomExport.config` 落盘；根目录只留 `3178对战平台.bat`，shell 建房时才开 LAN/HostStore，纯进房不写 `data/`。无头 Edge 实测 1280/1440；`npm test` 216/216、seam OK、`tsc -b` 通过；提交 `521b641` / `4753ab4`。
- 2026-10-28 Qoder：**接盘确认**：新会话 `835cf812` 已按「接盘」核对锚点（平台 `3c9cffa`、游戏 `8c68c06`）并复跑验证：平台 215/215 + seam + tsc，游戏 33/33 + build + doctor；只读，未改文件。此后写者切到该会话。
- 2026-10-28 Qoder：**交接**：平台侧 SDK 0.3.0 契约、全宽对局区、规则表单与资料面板已交付（`7d5b4c3` / `7697d62` / `9495dba`，215/215）；第一款真游戏「变色对决」重构为独立仓库 `D:\agent_workspace\color-duel`（33/33，本地 3 笔，未公开）；下一步是联调、SDK 0.3.0 发布（待用户确认）与公开仓库。交接给会话 `835cf812`。
- 2026-10-28 Qoder：**收工**：UNO 开工前置条件（四项拍板、外部改名工程、不搬源码）写进「下一步」；锚点 `8dffb71`；最旧一条交接记录沉降到 [压卡备份.md](压卡备份.md)。
- 2026-10-28 Qoder：**压卡**：CONTEXT 压到 100 行以内，原第 6–8 节（逐阶段凭据、变更记录、旧追加区）逐字移入 [压卡备份.md](压卡备份.md)；四份文档顶部日期统一到 2026-10-28。
- 2026-10-28 Qoder：**SDK 版本脚本**：`npm run bump:sdk -- <版本>`（`--dry-run` 预览）同步四包 version、内部依赖与 lock；发布手顺改为 bump → test → smoke → pack → tag。
- 2026-10-28 Qoder：**Trusted Publishing 验证**：`sdk-v0.2.0` tag/Release 已建，workflow 全绿（版本已存在时跳过 publish）；修掉 CI 上唯一跨平台失败（`hostd stop --port` 硬杀断言只在 Windows 跑）。
- 2026-10-28 Qoder：**SDK 发布到 npm**：scope 改为账号自带的 `@lizardon386`（`@3178` org 不存在，publish 404），四包 `0.2.0` 发布、`latest` 指向 0.2.0；配置 Trusted Publisher + [publish-sdk.yml](.github/workflows/publish-sdk.yml)。
