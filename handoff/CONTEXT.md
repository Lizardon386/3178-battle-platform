# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-11-24　模式：文档四档 + `docs/research` + 合并总计划（门户暂缓）　项目目录：D:\agent_workspace\3178-battle-platform　代码锚点以 `handoff/PROMPT.md` 与 git HEAD 为准（分支 `master`）　当前接盘：待接（上一写者 Claude Code；门户已按 2026-11-24 决定回退/暂缓；合并计划已落盘）
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
| [docs/research/](../docs/research/全局目标架构.md) | 目标架构 / 评审 | 总纲、SDK 方案、评审输入、UI 预览、协议 v0 设计；内部资料，不上门户 |

## 2. 目标与完成定义

原目标：类 war3 的宿主制联机对战平台，房主建房、座位/观战/电脑位、Ready 闸、权限与移交、重连、落盘、局域网发现；游戏用 `.bpmap` 包导入，开发者只依赖 game-sdk。原完成定义：`npm test` / `npm run seam` / `npx tsc -b` / 外部 smoke 全绿，SDK 四包可安装。

**当前确立的是全局目标架构与契约，不是已完成实现。** 平台与游戏运行时解耦、平台只提供联机能力、游戏全责玩法与 UI，并要 exe / 网页 / 手机多形态；真实运行时仍待落地。门户已暂缓，仅保留在合并计划中作为将来可选支线。

## 3. 现在在哪

- **2026-11-24 门户回退/暂缓**：用户决定暂不接入热铁盒；已删除 `site/`、`tools/site/`、`dist-site/`，还原 `package.json`/`package-lock.json` 与 `.gitignore` 的 `dist-site/` 改动。合并计划保留 S0–S4 作为暂缓支线（`plan/federated-marinating-hamming.md`），当前不发布、不挡运行时。
- **2026-11-20 合并总计划落盘**：`plan/federated-marinating-hamming.md` 把运行时 WP0–WP9 与门户 S0–S4 合并为唯一执行计划；原 `plan/bright-swinging-wren.md` 降为附录 B（字段级契约/故障矩阵索引）。运行时仍未实施。
- **运行时主线未实施**：真实 Session Service / Supervisor / Authority、原生 `3178.exe`、SDK 外部消费者、reference-duel 均未落地；当前发布形态仍是 `bat + node.exe + 浏览器`。方向 C1–C8 / D1–D8 与 Industrial/Utilitarian UI 口径不变，细节见合并计划 §2 与 COMPACT_BACKUP 2026-11-20 搬出段。

## 4. 下一步

1. **WP0 运行时冻结**：按合并计划 §3.1/§4.3 先做 WP0（文档回写、依赖图、`check-boundaries`），再 WP1（契约、纯内核、存储），不跳步。
2. **G2 前完成 WP2/WP3/WP4** 的真实链路与安全负例，不跳步。
3. **门户暂缓**：不进入当前批次；恢复时按合并计划 §3.2/附录 A 从 S0 重建，先确认受众与维护成本。

## 5. MEMORY 提炼

- `docs/research/` 放调研 / 设计 / 评估类文档，过时的直接删、不做归档；`docs/` 根只放原有正式文档。
- 视觉硬约束：沿用原色值令牌、三套 OFL 字体、无渐变 / 无关键帧 / 无发光；全站实线；单层 1px 整圈靛紫高亮。共享令牌（琥珀 `--bp-warn` / 靛紫 `--bp-accent`）不可擅改，调整色板只替换相近邻居。
- 昵称标签与昵称值都要突出（桌面 22px，输入值 600 字重）；平台身份资料与玩法分离，`displayColor` 不等于阵营色，默认琥珀/靛紫也参与一色一席。
- **交付形态按设计，不拿浏览器套壳冒充 exe**：桌面是原生控件 + 托盘（D8），网页/手机共用 Web 实现；三端实现排在真实 Session Service / Supervisor 之后。
- 术语精确：「游戏规则/玩法参数」不是「房规」；按钮是「开始游戏」「请出房间」；无账号系统，说「加入会话/进房」不是「登入」；用户可见文案不出现「进程/相位/sessionConfig/rulesHash/revision/lobby」等内部词。
- 验收口径：改了 A 必须联动 B；状态变了不能显示旧数据；禁用态写明原因；每次改完自己测，不等截图挑刺。用户给的是「观察 + 诉求」，不一定是最优解：先判断真实问题，再选代价更小的方案，写清依据；量化结论必须实算。
- **架构一次设计完整，不接受边做边补**；计划/待定项确认不等于开工，只有明确实施指令才动仓库；新增功能落在单一模块和对应测试。
- **SDK = android.jar 模型**：游戏侧只装单一 compile-only stub `@lizardon386/game-sdk`；core-abi / pack-format / protocol-types 框架内部、不对游戏发布；authority-host = 平台 runner；bp-game 独立构建工具、game-kit 可选。仓库现存四包是旧实现，别按它反推新设计。
- **门户已暂缓（2026-11-24）**：热铁盒只有静态托管 + Serverless（无 npm/常驻进程/自定义端口/UDP；WS 是 `.node.js` 文本端点；KV 单值 64KB 且无事务）；不能跑服务端/客户端、不接云函数/KV/WS。代码已回退；恢复时按合并计划附录 A 重建，先确认受众与维护成本。
- **当前发布形态是 bat + node.exe**；原生 `3178.exe` 是目标架构、未实施。门户暂缓期间不要把新架构写成已发布。

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
- **门户暂缓与恢复**：代码已回退，`site/`、`tools/site/` 不存在；恢复时按合并计划附录 A 重建，先确认受众与维护成本。Windows Edge `--window-size=390` 布局视口会被抬到约 500，真实窄屏必须用 CDP；热铁盒不能跑常驻服务端/客户端。

