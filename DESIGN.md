# 3178-battle-platform（3178 对战平台）· 方案设计

> 面向方案评审者与二次开发的人：为什么这么设计、包与包之间的接缝、接入契约、线协议、开发命令、哪些语义已经定死。使用者说明见 [README.md](README.md)，进度、逐阶段验收凭据与 agent 交接记录见 [CONTEXT.md](CONTEXT.md)。
> 最近更新：2026-10-20
>
> 本仓库推到 GitHub，文档内部一律用仓库相对链接（`file:///D:/...` 在别人机器上是死链）。
> 数字都是实测的，改动时请同步这里。

## 问题与目标

做一个**游戏无关的宿主制联机对战平台**：每人本机跑一个可双击的客户端，谁建房谁的进程就是服务器，别人从局域网列表或邀请链接进房——war3 对战平台那个形状。玩法通过 `GameModule` 契约插进来，平台自己只管房间、座位、房主权限、准备、聊天、观战、电脑位、掉线宽限、版本闸、落盘与传输。

约束（每条都直接逼出下面的设计）：

- **离线双击可用**：不能要求朋友装构建工具、买服务器或备案。
- **平台与玩法必须真的能分离**：否则它就不是平台，只是又一个游戏。
- **手牌这类私有信息不能泄**：观战与他人看不到别人的秘密。
- 权威只能落在某一台机器上——不做分布式，也不做中央服务器。

成功判据（都可机器验证，不是自述）：`tools/check-seam.sh` 在平台包内**零命中**玩法词；仓库自带两个形状完全不同的合成游戏（`echo` 回合制 + 有隐私 / `turncount` 无回合游标 + 无隐私 + 同时操作，不是实时动作游戏）作为"契约确实无关玩法"的活证据；协议层与 UI 层两层猴测无违规。逐阶段实测数据在 [CONTEXT.md](CONTEXT.md) 的「阶段状态与逐文件验收凭据」。

## 设计思路


