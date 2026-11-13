# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-11-13　模式：四档（README / DESIGN / INTEGRATION_GUIDE / CONTEXT）+ `docs/research` 调研目录　项目目录：D:\agent_workspace\3178-battle-platform　代码锚点以 `handoff/PROMPT.md` 与 git HEAD 为准（分支 `master`）　当前接盘：待接（上一写者 Claude Code；A0–A5 契约修订已收工，完整实施计划待评审）
<!-- 日期要保持 README、DESIGN、INTEGRATION_GUIDE、CONTEXT 顶部同一天。 -->

## 1. 文档目录

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](../README.md) | 接手 / 维护 | 任务入口、验证命令、产物目录 |
| [DESIGN.md](../docs/DESIGN.md) | 接手 / 评审 | 现有实现（旧契约）的架构与决策 |
| [INTEGRATION_GUIDE.md](../docs/INTEGRATION_GUIDE.md) | 接入方 | 旧 SDK 接入说明 |
| [CONTEXT.md](CONTEXT.md)（本文） | 接手 agent | 当前状态、下一步、MEMORY 提炼、坑、交接记录 |
| [COMPACT_BACKUP.md](COMPACT_BACKUP.md) | 追溯 | 压卡搬出的历史流水与旧交接记录 |
| [全局目标架构.md](../docs/research/全局目标架构.md) | 目标架构 / 评审 | 进程、协议、网络、安全、存储、包、SDK、UI、测试与迁移的总纲与架构图 |
| [新版平台与SDK设计方案.md](../docs/research/新版平台与SDK设计方案.md) | 评审 / 决策 | 新版方向主交付（候选 v0）：平台、SDK、协议目录、实施顺序、附录 A/B |
| [架构评审与决策输入包.md](../docs/research/架构评审与决策输入包.md) | 评审 | 质量属性排序、选型对照、量级估算、D1–D7 权衡表 |
| [平台UI预览.html](../docs/research/平台UI预览.html) | 设计 / 评审 | 可运行界面预览，自包含、演示数据、不连服务；离线字体在 `docs/research/fonts/` |
| [语言中立协议 v0 设计](../docs/research/语言中立协议v0设计.md) | S1 / 接入 | 协议语义与架构图；机器文件在 `protocol/v0/`，TS / Python 生成、mock 与参考游戏已验，不接旧运行时 |
| [猴测报告.md](../dogfood-output/猴测报告.md) | 测试 / 维护 | 猴测报告 |

## 2. 目标与完成定义

原目标：类 war3 的宿主制联机对战平台，房主建房、座位/观战/电脑位、Ready 闸、权限与移交、重连、落盘、局域网发现；游戏用 `.bpmap` 包导入，开发者只依赖 game-sdk。原完成定义：`npm test` / `npm run seam` / `npx tsc -b` / 外部 smoke 全绿，SDK 四包可安装。

**本会话确立的是全局目标架构与契约，不是已完成实现。** 平台与游戏运行时解耦、平台只提供联机能力、游戏全责玩法与 UI，并要 exe / 网页 / 手机多形态；全局目标架构已由用户批准，真实运行时仍待落地。

## 3. 现在在哪

