# 3178-battle-platform（3178 对战平台）· 上下文与进展

> 任务交接档案，供后续 agent 跟进；改动产物后更新「现在在哪」「交接记录」。
> 最近更新：2026-11-11　模式：四档（README / DESIGN / INTEGRATION_GUIDE / CONTEXT）+ `docs/research` 调研目录　项目目录：D:\agent_workspace\3178-battle-platform　代码锚点 `6b23ec5`（本会话未改实现代码；当前有 `docs/research/` 未提交修正）　当前接盘：ZCode（评审与修正已落地，未提交）
<!-- 日期要保持 README、DESIGN、INTEGRATION_GUIDE、CONTEXT 顶部同一天。 -->

## 1. 文档目录

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](../README.md) | 接手 / 维护 | 任务入口、验证命令、产物目录 |
| [DESIGN.md](../docs/DESIGN.md) | 接手 / 评审 | 现有实现（旧契约）的架构与决策 |
| [INTEGRATION_GUIDE.md](../docs/INTEGRATION_GUIDE.md) | 接入方 | 旧 SDK 接入说明 |
| [CONTEXT.md](CONTEXT.md)（本文） | 接手 agent | 当前状态、下一步、MEMORY 提炼、坑、交接记录 |
| [COMPACT_BACKUP.md](COMPACT_BACKUP.md) | 追溯 | 压卡搬出的历史流水与旧交接记录 |
| [新版平台与SDK设计方案.md](../docs/research/新版平台与SDK设计方案.md) | 评审 / 决策 | 新版方向主交付（候选 v0，未批准）：平台、SDK、协议目录、S0–S6、附录 A/B |
| [架构评审与决策输入包.md](../docs/research/架构评审与决策输入包.md) | 评审 | 质量属性排序、选型对照、量级估算、D1–D7 权衡表 |
| [平台UI预览.html](../docs/research/平台UI预览.html) | 设计 / 评审 | 可运行界面预览，自包含、演示数据、不连服务；离线字体在 `docs/research/fonts/` |
| [协议 v0](../protocol/v0/README.md) | S1 / 接入 | 语言中立消息目录、JSON Schema、错误码、能力清单与示例；不接旧运行时 |
| [猴测报告.md](../dogfood-output/猴测报告.md) | 测试 / 维护 | 猴测报告 |

## 2. 目标与完成定义

原目标：类 war3 的宿主制联机对战平台，房主建房、座位/观战/电脑位、Ready 闸、权限与移交、重连、落盘、局域网发现；游戏用 `.bpmap` 包导入，开发者只依赖 game-sdk。原完成定义：`npm test` / `npm run seam` / `npx tsc -b` / 外部 smoke 全绿，SDK 四包可安装。

**本会话改的是设计方向，不是实现。** 用户提出平台与游戏运行时解耦、平台只提供联机能力、游戏全责玩法与 UI，并要 exe / apk / 网页多形态。第 3 节的划分是候选方案，不是已落地代码；主方案标为候选 v0、未批准。

## 3. 现在在哪