| 决策 | 理由 | 代价 |
|---|---|---|
| **TypeScript（Node ESM）编译后跑在官方签名 `node.exe` 上**，不自建单文件 exe | 本机 Smart App Control 实测为强制（注册表 `VerifiedAndReputablePolicyState=1`），未签名 exe 被拦且**没有"仍要运行"**；官方 `node.exe` 签名有效。Go/Rust/Electron 都要自带未签名二进制，在这台机器上是死路 | 交付物是"一个文件夹 + 快捷方式"，观感不像正经客户端；要单文件得先买代码签名证书 |
| **本机只保留一个 UI origin（`http://127.0.0.1:3178`）**：host 模式在同一进程里再开 `0.0.0.0:3000` 给局域网，两个监听共享一个 `Engine`；两个启动器都打开 3178 | 昵称、地址簿、票据都按 origin 存，两个入口就是两份互不相通的存储（用户实测过"换个入口昵称就变"）；而邀请链接必须给局域网/隧道地址，页面自己却永远在本机回环上 | 一个进程要管两个 `http.Server` + 两个 `WsTransport` 的生命周期；`--port`（界面）与 `--lan-port`（局域网）语义分开；测试要覆盖"私网建房、公网进房"（[dual-listener.test.mjs](packages/hostd/test/dual-listener.test.mjs)） |
| **平台与玩法只经由 `GameModule` 契约通信**，平台源码内禁止出现任何玩法词（`tools/check-seam.sh` 当闸门） | 旧代码 `Room` 同时是座位管理器和规则引擎，回合游标被规则与 eject 两边改；不立字据的"分层"下一次重构就又被穿透 | 加一个游戏要写 manifest/normalizeConfig/create/resume 一套接口，比在旧代码里加个字段麻烦 |
| **引擎与传输分离**：`Engine` 只吐 `Outbound[]`，`WsTransport` 负责 socket | 证明"无关玩法"的契约测试不需要真端口、真网卡，毫秒级跑完（当前全量 **112 例**里，契约套件 20 例是纯内存的）；真 socket 另有一套端到端测试兜底 | 出站投递要显式 `publish()`，多一层心智负担 |
| **出站目标在创建时就解析成具体连接**（`Target.connIds`） | 关房与进程退出会先清会话表再投递，按"房间"寻址会让最后一条通知凭空消失——测试就是这么抓出来的 | 消息一旦生成就不能靠后续房间状态寻址 |
| **座位带 `slot / team / role / ready`，但颜色和队伍语义归游戏** | war3 的队伍/颜色本来就是地图自定义的；平台只需要知道"这是几号位、谁准备没准备、谁观战谁是电脑" | 客户端要渲染队伍得去读 `game` 里的自定义字段 |
| **游戏不许碰 socket，只能返回 `Effect[]`**（broadcast/toSeat/notice/system/end/kick） | 一旦游戏能直接发帧，投递、限流、视角、审计就各走各的；平台侧的"每次状态变更必须推进 revision"也守不住 | 游戏要做的动作得先设计成 Effect，跨端事件名没有集中枚举 |
| **`revision` 由 `Room` 的每个变更点自动推进**（入座/连上/断开/离座/聊天都算） | 客户端按 revision 去重。不推进的话新快照会被当重复帧丢掉，观感是"人进了房但桌上没显示" | 聊天这类高频事件也会推版本号，客户端不能拿它当"开局才变"的信号 |
| **入席下发票据，`seatResume` 必须带票据** | 旧项目 `rejoin` 只要猜中房号+座位号就能占座（座位 id 是 6 位 base36）；盘上只存摘要，拿到快照文件也占不了座 | 票据丢了（清浏览器数据）就只能重新入座，旧座位要等宽限到期 |
| **`deadline` 一律下发相对毫秒 + `serverNow`** | 旧客户端拿本地 `Date.now()` 比服务端的绝对时间戳，两台机器时钟不齐时倒计时直接失真 | 客户端要维护一个单调钟外推，UI 逻辑多一步 |
| **房间发现走 B+A 两档**：同网段 UDP 组播信标（要本地壳）+ 地址簿/邀请链接（纯浏览器也能用） | 房间列表在 war3 里由战网中央目录提供；没有常开公网节点就没有"随时上线逛房间"。组播是唯一不需要公共服务器的实时列表 | 组播只限同网段，且首次绑定会让 Windows 弹窗（由用户亲手点允许，脚本绝不写防火墙规则）；跨网只能靠房主发链接 |
| **落盘只发生在房主机**，玩家端不写 `data/` | 每个客户端都有自己的快照目录时，"谁是权威"就说不清了 | 房主机器关机=这局没了，这是宿主制而不是分布式 |
| **小字一律给中文补黑体回退**：`--bp-font-mono` 从 `"BP Mono", Consolas, monospace` 扩成再跟一档 `"Microsoft YaHei UI" → "Microsoft YaHei" → "PingFang SC" → "Noto Sans CJK SC"`；标签与小标题 12px→**13.5px**、字距 0.2em→**0.08em**、颜色 `#8b8b9e`(5.38:1)→`#9c9cb2`(6.68:1)；说明文字 13/13.5px→**14.5px**；状态行 14→**15px**；**房间屏同类小字一起改**（连接条 13→15px，它与状态行是 `setStatus` 同时写的同一类字；席位状态 12→13.5px；HUD 微标签 11→12.5px 且字距 0.26em→0.18em；系统聊天行 13→14px；游戏占位段 12→14.5px）；开关**高度与旋钮都不变（20px / 15px），只把轨道从 32px 加长到 44px**；**右上角"昵称"这两个字单独提一级**（标签 13.5→26px＝品牌"3178 对战平台"30px 小两号、加粗、亮紫 `#818cf8`；**输入框保持原样** 17px / 52×220） | 用户："红框里的字体稍微大一些、好看一些，所有页面同类型都要改"。根因不是字号一个维度：**Geist Mono 与 Consolas 都没有中文字形**，原来字栈到 `monospace` 为止，中文只能掉进系统对 generic monospace 的默认中文字体（Windows 上通常是中易宋体），再叠 0.2em 字距就成了"又小又散又瘦"。拉丁与数字仍走 Geist Mono（逐字符回退，房号/倒计时的等宽感不受影响） | **中文具体掉到哪一款字体我们无法直接证明**（宽度量不出字形差别，`document.fonts.check` 也不是字形覆盖测试），能证明的只有"栈里没有中文字体"这一条；观感结论归用户。开关的旋钮位置 Tabler 是按 `calc(100% − 旋钮 − 偏移)` 算的，所以加宽轨道会自动走到位、**不需要手写位移**，但 `.form-switch` 的 `padding-inline-start` 要跟着从 40px 加到 52px，否则白点会压住文字（实测间隙仍是 8px）。改字号的决策辅助页：[预览-字号与开关.html](packages/client/public/预览-字号与开关.html)（四栏字号对比 + 开关四档 + 昵称三档，全用真字体真色值，双击可开） |
| **同时做两个合成游戏，而不是先接一个真游戏** | "平台无关玩法"是不可证的口号，除非有第二个形状不同的游戏。`turncount` 连回合游标都没有 | 多写约 300 行测试用游戏代码，但这是整个平台阶段最便宜的证据 |
| **表现层底座用成熟开源框架 `@tabler/core`（MIT），上面只盖一层主题**：尺度整体放大一档（正文 16.5px、控件 52px、席位行 68px、房号 58px 展示体）；字体是 **Tektur（展示）+ Outfit（拉丁正文）+ Geist Mono（数字/标签）**，身份符号用同源图标字体 `@tabler/icons-webfont`（皇冠/机器人/眼睛/圆勾，不再堆 emoji），logo 是内联 SVG 几何徽记（菱形套菱形 + 两翼，不再是色块里塞"3178"） | 用户三轮否掉手写 CSS 的观感（"排版小气"、"颜色也丑"），继续手搓只会第四轮返工；方向 C 由效果图选定。Tabler 是成熟面板风，卡片/表单/按钮/徽章/栅格都是别人打磨过的，且它自带 Bootstrap 5、纯 CSS 文件、样式不需要 JS，"无构建 + 离线双击"仍然成立 | **Tabler 的颜色用 oklch → 浏览器底线抬到 Chrome/Edge 111+**（因此我们自己的 CSS 仍不写 oklch，也不写 `@layer`）；`tabler.min.css` 635KB + 图标字体 520KB 从 `node_modules` 挂 `/vendor/` 同源路由（不把产物复制进仓库），**便携包由 [tools/build-portable.mjs](tools/build-portable.mjs) 预拷这两个 dist 子集（外加 `ws` 与 `@bp` 实体副本）**；`.hidden` 要自己留着（Bootstrap 5 不再提供）——这条和"左轨靠特异度而不是书写顺序"都由 `style-hooks.test.mjs` 钉住；三套字体约 290KB（Tektur 152KB + Outfit 110KB + Geist Mono 157KB 里取三个文件），中文没有随包（体积与授权都不划算），仍走系统黑体 |
| **下拉框换成自绘 listbox，但保留原生 `<select>` 当唯一数据源**：`packages/client/src/listbox.js` 给每个 `select.form-select` 套一个按钮 + 自画弹层，选择时写回 `select.value` 并派发 `change`，app.ts 的读写与 `replaceChildren` 重建一行没改 | Windows Chrome 的 `<select>` 展开层是**系统控件**：CSS 管得到每行底色与选中行，管不到"鼠标划过"那条，会落回系统浅蓝（用户两次截图问"这个颜色怎么这个样子"）。用户在三档选择里点了"换自绘下拉（彻底治）" | 代价是**自己实现交互**：上下键/`Home`/`End`/`Enter`/`Esc`/`Tab`、点外面收起、`aria-expanded`/`role=listbox`/`aria-selected`。**没实现 typeahead**（原生 select 支持"按字母跳到该项"，这里不支持）；焦点仍在触发按钮上，用 `aria-expanded` 表达状态。同步时机是个坑：`syncAll()` 必须排在**重建选项之后**（原来放在 `render()` 开头，导致 `kick-target` 的按钮标签比 select 慢一帧、最长 500ms 是空的——UI 猴测抓出 26 条才暴露）。原生 select 用 `display:none` 藏起来（`opacity:0` + 绝对定位仍会留下一个 58px 的盒子，select 有内在最小宽度）。**同一行里的对齐要自己管**：`.input-group > .bp-listbox` 必须参与本行的 flex 伸展，否则两件事同时坏——空下拉里没有文字，flex 的内容高度只剩那枚 14px 箭头，于是它 40px、旁边按 padding 撑出来的按钮 46.1px（底边差 6.1px，用户截图就是这里），而且包装层不是表单控件、拿不到 `.form-select` 的伸展，宽度只剩 64px。现在这两条都由 UI 猴测的几何不变式盯着（改前实测报 128 条，改后 0 条） |
| **底色与动效照抄 `apigoto.com` 的实测值（紫底靛强调）**：底色五阶 `#0a0a0f / #111118 / #16161f / #1c1c28 / #23233a`（近黑带紫，不是明显的紫），强调 `#6366f1`（hover 抬到 `#818cf8`），紫 `#8b5cf6` 管电脑位、粉 `#ec4899` 管观战、琥珀 `#f59e0b` 管房主、绿 `#22c55e` 管已准备；动效**只放开 0.2~0.3s 过渡**——参考站实测 0 个 `@keyframes`，只有 hover 换描边 + `translateY(-2px)`，所以我们也不写关键帧、不写渐变、不写发光 | 用户给了参考站并三选一点定："近黑带紫照抄 / 只放开 0.2s 过渡 / 字体不动"。参考站自己用 11 处渐变和 `0 0 20px rgba(99,102,241,.15)` 发光，但上一轮"不要动画渐变"的约定仍然有效，所以那两档**没跟**（要跟得改防回归测试，等用户点头）。字体保持本地三套（Tektur/Outfit/Geist Mono，OFL 同源分发）：参考站的 Inter/JetBrains Mono 是外链 CDN，离线便携包会当场退化 | 全站过渡时长被测试钉成"≤0.3s 且不许 `all`"（`style-hooks.test.mjs`）；`.btn-primary` 静止态填色从参考站的 `#6366f1` 降到 `#4f46e5`——白字压在 `#6366f1` 上是 4.47:1 不到 AA（参考站自己也没过），降一档后 6.29:1，hover 才回到 `#6366f1`（瞬时态 4.47 已知）；状态行与房号铭牌改用抬亮的 `#818cf8`（6.02:1）而不是实心靛紫（4.02:1）；下拉框的箭头必须自己画——`.form-select` 用 `background:` 简写会把 Tabler 的 `background-image` 清成 `none`，`appearance:none` 之后原生箭头也没了，所以守卫测试同时钉"有箭头"和"这两条规则里不许出现 background 简写"；展开列表要显式给 `option` / `option:checked` 上色，否则选中条是系统浅灰 |