- **2026-11-13 完整实施计划落盘**：`C:\Users\TS\.claude\plans\bright-swinging-wren.md`（本机路径，不在仓库内）。含 A0–A5 契约修订结果、高内聚低耦合模块边界、旧 SDK 继承映射、游标/WAL/checkpoint 恢复模型、原生 exe/SDK/参考游戏验收与故障注入矩阵。**真实运行时、原生 exe、SDK 外部消费者尚未实施。**
- **2026-11-12 真实客户端房间页落地（`b48d4a7`）**：`packages/client` 不再是预览页，真实房间页已改：空位前置加号按位加电脑、占用席位尾部叉删除（电脑直删、真人弹原生 `<dialog>` 确认）、按钮文案改为「加电脑 / 请出房间 / 转交房主 / 解散 / 开始游戏」、昵称标签与输入值同档 22px、窄屏只显示占用席位且动作 44px。`npm test` **253/253**、seam、tsc 通过；真实浏览器端到端（建房 / 加删 / 确认 / 窄屏）**尚未验收**。
- **方向变更 C1–C8**：双形态（桌面 exe 房主端 / 网页与原生客人 / 手机只做客人且网页优先 / 游戏形态自定）；运行时解耦（游戏独立进程，平台不挂载游戏 UI）；平台只持联机共识（连接、会话、票据、定序路由、发现、落盘），游戏全责玩法与全部 UI；权威从平台进程挪到房主机上的独立 Game Authority；平台 UI 只微调；房间级模块（规则配置 / 座位选项 / 资料 / 平台聊天）保留、对局级（game-host / 倒计时 / 结算 / 占位）删除；语言中立协议 + 各语言薄 SDK，`.bpmap` 从下发可执行模块改为清单与资源描述。
- **决策状态**：D1 平台持会话元数据=是；D2 权威放独立游戏进程=是；D3 color-duel 与旧契约测试=**推倒重来、不做兼容适配器**（用最小参考游戏作真实运行时验收基准，回滚靠旧 Engine 分支 + 特性开关）；D4 形态分配按推荐；D5 仅 `architecture-design` 待执行，**不装 electron-assistant**；D6 并入 DESIGN 目录表待执行；**D7 当前 UI 参考稿已定；D8 三端统一设计契约，网页 / 手机共用 Web 实现，桌面 exe 原生控件**。
- **平台 UI 口径**：信息条上「规则设置 / 游戏资料」两个独立入口，规则改成房主点开才展开的接近全屏弹层（是房主选配游戏规则 / 玩法参数，不是「房规」）；下面席位配置与房间聊天等宽两栏；房主底栏五按钮「加电脑 / 请出房间 / 转交房主 / 解散 / 开始游戏」，客人是「准备 / 取消准备」；三档响应式（≥1120 宽 / 700–1119 中 / <700 窄）；沿用原色值令牌与三套 OFL 字体，无渐变、无关键帧、无发光。方向裁定 **Industrial / Utilitarian（工业仪表 / 规格表）**。

## 4. 下一步

1. **评审完整实施计划**：读 `C:\Users\TS\.claude\plans\bright-swinging-wren.md`。重点 §2.1 高内聚低耦合边界、§3 游标/事务/恢复、§7.0 旧 SDK 继承映射、§12 故障注入矩阵。计划不在仓库内，换机交接需先把该文件复制到可访问位置。
2. **拍板两个待定**：game-kit 是否作为可选独立包保留；`authority-host` 作为 `game-sdk/authority` 的发布内容还是单独离线资产。
3. **评审通过后按 WP0–WP9 实施**：先 WP0（方案回写 + 依赖闸门）与 WP1（契约、纯内核、存储），不跳步。真实运行时、原生 exe、SDK 外部消费者均未实施。


## 5. MEMORY 提炼