## 7. 验证命令

```bash
npm test                         # 272 例（2026-11-20 复跑 272/272）
npm run seam                     # 接缝闸门
npx tsc -b                       # 类型检查
```

提交前跑 `npm test` + `npm run seam`；提交后直接 push 并核对远端 HEAD，禁止 force push。`dist-portable/` 不入库。门户已回退，`npm run site` 与 `dist-site/` 当前不存在；恢复时按合并计划附录 A。历史验证流水见 COMPACT_BACKUP 2026-11-20 搬出段。

## 8. 关键入口

| 关注点 | 位置 |
|---|---|
| 游戏 ABI / 版本常量 | [packages/core-abi/src](../packages/core-abi/src/module-api.ts) |
| 房间 / 座位 / 房主权限 | [room.ts](../packages/server/src/room.ts) / [authority.ts](../packages/server/src/authority.ts) |
| 引擎与广播 | [engine.ts](../packages/server/src/engine.ts) / [transport.ts](../packages/server/src/transport.ts) |
| 客户端界面 / 宿主壳 | [app.ts](../packages/client/src/app.ts) / [cli.ts](../packages/hostd/src/cli.ts) |
| 合并总计划 | [plan/federated-marinating-hamming.md](../plan/federated-marinating-hamming.md) |
| 门户（暂缓，代码已回退） | [plan §3.2 / 附录 A](../plan/federated-marinating-hamming.md) |
| 新版设计 / 预览 | [docs/research](../docs/research/新版平台与SDK设计方案.md) / [平台UI预览.html](../docs/research/平台UI预览.html) |

## 9. 交接记录

- 2026-11-24 Claude Code：**门户回退/暂缓**：按用户决定暂不接入热铁盒；删除 `site/`、`tools/site/`、`dist-site/`，还原 `package.json`/`package-lock.json` 与 `.gitignore` 的 `dist-site/` 改动；合并计划保留 S0–S4 作为暂缓支线并更新决策记录。只提交 handoff 文档；运行时未动。
- 2026-11-16 cc-haha：`--doc` 把完整实施计划迁入 `plan/bright-swinging-wren.md`（已 gitignore）；CONTEXT/PROMPT 的旧 `~/.claude/plans` 引用改为 `../plan/`；`.gitignore` 加 `plan/`。
- 2026-11-13 Qoder：**接盘复验 + 计划评审 9 项回写 + 全文重写为 android.jar 模型**：接盘四条基线全绿（`npm test` 272/272、seam、tsc、gen-check），HEAD `debb73d`、工作树净。把「冻结前必须补的 9 个问题」回写进计划；把计划全文重写为 android.jar compile-only stub 模型（573 行）；未改实现代码。真实运行时、原生 exe、SDK 外部消费者均未实施。
- 2026-11-13 Claude Code：**A0–A5 契约修订收工 + 完整实施计划落盘**：`protocol/v0` 已按总纲补齐；`npm test` 272/272、seam、生成物一致，CI ubuntu/windows 通过，HEAD `103398f` 已推送。完整架构与实施计划在 `plan/bright-swinging-wren.md`。真实运行时、原生 exe、SDK 外部消费者尚未实施。
<!-- multi-agent-task-handoff: scope=handoff -->