## 架构与关键接缝

四个包 + 两个游戏 + 一组工具，接缝只有三处：**线协议**（`packages/protocol`，消息目录与错误码是唯一的字据）、**`GameModule` / `GameInstance` 契约**（`packages/server/src/module-api.ts`，平台运行时按 id 动态加载 `games/<id>/dist/index.js`，源码里不 import 它）、**`Effect[]` 出口**（游戏碰不到 socket，投递、限流、视角裁剪、审计才守得住）。

接入方法、线协议与开发命令见本档后面的「接入契约」「线协议」「开发与构建」；这里只列文件清单。


| 文件 | 用途 |
|---|---|
| [README.md](README.md) | 本档案：设计取舍、阶段状态、协议速查 |
| [CONTEXT.md](CONTEXT.md) | 交接档案：当前状态、待办、坑与不可逆操作 |
| [package.json](package.json) | npm workspaces 与 `build/test/seam` 脚本 |
| [tsconfig.json](tsconfig.json) / [tsconfig.base.json](tsconfig.base.json) | 项目引用（`tsc -b`）与共享编译选项 |
| [tools/check-seam.sh](tools/check-seam.sh) | 接缝闸门：平台包内不得出现玩法词或 `games/` import |
| [tools/build-portable.mjs](tools/build-portable.mjs) | 绿色便携包：校验签名 `node.exe`、装配运行时子集、生成便携版启动器、自检后产出 `dist-portable/`（不入库） |
| [tools/monkey.mjs](tools/monkey.mjs) | 协议层猴测：多开模拟用户随机发帧（含 6 类故意非法）+ 随机硬重启房主端，**每帧跑 15 条不变式**（revision 单调、房主唯一、座位不超槽、票据不被拒、秘密不外泄…）+ 6 条运行级检查；违规带 seed 可复现；**收尾按 mtime 只删本次运行造的 `room-*.json` 与自己的 `run-<port>.json`**（`data/` 与用户真实跑房共用，绝不批量删） |
| [tools/monkey-ui.page.js](tools/monkey-ui.page.js) | 页内注入的 UI 层猴测：真实页面里开同源 iframe 当并发真人，随机点击 + **10 组界面不变式**（A 两屏互斥 / B"你"最多一个 / C 状态行不漏英文码 / D 席位行数与槽位一致 / E 无座不许能点准备 / F 倒计时格式 / G 静默丢失类（箭头、空标签、aria 与可见性、弹层无阴影）/ G2 同行下拉与按钮等高齐底 / H 同行面板卡底边对齐 / I 横向溢出），再加两条"死点击"规矩（`auditButton` 要求亮着的按钮点下去必须留下反应、`checkLegality` 要求下拉选不出值时旁边的按钮不许亮） |
| [tools/repro-persist.mjs](tools/repro-persist.mjs) | 量"建房成功 → 盘上出现房文件"的延迟，即硬杀会丢房的窗口 |
| [tools/repro-resume.mjs](tools/repro-resume.mjs) | 房主+玩家同房 → 硬杀 → 各自拿真票据重连，最坏情况"加入后 0ms 就杀"，用来验"票据离开进程前座位必须已在盘上" |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 探索性 QA 报告：**15 条问题（4 High / 9 Medium / 2 Low）**、修法、实测证据、复跑计数、**猴测台自己的 9 个缺陷**（含两次"断言空转被反向验证抓出来"）与未覆盖范围 |
| [packages/protocol/src/wire.ts](packages/protocol/src/wire.ts) | 消息目录与房主命令表（含中文说明的 `MESSAGE_CATALOG`） |
| [packages/protocol/src/codes.ts](packages/protocol/src/codes.ts) | 平台错误码与通知码文案 |
| [packages/protocol/src/hash.ts](packages/protocol/src/hash.ts) | 稳定摘要（房规/版本闸） |
| [packages/protocol/src/manifest.ts](packages/protocol/src/manifest.ts) | `GameManifest` 形状检查与握手比对 |
| [packages/protocol/src/seats.ts](packages/protocol/src/seats.ts) | 座位/相位/房间视图与组播条目形状 |
| [packages/protocol/src/guard.ts](packages/protocol/src/guard.ts) | 入站消息形状闸门（缺字段/多余字段/超长） |
| [packages/server/src/engine.ts](packages/server/src/engine.ts) | 引擎：线消息 → 房间/游戏操作 → 出站编排（心跳、终局语义、限流） |
| [packages/server/src/room.ts](packages/server/src/room.ts) | 座位表、房主标记、聊天环形缓冲、revision、落盘导出/恢复 |
| [packages/server/src/authority.ts](packages/server/src/authority.ts) | 权限判定集中处：房主/座位/票据/开局闸/加入闸 |
| [packages/server/src/module-api.ts](packages/server/src/module-api.ts) | `GameModule` / `GameInstance` / `Effect` 契约 |
| [packages/server/src/loader.ts](packages/server/src/loader.ts) | 运行时按 id 动态加载游戏模块并校验契约 |
| [packages/server/src/transport.ts](packages/server/src/transport.ts) | ws 薄壳：握手、编码、Origin 策略、心跳 |
| [packages/server/src/store.ts](packages/server/src/store.ts) | 房主侧原子落盘与坏文件处理 |
| [packages/server/src/discovery.ts](packages/server/src/discovery.ts) | 局域网组播信标：房主广播、浏览端过期表 |
| [packages/server/src/registry.ts](packages/server/src/registry.ts) | 房号分配与房间表 |
| [packages/server/src/ids.ts](packages/server/src/ids.ts) | 房号/座位 id/票据与摘要比对 |
| [games/echo/src/index.ts](games/echo/src/index.ts) | 合成游戏 A：回合制 + 隐私 |
| [packages/client/src/endpoint.ts](packages/client/src/endpoint.ts) | 房主地址解析与邀请链接（含 https 连明文 ws 的拦截提示） |
| [packages/client/src/connection.ts](packages/client/src/connection.ts) | ws 连接层：指数退避重连、心跳、协议帧校验 |
| [packages/client/src/clock.ts](packages/client/src/clock.ts) | 服务端时间轴：`serverNow` + 单调钟外推 + 半个 RTT 补偿 |
| [packages/client/src/local-store.ts](packages/client/src/local-store.ts) | 地址簿、昵称、座位票据保管（按房主 + 房号隔离） |
| [packages/client/src/view-model.ts](packages/client/src/view-model.ts) | 帧流 → UI 状态归约（revision 去重、聊天环形缓冲、开局阻碍清单、重连房号 `resumeCodeFor`） |
| [packages/client/src/module-loader.ts](packages/client/src/module-loader.ts) | 游戏模块拉取 + sha256 校验 + blob 导入；缺入口时占位渲染 |
| [packages/client/src/listbox.ts](packages/client/src/listbox.ts) | 自绘下拉：原生 select 当数据源，按钮+弹层自己画（含键盘与点外关闭） |
| [packages/client/src/app.ts](packages/client/src/app.ts) | 界面装配：大厅 / 房间内 / 对局挂载点 |
| [packages/client/public/index.html](packages/client/public/index.html) | 页面骨架与 import map（浏览器原生 ESM，无打包步骤） |
| [packages/client/public/style.css](packages/client/public/style.css) | 主题层：覆盖 Tabler 变量 + 大气尺度 + 席位名册/HUD/动效（不重写框架组件） |
| [design-refs/](design-refs/E-cyber-minimal.png) | 八张方向效果图（A–H），选定的是 [C-tabler-dashboard.png](design-refs/C-tabler-dashboard.png) |
| [packages/client/public/fonts/](packages/client/public/fonts/Tektur-Medium.ttf) | 同源分发的 OFL 字体：Tektur 展示体 + Outfit 拉丁正文 + Geist Mono 数字，含各自许可文本 |
| [packages/hostd/src/cli.ts](packages/hostd/src/cli.ts) | 宿主壳：host / join / diagnose / stop 四个模式 |
| [packages/hostd/src/webroot.ts](packages/hostd/src/webroot.ts) | 静态与接口路由（`/app/`、`/vendor/protocol/`、`/games/`、`/api/games`、`/api/self`、`/discovery/rooms`） |
| [packages/hostd/src/tunnel.ts](packages/hostd/src/tunnel.ts) | cloudflared 查找与隧道网址解析（找不到就退回本地地址，不下载） |
| [房主建房.bat](房主建房.bat) / [玩家进房.bat](玩家进房.bat) | 双击入口（CRLF，由 [.gitattributes](.gitattributes) 锁住） |
| [tools/gen-bat.mjs](tools/gen-bat.mjs) | 生成上面两个 .bat，保证编码不变式（UTF-8 无 BOM / CRLF / chcp 先于中文） |
| [packages/hostd/test/bat-entries.test.mjs](packages/hostd/test/bat-entries.test.mjs) | 双击入口的编码与结构防呆 |
| [packages/client/test/client-logic.test.mjs](packages/client/test/client-logic.test.mjs) | 客户端无 DOM 逻辑测试 23 例（含"重连该按哪个房号翻票据"四条、`aiFillBlocker`、`seatPickerBlocker`、自绘下拉的纯函数） |
| [packages/client/test/style-hooks.test.mjs](packages/client/test/style-hooks.test.mjs) | 样式契约 11 例：扁平（无关键帧/渐变/发光）、过渡 ≤0.3s 且不许 `all`、下拉箭头必须存在且不许用 `background:` 简写、自绘下拉的类名都要有规则、字体同源且在盘上、`.hidden` 不能丢 |
| [packages/client/public/预览-字号与开关.html](packages/client/public/预览-字号与开关.html) | 观感决策辅助页：真字体真色值的四栏字号对比 + 开关四档 + 昵称三档，给"这类改动只退一半"用 |
| [packages/hostd/test/fixtures/sigint-after-boot.mjs](packages/hostd/test/fixtures/sigint-after-boot.mjs) | SIGINT 测试的注入钩子（在壳自己的进程里 `process.emit('SIGINT')`，因为 Windows 收不到外部 Ctrl+C） |
| [packages/hostd/test/hostd-http.test.mjs](packages/hostd/test/hostd-http.test.mjs) | 宿主壳集成测试（真起子进程、真 WS 连接、路径穿越） |
| [packages/hostd/test/sigint-shutdown.test.mjs](packages/hostd/test/sigint-shutdown.test.mjs) | Ctrl+C 收尾：SIGINT 后落盘、删 run 记录、退出码 0、端口释放 |
| [packages/hostd/test/shell-join.test.mjs](packages/hostd/test/shell-join.test.mjs) | 本地壳也带 WS：建房→加电脑→开局，并按端口各留一份记录 |

