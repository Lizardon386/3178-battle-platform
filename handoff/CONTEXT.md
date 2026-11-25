# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-11-25　模式：托管运行时（平台 + .bpkg + 原生 exe）实施中　项目目录：D:\agent_workspace\3178-battle-platform　代码锚点以 `handoff/PROMPT.md` 与 git HEAD 为准（分支 `master`）　当前接盘：待接（上一写者 Claude Code；门户暂缓；原生安装器与 CI 产物已跑通）
<!-- 日期要保持 README、DESIGN、INTEGRATION_GUIDE、CONTEXT 顶部同一天。 -->

## 1. 文档目录

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](../README.md) | 接手 / 维护 | 任务入口、验证命令、产物目录 |
| [DESIGN.md](../docs/DESIGN.md) | 接手 / 评审 | 现有实现（旧契约）的架构与决策 |
| [INTEGRATION_GUIDE.md](../docs/INTEGRATION_GUIDE.md) | 接入方 | 旧 SDK 接入说明 |
| [CONTEXT.md](CONTEXT.md)（本文） | 接手 agent | 当前状态、下一步、MEMORY 提炼、坑、交接记录 |
| [COMPACT_BACKUP.md](COMPACT_BACKUP.md) | 追溯 | 压卡搬出的历史流水与旧交接记录 |
| [合并总计划](../plan/federated-marinating-hamming.md) | 执行 / 评审 | 运行时 WP0–WP9 + 暂缓的门户 S0–S4；原 `plan/bright-swinging-wren.md` 为附录 B |
| [设计/研究文档](../docs/全局目标架构.md) | 目标架构 / 评审 | 总纲、SDK 方案、评审输入、UI 预览、协议 v0 设计；均在 `docs/` 根，内部资料不上门户 |

## 2. 目标与完成定义

原目标：类 war3 的宿主制联机对战平台，房主建房、座位/观战/电脑位、Ready 闸、权限与移交、重连、落盘、局域网发现；游戏用 `.bpmap` 包导入，开发者只依赖 game-sdk。原完成定义：`npm test` / `npm run seam` / `npx tsc -b` / 外部 smoke 全绿，SDK 四包可安装。

**目标架构已落地到可运行状态**：Session Service、`.bpkg` 注册表、独立游戏 origin、Authority 恢复、WPF/Supervisor 原生端、win-x64 便携包与 Inno 安装器均已实现；`npm run verify` 338 例、seam、边界、浏览器 smoke、原生 supervisor smoke、CI 安装/卸载 smoke 全绿。仍缺 color-duel 全量迁移、签名证书、真实双机/VM/Android 证据。门户继续暂缓。

## 3. 现在在哪

- **2026-11-25 原生端与安装器**：`apps/BattlePlatform.{Contracts,Supervisor,Wpf}` 可构建；`bp-supervisor` 用当前用户管道 + Job Object 拉起 Node Service，`3178.exe` 有状态/启停/重连/托盘；CI 构建 `dist-win/3178`、Inno 安装器，并静默安装 → 跑安装目录里的 supervisor smoke → 静默卸载；便携目录可用 `npm run upgrade -- apply/rollback/check` 做哈希校验与备份切换（不适用于 Inno 安装目录）。
- **2026-11-25 运行时主线**：`protocol/*` 四面 + TS/Python/C# 生成；`session-core/app/store/ws/service`；`@bp/game-package`（清单、`.bpkg`、注册表）；独立游戏 origin（`/s/<sessionId>/`、游戏 WS、handoffCode）；`@lizardon386/bp-game`（init/build/pack/inspect/doctor/sign/verify）；`reference-duel` 核心/Authority/Web UI；Python Authority 互通；`rematch` 同进程 roundId 递增开新局；`bp-game init` 生成 raw IPC 模板并通过真实服务链验证；`.bpkg.sig` 强制签名可用可信公钥校验（服务 `--trusted-key` / `--require-signatures`）；`bp-game install/uninstall/list` 管理 games 目录；`sessionCreate`/`listGames` 只接受回环地址 + 回环 Host。
- **2026-11-25 可靠性**：Authority 崩溃→最多两次自动重启→仍失败转人工 `recoverGame`；检查点恢复；关会话停进程；修复原子写 rename 窗口与并发 `load` 的静默丢会话问题；数据通道建好自动 `sync`；Authority IPC 已改为 Windows 命名管道 / POSIX Unix socket（boot 帧用 `ipcPath`，旧 `ipcPort` 仅兼容）；服务启动对账遗留 running/starting 为 failed；关闭时先排空断线写入再退出；断线宽限由定时器清理（默认 30 分钟，可配），房主到期移交给在线成员；`resume` 删除 `graceUntil` 而不是赋 undefined；C# Supervisor 单元测试 9 例（含入口缺失、错误协议版本、重复 shutdown）。
- **测试入口**：`npm run verify`（构建引用/lock/契约/322 例/边界）、`npm run seam`、`npm run smoke:package`、`npm run smoke:web`、`npm run smoke:supervisor`、`npm run test:ui`（FlaUI，需交互桌面）、`npm run pack:win`。本机 .NET SDK 在 `dogfood-output/dotnet`（gitignored）。