- **2026-11-11 ZCode 六维评审与补充修正（未提交）**：对两份设计文档与预览页做架构 / 协议 / UI / 可访问性 / 验证可信度 / 文档一致性评审，实算 HSV 与 WCAG，并用无头 Edge 真渲染 1256 / 800 / 320。用户补充拍板：① ready 与 startGame 归平台，开始后才拉起 Game Authority；② 平台身份色与游戏阵营分开，nick / avatar / displayColor 作为只读 profile 传游戏，阵营仍走 opaque options；③ 网页游戏采用版本化静态包 + 独立 origin + 一次性 handoffCode 换受限 gameTicket，管理票据不给游戏；④ 昵称标签与输入值都突出。三份 `docs/research/` 产物已同步修正；未改实现代码与正式文档。随后新增 `protocol/v0/` 与 9 条契约测试，40 条消息含方向 / 通道 / 权限；完整回归 242/242、seam、tsc、smoke 全绿，旧运行时未接入。
- **代码基线未动，接盘时四条基线验证实跑全绿**：`npm test` 233/233、`npm run seam` 零命中、`npx tsc -b`、`smoke-sdk.mjs` 全部通过（ZCode 接盘时复跑，非沿用旧结论）。
- **方向变更 C1–C8**：双形态（桌面 exe 房主端 / 网页与原生客人 / 手机只做客人且网页优先 / 游戏形态自定）；运行时解耦（游戏独立进程，平台不挂载游戏 UI）；平台只持联机共识（连接、会话、票据、定序路由、发现、落盘），游戏全责玩法与全部 UI；权威从平台进程挪到房主机上的独立 Game Authority；平台 UI 只微调；房间级模块（规则配置 / 座位选项 / 资料 / 平台聊天）保留、对局级（game-host / 倒计时 / 结算 / 占位）删除；语言中立协议 + 各语言薄 SDK，`.bpmap` 从下发可执行模块改为清单与资源描述。
- **决策状态**：D1 平台持会话元数据=是；D2 权威放独立游戏进程=是；D3 color-duel 与 233 例=**推倒重来、不做兼容适配器**（改用「最小参考游戏」作 S2 验收基准，S2 回滚只能靠旧 Engine 分支 + 特性开关）；D4 形态分配=按推荐；D5 装技能、D6 并入 DESIGN 目录表=已定待执行；**D8 已拍板：三端统一设计与交互契约，网页 / 手机共用 Web 实现，桌面 exe 原生控件，不共用代码**；D7 平台 UI 微调已完成逐屏评审与修正（见下）。评审输入包第 8 节剩余前提（规模、语言优先级、wss 路线、预算、合规）不阻塞 S1，阻塞 S5。
- **平台 UI 口径**：信息条上「规则设置 / 游戏资料」两个独立入口，规则改成房主点开才展开的接近全屏弹层（是房主选配游戏规则 / 玩法参数，不是「房规」）；下面席位配置与房间聊天等宽两栏；房主底栏五按钮「加电脑 / 请出房间 / 转交房主 / 解散 / 开始游戏」，客人是「准备 / 取消准备」；三档响应式（≥1120 宽 / 700–1119 中 / <700 窄）；沿用原色值令牌与三套 OFL 字体，无渐变、无关键帧、无发光。方向裁定 **Industrial / Utilitarian（工业仪表 / 规格表）**。
- **本会话六轮设计评审收口**（详见主方案 §2.6 第 1–8 条）：① 色彩三通道（`--bp-seat` 身份 / `--bp-seat-tag` 标记 / 状态由文字 + 勾图标）；② 对比度全部正文 ≥4.5:1；③ 状态矩阵落地为「连接」七态 + 顶栏下告警带；④ 字阶统一 `--bp-step`；⑤ 线型全站实线且语义补偿（readonly 与 disabled 分开）；⑥ 色板 8 色 + 一色一席去重 + 恢复默认闭环；⑦ 色相拉开（**琥珀 `--bp-warn` / 靛紫 `--bp-accent` 是共享令牌，锁死不动**）；⑧ 聊天行排版统一 + 箭头 `--bp-chat-mark` 跟随席位色。**未新建独立评审文档**，结论全部收进主方案；未动代码与 `docs/DESIGN.md` / `INTEGRATION_GUIDE.md` / `README.md`。
- **预览页现状**：`docs/research/平台UI预览.html` 自包含、离线字体、演示数据不连服务。本轮修正：8 色实测 0/37.7/83.7/142.1/188.7/238.7/280.1/324.9°、最小 **35.1°**；AI 改中性灰；默认琥珀 / 靛紫参与一色一席，恢复默认遇占用会说明原因；席位编号 19px 粗体按大号文字 ≥3:1；产品可点目标均 ≥44px；尾部横杠 / 叉共用 44px 居中槽；客人 / 房主底栏在宽中档对齐，窄档聊天输入恢复 65px 单行；预览分「手机 360 / 窄屏 320」，真实窄视口取消限宽，360@2x、390@3x、320@2x 均无横向溢出，DPR 读数同步；320 下昵称可省略但「你」徽记完整；窄档复制 / 规则 / 资料同排（复制为 44px 图标按钮），只显示占用席位，底栏可继续加电脑；桌面与中档保留空位图；窄档不常显原始邀请链接；聊天默认 52px 摘要条，打开为右侧抽屉并复用同一消息 DOM / state，带宽中档切换自动关闭；实测 360 / 390 / 320 内容高度均由 1110.8 降至 **704.4px**（−406.4，36.6%）；弹层与色板焦点闭环；空位前置加号添加电脑，占用席位尾部叉删除（电脑直删、真人确认，客人无行内管理）；昵称模板统一转义。验证均为本次实跑：无头 Edge 宽中窄与 320 视口、10 次 Tab 不离开弹层、Escape 归还焦点、颜色释放 / 阻塞 / 聊天箭头联动、昵称注入不产生节点；HSV / WCAG 实算、`node --check`、静态重复 id / 渐变 / 虚线 / keyframes 检查通过。脚本在 `%TEMP%\bp-review\`，**不入库**；真机触控、辅助技术、字体实际渲染与持久化仍未验证。
- **对既有产物的影响**：`docs/research/新版平台与SDK设计方案.md` 附录 A/B 已提炼旧评估实证与决策历史；两份过时过程文档（`平台与游戏交互设计评估.md`、`双形态解耦设计变更跟踪.md`）已按用户要求物理删除，不保留归档。

## 4. 下一步

1. **S1 首轮契约已完成，继续多语言与 mock**：`protocol/v0/` 已含 40 条消息目录、JSON Schema、错误码、能力清单、8 个示例，9 条新测试随 npm test 发现；下一步两种语言生成类型并互解消息，再做最小参考游戏 + mock。评审包 §8 前提不阻塞 S1，阻塞 S5。
2. **真机与辅助技术验证**：本轮已补无头 Edge 真渲染与交互实测，但**未做真机触控 / 字体实际渲染 / 辅助技术 / 持久化验证**。S4 前必须补真机；当前 CDP 与静态校验脚本在 `%TEMP%\bp-review\`，若要长期维护应沉淀进 `tools/checks/`。
3. **把边界同步给「评估和设计游戏」会话**：它按 600×360 与 `.game-host` 准备样张，新方向下前提已失效。无会话列表、IM 通道被宿主策略拦、Agent 邮箱未开通；可行通路是共享文件（游戏仓库的 `.workbuddy/memory/` 与 `handoff/`），或 TeamCreate + 命名 teammate（那是新 agent，不是那个会话，不能冒充）。
4. **S1 起再动工**：先出字段级协议 spec + 错误码 + 能力清单 + 最小参考游戏；S1 只对 spec 生成的 mock Session Service 验准备 / 开始 / 动作 / 重连，S2 才验真实全链路。S5 前再决定要不要换架构类角色 / 技能（`architecture-design` + `electron-assistant` 只读查到、未装；apk / Android 无技能覆盖）。跨端仍待验证：语言中立线协议、Android 当房主的后台与 NAT、独立 origin 与 gameTicket 的真实浏览器行为。刻意不做：目录服务器 / 账号 / 好友 / 段位 / 匹配 / 反作弊仲裁 / 自动写防火墙规则。

## 5. MEMORY 提炼

- `docs/research/` 放调研 / 设计 / 评估类文档，**过时的直接删、不做归档**；不新建孤立评审文档，结论收进已有主方案（§2.6 / §2.7 / S4 / §5）；`docs/` 根只放原有正式文档。
- 视觉硬约束：沿用原色值令牌、三套 OFL 字体（Tektur / Outfit / Geist Mono，同源分发在 `fonts/`）、无渐变 / 无关键帧 / 无发光；**全站线型统一实线**；边框只保留**单层 1px 整圈靛紫高亮**，不要左轨信号轨、不要外圈 outline（用户两次否掉花哨方案）。方向 Industrial / Utilitarian。
- **共享设计令牌不可擅改**：琥珀 `--bp-warn` / 靛紫 `--bp-accent` 被警示、强调高亮、身份色、色板、聊天箭头共用，用户明确「不能改，因为其他 UI 也用到了，色系一致」。调整色板要**替换相近的邻居**，不动锚点；改色值前先查它被多少处引用。
- **昵称标签与昵称值都要突出**：不要把「昵称」缩成普通小标签来制造层级；桌面两者同为 22px，输入值 600 字重，中窄档同步降级。
- 平台身份资料与玩法分离：nick / avatar / displayColor 可作为只读 profile 传游戏；`displayColor` 不等于阵营色，阵营仍走 opaque options。默认琥珀 / 靛紫也参与一色一席占用，不能只统计自定义色。
- 术语精确：「游戏规则 / 玩法参数」是房主选配的游戏侧规则，不是「房规」；按钮是「开始游戏」「请出房间」；项目无账号系统，准确说法是「加入会话 / 进房」，不是「登入」；用户可见文案不出现「进程 / 相位 / sessionConfig / rulesHash / revision / lobby / 准备闸」等内部架构词。
- 验收口径：**改了 A 必须联动 B**（昵称→席位/聊天/弹层候选；席位色→左轨/图标/编号牌/聊天箭头；席位变化→计数/按钮禁用态/开始闸）；状态变了不能显示旧数据；禁用态要写明原因；间距与高亮全局一致；每次改完自己测，不要等截图挑刺。
- **用户给的是「观察 + 诉求」，不一定是最优解**（用户明确要求「不一定按我说的做，要给出专业的判断」）：先判断背后的真实问题，再选代价更小的方案；照做时补被抹掉的语义，不照做时说清理由与等效替代，并把判断依据写进文档。**写进文档的量化结论（色相差、对比度、数量）必须实算**，估值不写成结论。
- 跨会话无直连能力，「评估和设计游戏」会话的结论只能从共享文件读；宿主用户级 memory 为空块，项目级日志在项目内 `.workbuddy/memory/`（不入库）。

## 6. 关键约束与易踩的坑

- **包边界与接缝闸门**：游戏运行时只依赖 game-sdk；server/client 不 import game-sdk；wire 类型留在 protocol，`GameModule` 留在 core-abi。`tools/checks/check-seam.sh` 扫玩法词与 `games/` import；不加例外，注释也别提旧游戏名。
- **引擎状态与广播不变式**：任何可见状态变更都要 bump，否则「客户端收到却不更新」；出站目标在创建时解析成 connIds，别「先改会话表再投递」；新增广播走 `Engine.toRoom/toSeat`；游戏侧不持有 socket、不改 `Room.phase` / 座位表，玩法错误码走 `event`，`Effect` 是唯一出口。
- **权威与端口**：`Engine.persistable/syncStore/restoreFrom` 只允许 `hostd host`；host 的两个监听必须共享同一 `Engine` / `HostStore`；`--port` 本机界面（3178，只绑 127.0.0.1），`--lan-port` 对外（3000）；`--no-lan` 关监听与组播，`--no-announce` 只关组播。
- **安全与操作红线**：盘上只有 `secretHash`，`HostStore.fileFor` 卡死房号字符集防路径注入；不写防火墙入站规则、不建议关 Smart App Control、不 force push；本地壳页面必须 http 才能连 `ws://`；注入的宿主方法不能 `this.x()` 调用（fetch 存字段再调用会 `Illegal invocation`）。
- **收尾与测试写法**：Windows `kill('SIGTERM')` 是硬杀，别靠它断言 `run.json` 被删；`server.close()` 有 keep-alive/WS 时不回调，先 `closeAllConnections()` + 超时竞速；`node --test` 用带引号的 glob 并带 `--test-timeout`；等消息按 predicate 等符合条件的那一帧。
- **单入口与启动器**：`.bat` 用 `start "标题" node …` + `exit /b 0`，UTF-8 无 BOM + CRLF + 第 2 行 `chcp 65001`，中文只在 chcp 之后；生成走 `tools/packaging/gen-bat.mjs`，由 `bat-entries.test.mjs` 钉住；加入/重连的 hello 不带大厅选中的游戏版本，只有建房才声明；纯进房不写 `data/` / `run-<port>.json`。
- **UI 验证与高度链**：精确量多档桌面尺寸用无头 Edge + CDP `Emulation.setDeviceMetricsOverride`；旧三栏 319px 高度链（`--bp-room-col-h` / 1256×708）在两栏等宽布局下已失效，S4 要重新量 1256 / 1440 / 320 三档；自绘下拉 `.bp-listbox-trigger` 自带 `min-height:40px`，只写 `height` 会被顶回去。
- **规则表单与房主面板**：`ruleConfig` 字段 key 必须小写，游戏自己的 `normalizeConfig` 负责映射；资料入口先过 `isValidGameReferenceEntry`，图片路径只走 `/games` 同源路由，文本一律 `textContent`；房主面板每个动作按钮渲染时判断「此刻合法吗」，不合法置灰并写原因（`aiFillBlocker` 是范例），别把服务端错误码当提示。
- **多会话与跨仓边界**：只 stage 自己的文件，禁止 `git add -A` / `git stash`；SDK 包与平台/客户端分属不同会话，抢写会打断 `tsc -b` 和测试；color-duel 的坑在它自己的 CONTEXT，不要在本仓库重复维护。
- **预览页与新坑（合并）**：Chrome 对文本 input 鼠标点击也匹配 `:focus-visible`；`readonly` 聚焦常驻会让 `:has(input:focus)` 区域联动不退，故区域联动必须排除 `[readonly]`（旧修复别改回去）；元素复用 class 会把窄档 grid 套错；动态重绘后事件要委托、焦点不能还给游离节点。**CSS 变量优先级**：内联 `style="--bp-seat:…"` 会压掉 `.seat.is-ready` 状态色，故身份 / 标记 / 状态拆三条通道，状态用文字 + 勾图标表达。**`readonly` ≠ `disabled`**：前者仍要点选复制，静态观感可弱化但 hover/focus 动效必须与普通输入框一致；`input[readonly]:not(:focus)` 用 `:not` 避免覆盖 `input:focus` 抬底。**跨轮状态链**：席位色、聊天箭头、占位色、告警带都是同一份 `state` 派生，改色 / 请出 / 恢复默认必须全链路重算，任一处漏联动就会显示旧数据。DOM 桩验逻辑与状态，验不了视觉「挤不挤」、字体加载、真机触控与辅助技术；色板 / 列表重排后按索引定位的断言会失效，要按 `data-color` / `data-role` 等稳定标识定位。