| [games/turncount/src/index.ts](games/turncount/src/index.ts) | 合成游戏 B：无游标 + 无隐私 + 同时操作（不是实时动作游戏） |
| [packages/protocol/test/protocol.test.mjs](packages/protocol/test/protocol.test.mjs) | 协议与摘要测试 |
| [packages/server/test/room-authority.test.mjs](packages/server/test/room-authority.test.mjs) | 房主权限/票据/座位模型测试 |
| [packages/server/test/contract.test.mjs](packages/server/test/contract.test.mjs) | 两游戏共用同一断言集的契约测试 |
| [packages/server/test/ws-live.test.mjs](packages/server/test/ws-live.test.mjs) | 真 socket 端到端 |
| [packages/server/test/store-discovery.test.mjs](packages/server/test/store-discovery.test.mjs) | 落盘恢复 + 信标编解码 |

## 接入契约

实现 [module-api.ts](packages/server/src/module-api.ts) 里的两个接口，游戏就接进来了。三条硬规矩写在文件头：状态不进平台对象、游戏不碰 socket、不改房间相位/座位表/房主权限。目录名必须等于模块自称的 `id`（`^[a-z0-9][a-z0-9-]{0,31}$`），加载器会拒绝不一致。

### `GameModule`

```ts
export const myModule: GameModule = {
  id: 'mygame', name: '我的游戏', version: '0.1.0',
  entry: 'client.js',                 // 相对 games/<id>/ 的 URL，不许含 '..' 或 http
  seats: { min: 2, max: 8 },          // max ≤ 16（manifest 校验硬上限）
  allowSpectate: true,
  soloFill: true,
  roles: ['host', 'player', 'ai', 'spectator'],
  normalizeConfig: (raw) => ({ /* 把房主原始设置收敛成确定形状 */ }),
  rulesHashOf: (config) => stableDigest(config), // 只摘要真影响对局的字段
  create: (config, ctx) => new MyInstance(config, ctx),
  resume: (snapshot, ctx) => { /* 从快照还原 */ },
  acceptsSnapshot: (snapshot) => snapshot?.version === 1, // 不兼容就丢弃，别硬解
};
```