## 4. 下一步

1. **WP6 收口**：TS/C# 共享 reducer 与 golden；移动视口已测 320/360/390 不溢出，继续补读屏/键盘/高对比完整流程。
2. **WP3 收口**：完整故障矩阵（磁盘满、权限、重复 shutdown、服务条目缺失）；确认自动重启策略是否要按 uptime 重置。Authority IPC 命名管道与 Supervisor 单元测试已完成。
3. **WP5/WP9**：SDK 运行时注入（init 模板与 rematch 已完成）；color-duel 全量 golden 迁移必须先拿到该仓写者/授权，平台侧只做切换准备。
4. **WP8**：Inno 安装目录的升级路径、签名证书、双机/WSS/Android/干净 VM 验收；没有证书/设备时不要写成已完成。便携目录升级/回滚已验证。

## 5. MEMORY 提炼

- `docs/` 放设计 / 方案 / 指导 / 调研类文档（含 DESIGN、INTEGRATION_GUIDE、全局目标架构、UI 预览等）；过时的直接删、不做归档；不再使用 `docs/research/` 子目录。
- 视觉硬约束：沿用原色值令牌、三套 OFL 字体、无渐变 / 无关键帧 / 无发光；全站实线；单层 1px 整圈靛紫高亮。共享令牌（琥珀 `--bp-warn` / 靛紫 `--bp-accent`）不可擅改，调整色板只替换相近邻居。
- 昵称标签与昵称值都要突出（桌面 22px，输入值 600 字重）；平台身份资料与玩法分离，`displayColor` 不等于阵营色，默认琥珀/靛紫也参与一色一席。
- **交付形态按设计，不拿浏览器套壳冒充 exe**：桌面是原生控件 + 托盘（D8），网页/手机共用 Web 实现；三端实现排在真实 Session Service / Supervisor 之后。
- 术语精确：「游戏规则/玩法参数」不是「房规」；按钮是「开始游戏」「请出房间」；无账号系统，说「加入会话/进房」不是「登入」；用户可见文案不出现「进程/相位/sessionConfig/rulesHash/revision/lobby」等内部词。
- 验收口径：改了 A 必须联动 B；状态变了不能显示旧数据；禁用态写明原因；每次改完自己测，不等截图挑刺。用户给的是「观察 + 诉求」，不一定是最优解：先判断真实问题，再选代价更小的方案，写清依据；量化结论必须实算。
- **架构一次设计完整，不接受边做边补**；计划/待定项确认不等于开工，只有明确实施指令才动仓库；新增功能落在单一模块和对应测试。
- **SDK = android.jar 模型**：游戏侧只装单一 compile-only stub `@lizardon386/game-sdk`；core-abi / pack-format / protocol-types 框架内部、不对游戏发布；authority-host = 平台 runner；bp-game 独立构建工具、game-kit 可选。仓库现存四包是旧实现，别按它反推新设计。
- **门户已暂缓（2026-11-24）**：热铁盒只有静态托管 + Serverless（无 npm/常驻进程/自定义端口/UDP；WS 是 `.node.js` 文本端点；KV 单值 64KB 且无事务）；不能跑服务端/客户端、不接云函数/KV/WS。代码已回退；恢复时按合并计划附录 A 重建，先确认受众与维护成本。
- **当前发布形态已是原生 `3178.exe` + `bp-supervisor.exe` + 旁置 `runtime/node.exe`**；CI 产出便携目录与 Inno 安装器。签名、干净 VM、双机/Android 证据仍未做，别把未验证项写成已验收。
- **`.bpkg` 是唯一游戏包**：旧 `.bpmap` 明确拒绝；包内入口/资产必须在文件清单内，旧 `pack-format` 只留给旧 SDK，不要接进新运行时。

