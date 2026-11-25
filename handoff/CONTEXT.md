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

**目标架构已落地到可运行状态**：Session Service、`.bpkg` 注册表、独立游戏 origin、Authority 恢复、WPF/Supervisor 原生端、win-x64 便携包与 Inno 安装器均已实现；`npm run verify` 345 例、seam、边界、浏览器 smoke、原生 supervisor smoke、CI 安装/重装/卸载 smoke 全绿。仍缺 color-duel 全量迁移、签名证书、真实双机/VM/Android 证据。门户继续暂缓。

## 3. 现在在哪

- **可运行主线**：`protocol/*` 四面与 TS/Python/C# 生成、`session-core/app/store/ws/service`、`.bpkg` 注册表、独立游戏 origin、双隧道、`listGames`、`rematch`、`handoffCode`、`sync`、强制签名与本机命令隔离；`bp-game` 支持 init/build/pack/inspect/doctor/sign/verify/install/uninstall/list，module 模型由平台 runner 注入运行库。细节见 [COMPACT_BACKUP 2026-11-25 快照](COMPACT_BACKUP.md)。
- **原生端与分发**：C# Supervisor（命名管道 + Job Object）、WPF 控制壳（启停/重连/托盘）、win-x64 便携包、Inno 安装器；CI 覆盖安装→数据标记→重装→supervisor smoke→卸载，便携目录支持哈希校验升级/回滚。
- **验证**：`npm run verify` 345/345、`npm run seam`、浏览器 smoke、原生/打包 supervisor smoke、FlaUI 3/3、CI 双平台绿。.NET SDK 在 `dogfood-output/dotnet`（本机忽略）。

## 4. 下一步

1. **WP6**：TS/C# 共享 reducer 与 golden；补 320/360/390 完整流程与读屏/键盘/高对比手工验收。
2. **WP3**：磁盘满、权限、跨进程数据目录争用等剩余故障矩阵；确认自动重启是否按 uptime 重置。
3. **WP8**：exe Authenticode（无证书）、双机/WSS/Android/干净 VM（无设备）；C# Supervisor 的 `startAuthority` 仍只支持 process 模型。
4. **WP9**：color-duel 全量 golden 迁移，必须先拿到独立游戏仓写者/授权；平台侧只做切换准备。

## 5. MEMORY 提炼

- `docs/` 放设计/方案/指导/调研类文档；过时直接删、不归档，不再用 `docs/research/`；`plan/` 放可执行计划。
- 视觉硬约束：原色值令牌、三套 OFL 字体、无渐变/无关键帧/无发光、全站实线、单层 1px 靛紫高亮；共享令牌不可擅改。
- 桌面是原生控件 + 托盘，网页/手机共用 Web；不拿浏览器套壳冒充 exe。游戏 UI 可由游戏自定，但平台不挂载玩法。
- 术语精确：说「游戏规则/玩法参数」「开始游戏」「请出房间」「加入会话/进房」；用户可见文案不出现进程/相位/sessionConfig/rulesHash/revision/lobby。
- 验收口径：改 A 必须联动 B；状态变了不能显示旧数据；禁用态写原因；每次改完自己测；量化结论必须实算；收尾只报需处理项，不重复播报无关未提交状态。
- 架构一次设计完整；计划确认不等于开工，只有明确实施指令才动仓库；新增功能落单一模块和对应测试。
- SDK = android.jar 模型：游戏侧只装 compile-only stub；core-abi/pack-format/protocol-types 框架内部；authority-host = 平台 runner；module 模型已实现，process 模板保留兼容。
- 当前发布形态是原生 `3178.exe` + `bp-supervisor.exe` + 旁置 `runtime/node.exe`；签名/干净 VM/双机/Android 未验收，别写成已完成。
- `.bpkg` 是唯一游戏包，旧 `.bpmap` 明确拒绝；旧 `pack-format` 只留给旧 SDK，不接进新运行时。
- 门户暂缓（2026-11-24）：热铁盒只有静态托管 + Serverless，不能跑常驻服务端/客户端；恢复先确认受众与成本。

## 6. 关键约束与易踩的坑