`rulesHashOf` 只挑影响玩法的字段：房主改房名不应让客人报“房规不同”。`ctx` 提供注入的 `now()` / `random()`、`seats()` / `seat(id)`，测试因此可以确定性推进，不用真等计时器。

### `GameInstance`

- 必给：`serialize(viewer)` / `handle(action, by)` / `begin()` / `snapshot()`。
  - `serialize(viewer)` 里 `viewer === null` 是观战视角；隐私裁剪归游戏，平台不知道“秘密”是什么。
  - `handle` / `begin` 返回 `Effect[]`；非法动作返回 `reject('中文说明', 'PHASE')`，不要抛异常，也不要静默吞掉。拒绝文案会直接显示给玩家。
- 按需：`tick(now)`、`onSeatJoin`、`onSeatLeave`、`onTimeout`、`dispose`。
- `Effect` 六种：`broadcast` / `toSeat` / `notice` / `system` / `end` / `kick`。

放进 `games/<id>/`，`package.json` 的 `main` 指向 `dist/index.js`，根 `tsconfig.json` 的 `references` 加一行 `{ "path": "games/<id>" }`；漏了这步 `npm run build` 不产出 `dist/index.js`，而 `loadGames()` 会静默跳过没有该文件的目录。参考实现：[games/echo](games/echo/src/index.ts)（回合制 + 隐私）与 [games/turncount](games/turncount/src/index.ts)（无游标 + 无隐私 + 同时操作）。