- `docs/research/` 放调研 / 设计 / 评估类文档，**过时的直接删、不做归档**；不新建孤立评审文档，结论收进已有主方案（§2.6 / §2.7 / S4 / §5）；`docs/` 根只放原有正式文档。
- 视觉硬约束：沿用原色值令牌、三套 OFL 字体（Tektur / Outfit / Geist Mono，同源分发在 `fonts/`）、无渐变 / 无关键帧 / 无发光；**全站线型统一实线**；边框只保留**单层 1px 整圈靛紫高亮**，不要左轨信号轨、不要外圈 outline（用户两次否掉花哨方案）。方向 Industrial / Utilitarian。
- **共享设计令牌不可擅改**：琥珀 `--bp-warn` / 靛紫 `--bp-accent` 被警示、强调高亮、身份色、色板、聊天箭头共用，用户明确「不能改，因为其他 UI 也用到了，色系一致」。调整色板要**替换相近的邻居**，不动锚点；改色值前先查它被多少处引用。
- **昵称标签与昵称值都要突出**：不要把「昵称」缩成普通小标签来制造层级；桌面两者同为 22px，输入值 600 字重，中窄档同步降级。
- 平台身份资料与玩法分离：nick / avatar / displayColor 可作为只读 profile 传游戏；`displayColor` 不等于阵营色，阵营仍走 opaque options。默认琥珀 / 靛紫也参与一色一席占用，不能只统计自定义色。
- **交付形态按设计，不拿浏览器套壳冒充 exe**：桌面端是原生控件 + 系统托盘（D8），网页 / 手机共用 Web 实现；三端实现排在真实 Session Service / Supervisor 之后。用户明确纠正过“exe 启动服务再打开浏览器”的临时做法，别重做。
- 术语精确：「游戏规则 / 玩法参数」是房主选配的游戏侧规则，不是「房规」；按钮是「开始游戏」「请出房间」；项目无账号系统，准确说法是「加入会话 / 进房」，不是「登入」；用户可见文案不出现「进程 / 相位 / sessionConfig / rulesHash / revision / lobby / 准备闸」等内部架构词。
- 验收口径：**改了 A 必须联动 B**（昵称→席位/聊天/弹层候选；席位色→左轨/图标/编号牌/聊天箭头；席位变化→计数/按钮禁用态/开始闸）；状态变了不能显示旧数据；禁用态要写明原因；间距与高亮全局一致；每次改完自己测，不要等截图挑刺。
- **用户给的是「观察 + 诉求」，不一定是最优解**（用户明确要求「不一定按我说的做，要给出专业的判断」）：先判断背后的真实问题，再选代价更小的方案；照做时补被抹掉的语义，不照做时说清理由与等效替代，并把判断依据写进文档。**写进文档的量化结论（色相差、对比度、数量）必须实算**，估值不写成结论。
- 跨会话无直连能力，「评估和设计游戏」会话的结论只能从共享文件读；宿主用户级 memory 为空块，项目级日志在项目内 `.workbuddy/memory/`（不入库）。
- **架构一次设计完整，不接受边做边补**；计划/待定项确认不等于开工，只有明确实施指令才动仓库；新增功能优先落在单一模块和对应测试，不跨层修补。

## 6. 关键约束与易踩的坑