## 7. 验证命令

```bash
npm test                         # 242 例（含 S1 契约 9 例）
npm run seam                     # 接缝闸门
npx tsc -b                       # 类型检查
node tools/checks/smoke-sdk.mjs  # 外部消费者 smoke
node --test --test-timeout=20000 tools/testkit/test/s1-protocol.test.mjs  # S1 契约 9 例
```

提交前跑 `npm test` + `npm run seam`；提交后直接 push 并核对远端 HEAD，禁止 force push。便携包 `dist-portable/` 不入库。**ZCode 接盘时四条全部实跑通过**（233/233、seam 零命中、tsc、smoke-sdk），未改任何实现代码。本轮预览页验证升级为无头 Edge 真渲染 + CDP 交互：1256 / 800 / 320 设备档、真实 320 视口、360@2x / 390@3x / 320@2x 手机模拟、房主 / 客人底栏、横杠与叉槽位、产品可点目标、窄档聊天抽屉发送 / 摘要 / 遮罩 / 焦点闭环、颜色占用与释放、弹层 Tab / Escape、昵称转义均实测通过；HSV 最小色相差 35.1°，对比度按正文 / 大号文字分别实算。脚本在 `%TEMP%\bp-review\`，**不入库、换机需重建**，若要长期维护应沉淀进 `tools/checks/`。真机触控 / 字体实际渲染 / 辅助技术 / 持久化未验证。

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

- 2026-11-11 ZCode：**六维评审、设计检查点与 S1 首轮契约**：接盘四条基线全绿；评审发现 ready/start 归属、身份色与游戏选项、网页游戏同源安全三处边界矛盾，以及 S1 mock/真实链路、S4 35° 与实际 29.6° 等口径问题。按用户决定修正两份设计文档与预览页：ready/start 归平台、开始后拉起权威，profile 传游戏，网页游戏独立 origin + 受限 gameTicket；UI 调整昵称双突出、8 色最小 35.1°、AI 中性灰、默认色占用、44px 触控、底栏对齐、320 溢出、焦点闭环、席位前加后叉与真人确认、模板转义。实跑无头 Edge / CDP、HSV / WCAG、`node --check`、静态约束检查全过；设计检查点 `e961af1`；S1 新增 `protocol/v0/`、40 条消息与 9 条契约测试，完整回归 242/242、seam、tsc、smoke 全绿；未改旧运行时，真机与辅助技术未验。
- 2026-11-11 WorkBuddy：**设计评审与逐屏收口**：接盘时四条基线验证实跑全绿；随后按前端美学框架完整评估候选 v0，并按用户「开始」+ 六轮逐屏反馈把结论全部落地到 `docs/research/平台UI预览.html`（色彩三通道、对比度、七态告警带、字阶令牌、全站实线、8 色去重、共享令牌锁定、聊天格式统一与箭头联动），同步收进 `新版平台与SDK设计方案.md` §2.6 第 1–8 条 / §2.7 落点表 / S4 / §5 验收。**未新建独立评审文档、未改代码、未动正式文档**。验证：静态 76/76、DOM 桩 90/90、`node --check` 通过，对比度全达标；脚本为 `%TEMP%` 临时桩不入库。候选 v0 仍未批准，D8 未拍板；真机 / 辅助技术未验证。压卡判定：96 行、4 条记录、10 类坑均在限内，**无需压卡**。
- 2026-11-11 WorkBuddy：**评估与设计会话收工**：全会话只读评估 + 设计，未改代码。产出 `docs/research/` 三份文件（新版平台与 SDK 设计方案 v0、架构评审与决策输入包、平台 UI 预览 HTML + 6 个 OFL 字体），删除两份过时过程文档；D1/D2/D3/D4 按用户拍板、D7 逐屏迭代到 v4、D5/D6 待执行、D8 未拍板；预览页 38/38 DOM 桩自测通过；旧状态流水与最旧 6 条交接记录沉降到 [COMPACT_BACKUP.md](COMPACT_BACKUP.md)。

<!-- multi-agent-task-handoff: scope=handoff -->