### 客户端界面（可选）

`entry` 最终解析成 `<房主地址>/games/<id>/<entry>`。入口导出 `default` 或 `client`：

```js
export default {
  mount(host, view, actions) { /* 渲染 view；按钮里 actions.send('动作名', payload) */ },
  unmount(host) {},
  onEvent({ name, payload }, actions) { /* 服务端 broadcast 的事件 */ },
};
```

拿不到 socket、拿不到别人的座位，只有 `actions.send()` 与 `actions.seatId()`。没有界面也能跑：平台会退到内置占位面板（只认 `count` 的 `plus` / `minus`），所以新游戏在写出 `client.js` 之前能看状态、点不了动作。

## 线协议

| 方向 | 消息 | 要座位 | 要房主 |
|---|---|---|---|
| C→S | `hello` `roomCreate` `roomJoin` `seatResume` `resync` `ping` | 否 | 否 |
| C→S | `ready` `gameAction` `chat` `seatLeave` | 是 | 否 |
| C→S | `hostStart` `hostClose` `hostKick` `hostTransfer` `hostSeat` | 是 | **是** |
| S→C | `welcome` `seatGranted` `snapshot` `event` `chat` `notice` `error` `pong` | — | — |

完整字段与中文错误码文案在 [wire.ts](packages/protocol/src/wire.ts) 与 [codes.ts](packages/protocol/src/codes.ts)。

## 开发与构建

```bash
npm run build          # tsc -b 项目引用，无打包器
npm test               # node --test（当前 114 例）
bash tools/check-seam.sh                        # 闸门：平台包内不得出现玩法词
npm run portable                                # 绿色便携包（dist-portable/，不入库）
node tools/monkey.mjs --seed 707 --users 8 --steps 300 --restarts 3   # 协议层猴测
```