- **包边界与接缝闸门**：游戏运行时只依赖 game-sdk；server/client 不 import game-sdk；wire 类型留在 protocol，`GameModule` 留在 core-abi。`tools/checks/check-seam.sh` 扫玩法词与 `games/` import；不加例外，注释也别提旧游戏名。
- **引擎状态与广播不变式**：任何可见状态变更都要 bump，否则「客户端收到却不更新」；出站目标在创建时解析成 connIds，别「先改会话表再投递」；新增广播走 `Engine.toRoom/toSeat`；游戏侧不持有 socket、不改 `Room.phase` / 座位表，玩法错误码走 `event`，`Effect` 是唯一出口。
- **权威与端口**：`Engine.persistable/syncStore/restoreFrom` 只允许 `hostd host`；host 的两个监听必须共享同一 `Engine` / `HostStore`；`--port` 本机界面（3178，只绑 127.0.0.1），`--lan-port` 对外（3000）；`--no-lan` 关监听与组播，`--no-announce` 只关组播。
- **安全与操作红线**：盘上只有 `secretHash`，`HostStore.fileFor` 卡死房号字符集防路径注入；不写防火墙入站规则、不建议关 Smart App Control、不 force push；本地壳页面必须 http 才能连 `ws://`；注入的宿主方法不能 `this.x()` 调用（fetch 存字段再调用会 `Illegal invocation`）。
- **收尾与测试写法**：Windows `kill('SIGTERM')` 是硬杀，别靠它断言 `run.json` 被删；`server.close()` 有 keep-alive/WS 时不回调，先 `closeAllConnections()` + 超时竞速；`node --test` 用带引号的 glob 并带 `--test-timeout`；等消息按 predicate 等符合条件的那一帧。
- **单入口与启动器**：`.bat` 用 `start "标题" node …` + `exit /b 0`，UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`，中文只在 chcp 之后；生成走 `tools/packaging/gen-bat.mjs`，由 `bat-entries.test.mjs` 钉住；加入/重连的 hello 不带大厅选中的游戏版本，只有建房才声明；纯进房不写 `data/` / `run-<port>.json`。
- **UI 验证与高度链**：精确量多档桌面尺寸用无头 Edge + CDP `Emulation.setDeviceMetricsOverride`；旧三栏 319px 高度链（`--bp-room-col-h` / 1256×708）在两栏等宽布局下已失效，真实 UI 实施时要重新量 1256 / 1440 / 320 三档；自绘下拉 `.bp-listbox-trigger` 自带 `min-height:40px`，只写 `height` 会被顶回去。
- **规则表单与房主面板**：`ruleConfig` 字段 key 必须小写，游戏自己的 `normalizeConfig` 负责映射；资料入口先过 `isValidGameReferenceEntry`，图片路径只走 `/games` 同源路由，文本一律 `textContent`；房主面板每个动作按钮渲染时判断「此刻合法吗」，不合法置灰并写原因（`aiFillBlocker` 是范例），别把服务端错误码当提示。
- **多会话与跨仓边界**：只 stage 自己的文件，禁止 `git add -A` / `git stash`；不自行切分支，保持 `master` 单分支；SDK 包与平台/客户端分属不同会话，抢写会打断 `tsc -b` 和测试；color-duel 的坑在它自己的 CONTEXT，不要在本仓库重复维护。
- **预览页与新坑（合并）**：Chrome 对文本 input 鼠标点击也匹配 `:focus-visible`；`readonly` 聚焦常驻会让 `:has(input:focus)` 区域联动不退，故区域联动必须排除 `[readonly]`（旧修复别改回去）；元素复用 class 会把窄档 grid 套错；动态重绘后事件要委托、焦点不能还给游离节点。**CSS 变量优先级**：内联 `style="--bp-seat:…"` 会压掉 `.seat.is-ready` 状态色，故身份 / 标记 / 状态拆三条通道，状态用文字 + 勾图标表达。**`readonly` ≠ `disabled`**：前者仍要点选复制，静态观感可弱化但 hover/focus 动效必须与普通输入框一致；`input[readonly]:not(:focus)` 用 `:not` 避免覆盖 `input:focus` 抬底。**跨轮状态链**：席位色、聊天箭头、占位色、告警带都是同一份 `state` 派生，改色 / 请出 / 恢复默认必须全链路重算，任一处漏联动就会显示旧数据。DOM 桩验逻辑与状态，验不了视觉「挤不挤」、字体加载、真机触控与辅助技术；色板 / 列表重排后按索引定位的断言会失效，要按 `data-color` / `data-role` 等稳定标识定位。

## 7. 验证命令

```bash
npm test                         # 272 例（含 S1 契约 / 互解 / 参考链路）
npm run seam                     # 接缝闸门
npx tsc -b                       # 类型检查
node tools/checks/smoke-sdk.mjs  # 外部消费者 smoke
npx tsc -b && node --test --test-timeout=20000 tools/testkit/test/s1-protocol.test.mjs && node tools/testkit/scripts/gen-v0-types.mjs --check  # S1 契约与生成物
```

提交前跑 `npm test` + `npm run seam`；提交后直接 push 并核对远端 HEAD，禁止 force push。便携包 `dist-portable/` 不入库。**2026-11-13 全量复跑 `npm test` 272/272、seam、tsc、smoke、生成物检查全绿；A0–A5 契约修订已推送 `103398f`**；**ZCode 接盘时四条全部实跑通过**（233/233、seam 零命中、tsc、smoke-sdk），未改任何实现代码。本轮预览页验证升级为无头 Edge 真渲染 + CDP 交互：1256 / 800 / 320 设备档、真实 320 视口、360@2x / 390@3x / 320@2x 手机模拟、房主 / 客人底栏、横杠与叉槽位、产品可点目标、窄档聊天抽屉发送 / 摘要 / 遮罩 / 焦点闭环、颜色占用与释放、弹层 Tab / Escape、昵称转义均实测通过；HSV 最小色相差 35.1°，对比度按正文 / 大号文字分别实算。脚本在 `%TEMP%\bp-review\`，**不入库、换机需重建**，若要长期维护应沉淀进 `tools/checks/`。真机触控 / 字体实际渲染 / 辅助技术 / 持久化未验证。

## 8. 关键入口

| 关注点 | 位置 |
|---|---|
| 游戏 ABI / 版本常量 | [packages/core-abi/src](../packages/core-abi/src/module-api.ts) |
| 房间 / 座位 / 房主权限 | [room.ts](../packages/server/src/room.ts) / [authority.ts](../packages/server/src/authority.ts) |
| 引擎与广播 | [engine.ts](../packages/server/src/engine.ts) / [transport.ts](../packages/server/src/transport.ts) |
| 客户端界面 / 宿主壳 | [app.ts](../packages/client/src/app.ts) / [cli.ts](../packages/hostd/src/cli.ts) |
| SDK 发布 | [bump-sdk.mjs](../tools/packaging/bump-sdk.mjs) / [publish-sdk.yml](../.github/workflows/publish-sdk.yml) |
| 新版设计 / 预览 | [docs/research](../docs/research/新版平台与SDK设计方案.md) / [平台UI预览.html](../docs/research/平台UI预览.html) |

## 9. 交接记录

- 2026-11-13 Claude Code：**A0–A5 契约修订收工 + 完整实施计划落盘**：`protocol/v0` 已按总纲补齐（memberId/slot/role、authorityEpoch、sync、probe、严格双通道、canonical/配置 golden、加删电脑/聊天历史）；`npm test` 272/272、seam、生成物一致，CI ubuntu/windows 通过，HEAD `103398f` 已推送。完整架构与实施计划在 `C:\Users\TS\.claude\plans\bright-swinging-wren.md`（高内聚低耦合边界、旧 SDK 继承映射、WAL/游标/恢复、原生 exe/SDK/游戏验收）。真实运行时、原生 exe、SDK 外部消费者尚未实施。
- 2026-11-12 ZCode：**真实客户端房间页落地 + 交付形态纠偏**：把已确认的房间交互落到 `packages/client`（空位前置加号、占用席位尾部删除叉、真人确认 `<dialog>`、按钮文案、昵称 22px 同档、窄屏只显示占用席位与 44px 动作），提交 `b48d4a7`；`npm test` 253/253、seam、tsc 通过。曾尝试“exe 启动服务再开浏览器”的临时启动器，用户指出设计里的桌面端是原生控件且三端实现应排在骨干之后，启动器已删除；下一步按设计顺序补齐 `protocol/v0` 并实现真实 Session Service / Supervisor。真实浏览器端到端尚未验收。此前擅自创建的 `s1-protocol` 已快进合并回 `master` 并删除本地 / 远端分支，后续保持单分支。
- 2026-11-11 ZCode：**六维评审、设计检查点与 S1 契约与 mock 完成**：接盘四条基线全绿；评审发现 ready/start 归属、身份色与游戏选项、网页游戏同源安全三处边界矛盾，以及 S1 mock/真实链路、S4 35° 与实际 29.6° 等口径问题。按用户决定修正两份设计文档与预览页：ready/start 归平台、开始后拉起权威，profile 传游戏，网页游戏独立 origin + 受限 gameTicket；UI 调整昵称双突出、8 色最小 35.1°、AI 中性灰、默认色占用、44px 触控、底栏对齐、320 溢出、焦点闭环、席位前加后叉与真人确认、模板转义。实跑无头 Edge / CDP、HSV / WCAG、`node --check`、静态约束检查全过；设计检查点 `e961af1`；S1 新增 41 条方向 golden、manifest、TS / Python 生成互解、内存 mock 与最小参考游戏；未改旧运行时，真机与辅助技术未验；次日完成全局目标架构总纲与文档权威收口；复跑 253/253、seam、tsc、smoke、生成物与浏览器交互全绿，本地提交 `1fb3e44`；后续推送已成功，远端状态以 PROMPT 实测锚点为准。

<!-- multi-agent-task-handoff: scope=handoff -->
