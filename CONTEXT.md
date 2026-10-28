# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-10-28　模式：三档（README / DESIGN / CONTEXT）
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

**2026-10-28：`npm test` 176/176，`npm run seam` 零命中，`npx tsc -b` 通过，外部消费者 smoke `[smoke] OK`。**

- 平台内核（P0–P7）已交付：协议、座位与房主权限、`GameModule` 契约 + 测试夹具、ws 传输、落盘恢复、客户端界面、hostd 壳（host / join / diagnose / stop）。
- 包边界：`@lizardon386/core-abi`（游戏 ABI）· `@bp/protocol`（wire）· `@lizardon386/pack-format`（.bpmap）· `@lizardon386/game-sdk`（公共门面 + game-kit）· `@lizardon386/sdk-tools`（bpmap CLI / doctor / 模板）。平台包仍是 `@bp/server`、`@bp/client`、`@bp/hostd`、`@bp/testkit`。
- 游戏下发已通：`/api/games`、`/games/<id>/*`、客户端 SHA-256 校验（无 `crypto.subtle` 时纯 JS 回退）、`sandbox=allow-scripts` iframe；`fixture-kit` 覆盖事件流 / 资源 / 拒绝。
- 兼容闸：`mode` / `apiVersion` 写入 `.bpmap` 包头，宿主只加载 `turn` / `1`，`/api/version` 与 `bpmap doctor` 用同一组常量。
- SDK 0.2.0 已发 npm（四包 `@lizardon386/*`，`latest` 均为 0.2.0）；Trusted Publisher 已配，`sdk-v*` tag 由 [publish-sdk.yml](.github/workflows/publish-sdk.yml) 走 OIDC 发布；`sdk-v0.2.0` Release 已建、workflow 已绿。
- **P8 真游戏接入（UNO）未开始。** 代码全部在本仓库，`uno-online` 未动。

## 4. 下一步

1. **UNO 接入**：把 `uno.js` 规则包成 `GameModule` + 客户端入口，用 0.2.0 SDK 打包成 `.bpmap`，走真实宿主 + 浏览器验证；不改 `uno-online`。
2. **首个真实 Trusted Publishing 发布**：下次 SDK 变更跑 `npm run bump:sdk -- <版本>` → test → smoke → pack → 打 `sdk-v*` tag，确认 Actions 无人工介入完成发布。
3. **双机实测**：同 WiFi 组播房间发现、首次绑定防火墙弹窗行为、`--tunnel` 真隧道（需 cloudflared）。
4. **便携包**：在真正没装 Node 的机器上跑 `dist-portable/`。
5. 单文件 exe 之前必须先做 Node SEA hello-world 实验（本机 SAC = On，可能直接拦）；未跑实验前不投入打包链路。
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
- **高危动作不许顺带触发**：写防火墙入站规则、建议关 Smart App Control、`force push`。
- **混合内容方向性**：本地壳页面必须 http，才能连局域网 `ws://` 与隧道 `wss://`。
- **注入的宿主方法不能 `this.x()` 调用**：`fetch` 存字段再调用会 `Illegal invocation`，外面有静默 catch 就表现为"局域网列表永远空白"。
- **Windows `kill('SIGTERM')` 是硬杀**：测试不能靠 kill 断言 `run.json` 被删，要断言"留下了、`stop` 收掉"。
- **`server.close()` 在有 keep-alive/WS 时不回调**：先 `closeAllConnections()` + 超时竞速；`transport.close()` 先 `terminate()`。
- **`.bat` 是启动器**：`start "标题" node …` + `exit /b 0` 结尾；UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`，中文只在 chcp 之后；生成走 [gen-bat.mjs](tools/packaging/gen-bat.mjs)（Git Bash 会把 `nul` 改写成 `/dev/null`），由 [bat-entries.test.mjs](packages/hostd/test/bat-entries.test.mjs) 钉住。环境检查失败分支的 `pause` 是故意的。
- **测试写法**：`node --test` 必须用带引号的 glob（`node --test "packages/*/test/*.test.mjs"`）并带 `--test-timeout`；等消息要按 predicate 等符合条件的那一帧。
- **UI 验证**：in-app Browser 无可见视口，用 `navigate_page` + `evaluate_script` 驱动 DOM，观感仍需人工确认。
- **房主面板每个动作按钮**都要在渲染时判断"此刻合法吗"，不合法就置灰并写原因（`aiFillBlocker` 是范例）；别把服务端错误码当提示。

## 6. 验证命令

```bash
npm test                         # 176 例
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

- 2026-10-28 Qoder：**压卡**：CONTEXT 压到 100 行以内，原第 6–8 节（逐阶段凭据、变更记录、旧追加区）逐字移入 [压卡备份.md](压卡备份.md)；四份文档顶部日期统一到 2026-10-28。
- 2026-10-28 Qoder：**SDK 版本脚本**：`npm run bump:sdk -- <版本>`（`--dry-run` 预览）同步四包 version、内部依赖与 lock；发布手顺改为 bump → test → smoke → pack → tag。
- 2026-10-28 Qoder：**Trusted Publishing 验证**：`sdk-v0.2.0` tag/Release 已建，workflow 全绿（版本已存在时跳过 publish）；修掉 CI 上唯一跨平台失败（`hostd stop --port` 硬杀断言只在 Windows 跑）。
- 2026-10-28 Qoder：**SDK 发布到 npm**：scope 改为账号自带的 `@lizardon386`（`@3178` org 不存在，publish 404），四包 `0.2.0` 发布、`latest` 指向 0.2.0；配置 Trusted Publisher + [publish-sdk.yml](.github/workflows/publish-sdk.yml)。
- 2026-10-28 Qoder：**测试临时目录清理**：五个测试文件登记临时目录并在 `test.after` 删除；`npm test` 前后 `%TEMP%` 下 `bp-*`/`sdk-*` 计数均为 0。
- 2026-10-27 Qoder：**发布 SDK 0.1.1**：`setup-sdk.mjs --release <tag>` 从 GitHub Release 下载并校验 SHA256；Release 资产与安装均验证通过（已由 0.2.0 取代）。
- 2026-10-27 Qoder：**外部消费者 smoke + 发布元数据**：临时工程装 tarball、模板构建/打包/doctor、宿主加载全通；四包去 `private`、补 MIT/README/repository/engines。
- 2026-10-27 Qoder：**开源校验补局域网路径**：`module-loader` 在无 `crypto.subtle` 时回退纯 JS SHA-256；`seatGranted` manifest 带 `assets`；局域网 IP 实测夹具仍挂载并显示"哈希校验通过"。
- 2026-10-27 Qoder：**按开发者接入路径扩 fixture-kit**：服务端 FeedLog，客户端 FeedPanel + `assets/notice.json` + 拒绝动作；抓到真实缺口（宿主裸导入表缺 `@lizardon386/game-sdk/kit/server`）并修复。
- 2026-10-23 Qoder：**拆包三刀**：`core-abi`、`pack-format`、`sdk-tools` 依次拆出，server 不再依赖 game-sdk，CLI/模板独立发版；G4 game-kit 真实沙箱联调完成。