- `node --test` 跑目录参数在 Windows 下不可靠：必须用引号包住的 glob，并带 `--test-timeout`。
- `.bat` 由 [tools/gen-bat.mjs](tools/gen-bat.mjs) 生成，别手写；编码与启动器结构由 [bat-entries.test.mjs](packages/hostd/test/bat-entries.test.mjs) 钉住。
- 便携包由 [tools/build-portable.mjs](tools/build-portable.mjs) 汇编并自检，产物 `dist-portable/` 不进 git。

## 已定语义与边界

| 事项 | 结论 |
|---|---|
| 只有房主能开局 / 踢人 / 关房 / 移交 | 是，越权分别报 `NOTHOST` / `HOSTONLY` |
| 房主主动离开 | 弹窗二选一：直接关局 / 移交房主。平台侧表现为 `seatLeave` 被拒并提示"先移交或关房" |
| 移交 | 只转移权限，进程仍在原房主机；原房主再发命令报 `HOSTONLY` |
| 房主进程退出/崩溃 | 无法弹窗 → 广播 `HOSTLEFT` 并删局 |
| 玩家主动离座 | 立刻离座，不触发终局 |
| 掉线 | 对局中保留座位 30 分钟（可配），超时收回；**房主**掉线过久直接终局 |
| 断线重连坐回原位 | 按**人正在待的那个房**的房号去翻本机票据（不是大厅的房号输入框——自己建房的人那格是空的），房主与玩家一视同仁。票据已作废时：清掉本机票据、摘掉席位行的"你"，并把你原本点的那一下（加入）补发出去，不静默吞掉 |
| 加入方式 | 4 位房号（去掉易混字符）+ 房主地址；版本/房规不符报 `VERSION` / `RULES` 挡在门外 |
| 房间列表 | 局域网组播实时列表（需本地壳）+ 地址簿 + 邀请链接；不做目录服务器 |
| **链路断开时的房间命令**（2026-10-12 定，猴测规则抓出来的） | 一律**本地拒绝并说清楚**："和房主的连接断了，这条没有发出去。先点「重新连接」，修好再点一次。" 不再悄悄塞进待发队列——否则玩家点的"开始对局"会在重连成功那一刻突然生效。待发队列只留给拨号中的握手（`roomJoin` / `seatResume`），那正是"断线重连坐回原位"需要的 |
| **地址簿是同源共享的**（2026-10-12 定） | 地址簿每次读都走共享存储，所以另一个标签页"忘掉"一条时，本标签页的下拉里可能还留着那条假的。两条一起治：收到 `storage` 事件就重建下拉；点了已经不在簿子里的旧条目不再静默，报"这条地址已经不在簿子里了"并当场重建 |
| 游戏模块没带自己的界面 | 走平台自带的**占位状态面板**，这是正常降级不是故障：只在**进房挂载那一刻**说一句「测试回合制demo 没带自己的界面，先用平台自带的状态面板显示（拿入口得到 404）」，括号里的状态码留给接真游戏的人调试。**回到大厅会把状态行清掉**——否则房里最后一句会一直挂在大厅上，看着像大厅坏了（用户就是拿这句来问的） |
| **"按钮亮着"就等于"这一下真有效果"**（2026-10-12 定为规矩） | 房主面板与大厅里每个动作按钮在渲染时都要问一句"此刻这个动作合法吗"：`startBlockers`（人不够/有人没准备）、`aiFillBlocker`（游戏不支持电脑位/槽满）、下拉有没有可选值（`transfer-target` / `kick-target` / `address-book`）。不合法就变灰并把原因写进按钮文案，**绝不让玩家从提示里自己发现**。同一条规矩也管下拉本身：**没得选时格子里不留白**，而是放一条不可选的占位项写明原因（`seatPickerBlocker`：房里没有别人 / 无法移交电脑位 / 没有可移交的真人玩家…），触发器随之置灰（`.is-placeholder`），占位项也**不算"已选中"**（不吃那层选中紫）。UI 猴测把这条当规则在扫（`tools/monkey-ui.page.js` 的 `auditButton` + `checkLegality`） |