1. **边界与交接**：游戏运行时只依赖 game-sdk；平台包不 import 玩法；`check-seam.sh` 守卫玩法词与 `games/` import。只 stage 自己的文件，禁止 `git add -A` / `git stash`；保持 `master`；活会话不抢写。
2. **状态与投递**：可见状态变更必须 bump revision；出站目标解析成成员；数据通道鉴权后主动 `syncMember`；非 fatal `authorityError` 只记日志；rematch 只换 roundId，检查点覆盖新局。
3. **Authority 进程**：IPC 用 `ipcPath`（Windows 命名管道/POSIX socket）；module runner 必须先校验导出/构造 runtime 再连 IPC；module/runner 校验放在创建管道 server 之前；启动失败要广播 failed；关会话/关闭服务先停进程并排空写入；崩溃最多两次自动重启。
4. **存储**：原子写 rename 窗口内并发 `load` 会误判不存在，读必须与写队列串链并回退 `.bak`；可选字段清空用 `delete`，canonical JSON/WAL 不接受 `undefined`；宽限到期要定时清理。
5. **安全**：本机命令同时校验 `remoteAddress` 与回环 Host（cloudflared 从本机连服务）；`.bpkg.sig` 强制模式必须给 `--trusted-key`；游戏页用 30 秒一次性 handoffCode（fragment），游戏 origin 的 `connect-src` 要放行 ws/wss。
6. **测试写法**：Windows `SIGTERM` 是硬杀；`server.close()` 有 keep-alive/WS 时先 `closeAllConnections()` + 超时竞速；`node --test` 用带引号 glob + `--test-timeout`；等消息按 predicate；Windows 管道读的 CancellationToken 不保证生效，超时用 `Task.WhenAny`。
7. **打包与本机工具**：本机 .NET 在 `dogfood-output/dotnet`，跑 apphost/测试设 `DOTNET_ROOT`；`npm pack` 包目录写 `./packages/...`；pack-win 同时产 `main.cjs` 与 `authority-runner.cjs`；Inno 同 AppId 重装沿用目录、数据在 `%LOCALAPPDATA%\3178-battle-platform`。
8. **UI 与视口**：WPF 用系统 `Window/WindowText/GrayText` 画刷与 `LiveSetting=Polite`，别写死灰值；移动视口用真实 320/360/390，Windows Edge `--window-size` 会抬高布局视口，必须 CDP。
9. **旧资产与门户**：旧 `core-abi`/`protocol`/`server`/`hostd`/`client` 原地保留到 WP9，新代码禁止 import；旧 `.bpmap` 拒绝；门户代码已回退，恢复按合并计划附录 A。
10. **行尾与生成物**：`.gitattributes` 固定 `.sh/.py/.cs/.ts/.mjs/.js/.css/.html/.json/.md/.yml/.xaml/.csproj` 为 LF，`.bat/.cmd/.ps1/.sln/.iss` 为 CRLF；生成物改动后跑 `check:contract`，否则 CI 报过期。

## 7. 验证命令

```bash
npm run verify && npm run seam          # 345 例 + 构建引用/lock/契约/边界 + 接缝
npm run smoke:package; npm run smoke:web; npm run smoke:supervisor
npm run test:ui; npm run test:supervisor; npm run pack:win
node packages/bp-game/dist/cli.js init <目录> --id <游戏 id>
node packages/bp-game/dist/cli.js build <目录> --model module
npm run upgrade -- check --target dist-win/3178
```

提交前至少 `npm run verify` + `npm run seam`；Windows 改动再跑 `smoke:supervisor`，UI 改动跑 `smoke:web` 与 `test:ui`。提交即 push 并核对远端 CI；禁止 force push。`dist-win/`、`apps/*/bin|obj`、`dogfood-output/` 不入库。

## 8. 关键入口

| 关注点 | 位置 |
|---|---|
| 协议 schema / golden | [protocol/](../protocol/) |
| 纯会话规则 / 用例 | [session-core](../packages/session-core/src) / [session-app](../packages/session-app/src) |
| WS / 服务组合根 | [session-ws](../packages/session-ws/src/server.ts) / [compose.ts](../packages/session-service/src/compose.ts) |
| `.bpkg` / 构建工具 | [game-package](../packages/game-package/src) / [bp-game](../packages/bp-game/src) |
| 原生 Supervisor / WPF | [apps/BattlePlatform.Supervisor](../apps/BattlePlatform.Supervisor) / [apps/BattlePlatform.Wpf](../apps/BattlePlatform.Wpf) |
| 打包 / 安装器 / CI | [pack-win.mjs](../tools/packaging/pack-win.mjs) / [setup.iss](../tools/packaging/inno/setup.iss) / [ci.yml](../.github/workflows/ci.yml) |
| 验收游戏 | [examples/reference-duel](../examples/reference-duel) |
| 计划 | [plan/bright-swinging-wren.md](../plan/bright-swinging-wren.md) / [合并计划](../plan/federated-marinating-hamming.md) |

## 9. 交接记录

- 2026-11-25 Claude Code：**SDK 运行时注入**：清单新增 `authorityModel`；`bp-game build --model module` 不打包运行库（7.6KB vs 20.2KB）；平台 runner 独立子进程加载 `createAuthority`；缺导出/缺 runner 负例、reference 启动/出牌/rematch/恢复、浏览器/原生/打包 smoke 全过；`verify` 345/345。
- 2026-11-25 Claude Code：**故障矩阵与安装器升级**：端口占用/游戏端口冲突/坏 games 目录测试；`SessionServer.start` 失败清理管理端口；Inno 同 AppId 重装保留用户数据，CI 安装→标记→重装→smoke→卸载通过；`verify` 341/341。
- 2026-11-25 Claude Code：**托管运行时主线落地**：协议四面、session 内核/存储/WS/服务、`.bpkg` 与游戏 origin、`bp-game`、reference Web UI、Python 互通、崩溃恢复、WPF/Supervisor/安装器；`verify` 322/322。
- 2026-11-24 Claude Code：**文档扁平化 + 计划归位**：`docs/research/` 移到 `docs/`，ZCode 计划移入 `plan/` 并补 `scope=plan`，修正链接。
- 2026-11-24 Claude Code：**门户回退/暂缓**：删除 `site/`、`tools/site/`、`dist-site/`，还原 lock/脚本/ignore；合并计划保留 S0–S4 支线。
- 2026-11-16 cc-haha：`--doc` 把实施计划迁入 `plan/bright-swinging-wren.md`（gitignore），CONTEXT/PROMPT 旧计划路径改为 `../plan/`。
- 2026-11-13 Qoder：接盘复验 + 计划评审回写 + 全文重写为 android.jar 模型；四条基线全绿，未改实现。
- 2026-11-13 Claude Code：A0–A5 契约修订与实施计划落盘；`npm test` 272/272、seam、tsc、生成物一致，HEAD `103398f`。
<!-- multi-agent-task-handoff: scope=handoff -->