## 6. 关键约束与易踩的坑

- **包边界、接缝与多会话**：游戏运行时只依赖 game-sdk；server/client 不 import game-sdk；wire 类型留在 protocol，`GameModule` 留在 core-abi；`check-seam.sh` 扫玩法词与 `games/` import。只 stage 自己的文件，禁止 `git add -A` / `git stash`；不切分支，保持 `master`；SDK 与平台/客户端分属不同会话，抢写会打断 `tsc -b` 和测试。
- **引擎状态与广播不变式**：任何可见状态变更都要 bump；出站目标创建时解析成 connIds；新增广播走 `Engine.toRoom/toSeat`；游戏侧不持有 socket、不改 `Room.phase`/座位表，玩法错误码走 `event`。
- **权威与端口**：`Engine.persistable/syncStore/restoreFrom` 只允许 `hostd host`；host 两个监听共享同一 `Engine`/`HostStore`；`--port` 本机 3178（只绑 127.0.0.1），`--lan-port` 对外 3000；`--no-lan`/`--no-announce` 语义别混。
- **安全与操作红线**：盘上只有 `secretHash`；`HostStore.fileFor` 卡死房号字符集；不写防火墙入站规则、不建议关 Smart App Control、不 force push；本地壳页面必须 http 才能连 `ws://`；注入宿主方法不能 `this.x()` 调用。
- **收尾与测试写法**：Windows `kill('SIGTERM')` 是硬杀；`server.close()` 有 keep-alive/WS 时不回调，先 `closeAllConnections()` + 超时竞速；`node --test` 用带引号 glob 并带 `--test-timeout`；等消息按 predicate。
- **单入口与启动器**：`.bat` 用 `start "标题" node …` + `exit /b 0`，UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`；生成走 `tools/packaging/gen-bat.mjs`；纯进房不写 `data/`/`run-<port>.json`。
- **UI 验证与高度链**：精确量多档桌面尺寸用无头 Edge + CDP `Emulation.setDeviceMetricsOverride`；旧三栏 319px 高度链已失效，真实 UI 要重新量 1256/1440/320；自绘下拉 `min-height:40px`，只写 `height` 会被顶回去。
- **规则表单与房主面板**：`ruleConfig` 字段 key 必须小写；资料入口先过 `isValidGameReferenceEntry`，图片只走 `/games` 同源，文本一律 `textContent`；房主按钮渲染时判断「此刻合法吗」，不合法置灰写原因。
- **预览页与新坑**：Chrome 文本 input 鼠标点击也匹配 `:focus-visible`；区域联动要排除 `[readonly]`；动态重绘后事件委托、焦点不能还给游离节点；CSS 变量优先级：内联 `style="--bp-seat:…"` 会压掉状态色；`readonly` ≠ `disabled`；跨轮状态链全链路重算。
- **原子写与并发读**：`session.json` 的 rename 备份窗口会让并发 `load` 误判会话不存在，已把 `load` 与写队列串链并回退 `.bak`；新增存储改动不要绕开 `FileSessionRepository.load`。
- **数据通道必须 sync**：晚开的游戏页/重连只有 `dataReady` 不够；`SessionServer` 在鉴权后触发 `onDataReady` → `SessionApplication.syncMember`，Authority 的 `sync` 要同时补公共与私密视图。
- **浏览器交接与 CSP**：游戏页用 30 秒一次性 `handoffCode`（fragment，连上后 `history.replaceState` 抹掉）；游戏 origin 的 `connect-src` 要允许 `ws:`/`wss:`，否则 Chrome 可能拒绝同源 WS。
- **本机 .NET 与打包**：SDK 解压在 `dogfood-output/dotnet`，运行 apphost / 测试要设 `DOTNET_ROOT`；CI 用 `setup-dotnet`。`npm pack` 传包目录必须写 `./packages/...`，否则 npm 会把 `packages/bp-game` 当成 GitHub 仓库。
- **Authority IPC 管道**：boot 帧现在传 `ipcPath`（Windows `\\.\pipe\...`、POSIX 文件 socket），Node/Python 夹具都要用 `net.connect(boot.ipcPath)` / Unix socket；POSIX 关闭时要 unlink socket 文件。C# 侧用 `NamedPipeServerStream + CurrentUserOnly`。Windows 管道读的 CancellationToken 不保证生效，测试超时用 `Task.WhenAny` 兜底。
- **Authority 错误分级**：`authorityError.fatal !== true` 只记日志，不能把会话标 failed；`startRound` 不受支持时回非 fatal UNSUPPORTED。rematch 只换 roundId 不重启进程，检查点覆盖为新局。
- **游戏包签名**：签名对象是整包 `packageHash`，detached 文件是 `<包>.sig`；强制模式必须同时给可信公钥（`--trusted-key`），空公钥或缺失 `.sig` 都让启动失败。exe 的 Authenticode 仍无证书。
- **本机命令隔离**：不能只看 `remoteAddress`——cloudflared 从本机连服务，隧道请求也是 127.0.0.1。必须同时检查 Host：只有回环 Host 才允许 `sessionCreate`/`listGames`；LAN 直连与公网隧道都会被拒。
- **关闭与对账顺序**：`SessionServer.close()` 必须先 terminate 控制 socket、等 close 事件把 `disconnectMember` 排入队列并落盘，否则旧实例的宽限写入会覆盖新实例启动时的 running→failed 对账。可选字段清空用 `delete`，canonical JSON/WAL 不接受 `undefined` 属性。
- **门户暂缓与恢复**：代码已回退，`site/`、`tools/site/` 不存在；恢复时按合并计划附录 A 重建，先确认受众与维护成本。Windows Edge `--window-size=390` 布局视口会被抬到约 500，真实窄屏必须用 CDP；热铁盒不能跑常驻服务端/客户端。

## 7. 验证命令

```bash
npm run verify                   # 338 例 + 构建引用/lock/契约/边界
npm run seam                     # 接缝闸门
npm run smoke:package            # 仓外 tarball 构建 .bpkg
npm run smoke:web                # 真实 Chrome/Edge 走完一局（ubuntu CI 也跑）
npm run smoke:supervisor         # C# Supervisor 拉起 Service、listGames 并真实开一局
npm run test:ui                  # FlaUI 三条关键路径（需交互桌面）
npm run test:supervisor          # C# Supervisor 9 例（Windows）
node packages/bp-game/dist/cli.js init <目录> --id <游戏 id>   # 生成最小可运行模板
node packages/bp-game/dist/cli.js install <包> --games-dir <目录> [--trusted-key <PEM>]
npm run pack:win                 # win-x64 便携目录；Inno 脚本在 tools/packaging/inno
npm run upgrade -- check --target dist-win/3178   # 便携目录校验；apply/rollback 见脚本用法
```

提交前至少跑 `npm run verify` + `npm run seam`；Windows 侧改动再跑 `smoke:supervisor`，UI 改动跑 `smoke:web` 与 `test:ui`。提交后直接 push 并核对远端 CI，禁止 force push。`dist-win/`、`apps/*/bin|obj`、`dogfood-output/` 都是本机构建产物，不入库。

## 8. 关键入口

| 关注点 | 位置 |
|---|---|
| 协议 schema / golden | [protocol/](../protocol/)（`client-session`、`session-authority`、`local-control`、`game-package`） |
| 纯会话规则 / 用例 | [session-core](../packages/session-core/src) / [session-app](../packages/session-app/src) |
| WS / 服务组合根 | [session-ws](../packages/session-ws/src/server.ts) / [compose.ts](../packages/session-service/src/compose.ts) |
| `.bpkg` 与注册表 | [game-package](../packages/game-package/src) |
| 构建工具 / SDK | [bp-game](../packages/bp-game/src) / [game-sdk-stub](../packages/game-sdk-stub/src) |
| 原生 Supervisor / WPF | [apps/BattlePlatform.Supervisor](../apps/BattlePlatform.Supervisor) / [apps/BattlePlatform.Wpf](../apps/BattlePlatform.Wpf) |
| 打包 / 安装器 / CI | [pack-win.mjs](../tools/packaging/pack-win.mjs) / [setup.iss](../tools/packaging/inno/setup.iss) / [ci.yml](../.github/workflows/ci.yml) |
| 验收游戏 | [examples/reference-duel](../examples/reference-duel) |
| 合并总计划 / 附录 B | [plan/federated-marinating-hamming.md](../plan/federated-marinating-hamming.md) / [plan/bright-swinging-wren.md](../plan/bright-swinging-wren.md) |

## 9. 交接记录

- 2026-11-25 Claude Code：**托管运行时主线落地**：新协议四面与生成物、session 内核/存储/WS/服务、`.bpkg` 注册表与独立游戏 origin、`bp-game` 构建工具、reference-duel Web UI、Python Authority 互通、Authority 崩溃自动重启与 `recoverGame`、WPF/Supervisor/Contracts、win-x64 便携包与 Inno 安装器；CI 增加浏览器 smoke、原生 supervisor smoke、安装/卸载 smoke；FlaUI 三条关键路径本机 3/3。`npm run verify` 322/322。剩余：color-duel 全量迁移（需独立游戏仓授权）、签名/VM/双机/Android、共享 reducer 与完整 a11y。
- 2026-11-24 Claude Code：**文档扁平化 + 计划归位**：`docs/research/` 全部内容移到 `docs/`（含 `fonts/` 与 UI 预览），删除 `research` 子目录；`.zcode/plans` 的 `plan-sess_0614...` 移入 `plan/` 并补 `scope=plan`；同步修正 docs 内相对链接与 CONTEXT/PROMPT 引用。历史时间线里的旧路径保留原样并加说明。
- 2026-11-24 Claude Code：**门户回退/暂缓**：按用户决定暂不接入热铁盒；删除 `site/`、`tools/site/`、`dist-site/`，还原 `package.json`/`package-lock.json` 与 `.gitignore` 的 `dist-site/` 改动；合并计划保留 S0–S4 作为暂缓支线并更新决策记录。只提交 handoff 文档；运行时未动。
- 2026-11-16 cc-haha：`--doc` 把完整实施计划迁入 `plan/bright-swinging-wren.md`（已 gitignore）；CONTEXT/PROMPT 的旧 `~/.claude/plans` 引用改为 `../plan/`；`.gitignore` 加 `plan/`。
- 2026-11-13 Qoder：**接盘复验 + 计划评审 9 项回写 + 全文重写为 android.jar 模型**：接盘四条基线全绿（`npm test` 272/272、seam、tsc、gen-check），HEAD `debb73d`、工作树净。把「冻结前必须补的 9 个问题」回写进计划；把计划全文重写为 android.jar compile-only stub 模型（573 行）；未改实现代码。真实运行时、原生 exe、SDK 外部消费者均未实施。
- 2026-11-13 Claude Code：**A0–A5 契约修订收工 + 完整实施计划落盘**：`protocol/v0` 已按总纲补齐；`npm test` 272/272、seam、生成物一致，CI ubuntu/windows 通过，HEAD `103398f` 已推送。完整架构与实施计划在 `plan/bright-swinging-wren.md`。真实运行时、原生 exe、SDK 外部消费者尚未实施。
<!-- multi-agent-task-handoff: scope=handoff -->