- **我们自己的 CSS 不写 `oklch` 与 `@layer`**：底座 Tabler 的颜色变量用了 `oklch()`，把浏览器底线抬到 Chrome/Edge 111+（用户视角的表现为按钮发灰、边框消失，全文见 [README.md](README.md) 的「限制与注意事项」）。给旧机器装包之前先确认浏览器版本。
- **底座体积**：`tabler.min.css` 635KB + 图标字体 520KB，从 `node_modules` 挂 `/vendor/` 同源路由（不复制进仓库）。便携包由 [tools/build-portable.mjs](tools/build-portable.mjs) 只预拷 `@tabler/core/dist/css/tabler.min.css`、`@tabler/icons-webfont/dist` 的 CSS+字体子集、`ws` 与 `@bp/*` 实体副本，成品约 **94MB**（其中官方签名 `node.exe` 约 88.5MiB）。
- **字体随包分发，许可文本不能丢**：`public/fonts/` 里的 Tektur、Outfit、Geist Mono 来自 `ui-styling` skill 的 `canvas-fonts/`，OFL 许可；打包（R1）时必须连 `.ttf` 带 `*-OFL.txt` 一起拷，测试里已经钉住"CSS 引用的字体文件必须存在于盘上"。没有中文字体随包（体积与授权都不划算），中文仍走系统黑体。
- **`.bat` 的编码是硬约束，不是风格问题**：必须 UTF-8 无 BOM + CRLF + 第二行 `chcp 65001`，且中文只能出现在 chcp 之后。否则 cmd 按 cp936 解析 UTF-8 字节，第二个字节落进 GBK trail 区（里面有个 `|`），**中文会被拼成命令分隔符**——表现为平白一句"系统找不到指定的路径"加一行乱码。另一个坑：在 Git Bash 里用 `node -e '...'` 写批处理，argv 里的 `nul` 会被 MSYS 路径转换改成 `/dev/null`，直接写坏文件；所以走 `tools/gen-bat.mjs`，并由 [bat-entries.test.mjs](packages/hostd/test/bat-entries.test.mjs) 钉住这些不变式。
- **`.bat` 只做启动器，不留在前台**：`start "标题" node …` 之后立刻 `exit /b 0`，所以双击的窗口一闪就没，进程跑在它自己的控制台窗口里。好处是 Ctrl+C 直接送给 node——落盘收尾后进程退出，窗口自己关，**不问"终止批处理操作吗(Y/N)"**（那句话只在批处理本身被 Ctrl+C 打断时出现）。代价是启动器拿不到 node 的退出码，环境缺失只靠那三条 `if not exist` 拦；失败分支特意留着 `pause`，双击的人看得见原因。
- **"按下 Ctrl+C 会收尾"验证到哪一步**：收尾处理器本身有测试（在壳自己的进程里 `process.emit('SIGINT')`，走同一个监听器：落盘 → 删 run 记录 → 退出码 0 → 端口释放）。但**"Windows 把控制台里的 Ctrl+C 投递成 SIGINT"这一步没法从外部模拟**——本机既不能向别人的控制台发 CTRL_C_EVENT，MSYS 的 `kill -INT` 也只认自己生的进程。那一跳靠的是 Node/libuv 自身的控制台控制处理器（装了 Node 就一直如此工作），不是我写的代码。
- **观感只能由你确认**：in-app Browser 无可见视口（`innerWidth` 报 0），我能证明"字体加载成功、规则命中、DOM 结构对了"，不能证明"好看"。
- **使用者视角的边界与误操作风险**——浏览器版本、还没做便携包、组播未双机实测、隧道域名每次变、游戏自带界面还没有、宿主制不防房主——**全文由 [README.md](README.md) 的「限制与注意事项」持有**，本档不重述，只留这一行指路。
- **下拉的鼠标划过高亮**：已换成自绘 listbox，弹层颜色完全跟主题；但**没有 typeahead**（原生 select 那种"按字母跳到该项"），长列表（地址簿很多条）要靠滚动。
- **从房主拉游戏模块 = 在你浏览器里执行房主给的代码**。哈希校验只保证"传过来的字节和房主声明的一致"，不保证"房主写的代码无害"。今天两个合成游戏没有客户端入口，实际跑的是内置占位渲染器，所以这条风险还没落地；**接真游戏前要把它关进沙箱 iframe（`sandbox=allow-scripts`，不给 `allow-same-origin`）**，否则房主能读你本机的座位票据与地址簿。
- **宿主制天然放弃一部分防作弊**：权威进程在房主机上，房主可改自己的秘密与判定；"按视角裁剪"只防透视，不防房主。
- **昵称的解析口只有一个**（2026-10-14）：`有效昵称 = 输入框 > 本机记住的上次 > 占位称呼「无名玩家」`，界面显示与 `hello` 都走 `currentNick()`，所以"屏幕上空白、发出去却是无名玩家"这种不一致不可能再出现。存储侧只收**真正填过的**名字：空字段与占位称呼都不写（`rememberNick`），清空输入框等于"这次没填"而不是"忘掉"。**为什么这条要立字据**：原实现只在 `connectTo` 里写一次 `输入 || '无名玩家'`，于是两个后果——只改名没点建房就刷新等于没改；某次空字段点下去就把"无名玩家"永久钉进存储，之后每次进来都显示它。回归形状由 [style-hooks.test.mjs](packages/client/test/style-hooks.test.mjs) 的静态守卫钉住（先剥注释再判，否则注释里引一句旧代码就误报）。
- **同源存储只有一份**（2026-10-20）：两个启动器都从 `http://127.0.0.1:3178/` 打开；房主模式的 `0.0.0.0:3000` 只是局域网/隧道入口，不作为本机页面来源。昵称、地址簿、票据因此不再按入口分份。邀请链接由 `/api/self` 给出的 `publicOrigin` 生成（隧道优先、其次局域网 IP），所以房主从本机页面复制的链接不再是 `localhost`——否则朋友点开指向的是他自己电脑的 localhost。
- **禁止**：写 Windows 防火墙入站规则、建议关闭 Smart App Control（关掉后不重装系统无法再开）、`force push`。
- **混合内容方向性**：`http://127.0.0.1` 页面可以连 `ws://`（局域网房主）也可以连 `wss://`（隧道房主）；反过来 `https://` 页面连 `ws://` 会被浏览器拦。本地壳页面必须走 http。
- 与 [uno-online](../uno-online/CONTEXT.md) 是同一份玩法的两种演进：玩法改动归那边，连接/身份/分发改动归这里；**不要两边同时动同一份逻辑**。
