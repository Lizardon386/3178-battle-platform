# 3178-battle-platform（3178 对战平台）

> 面向使用者：这是什么、能干什么、怎么跑起来、有什么限制。设计取舍与已定语义在 [DESIGN.md](DESIGN.md)，逐条实测数据与 agent 交接记录在 [CONTEXT.md](CONTEXT.md)。
> 最近更新：2026-10-14
<!-- 日期必须留在这行 blockquote 上：check-docs.sh 的 [新]/[旧]/[期] 只读这一行，正文里写日期不算顶部日期。 -->

## 一句话说明

**游戏无关的宿主制联机对战平台**：每人本机跑一个可双击的客户端，谁建房谁的进程就是服务器，别人从局域网列表或邀请链接进房——war3 对战平台那个形状。

具体玩法通过一个 `GameModule` 契约插进来。平台只管房间、座位、房主权限、准备、聊天、观战、电脑位、掉线宽限、版本闸、落盘与传输；仓库自带两个形状完全不同的合成游戏（`echo` / `turncount`）作为这层契约确实无关玩法的证据。

## 能力

- **房主制** —— 建房人所在进程是权威；开局、踢人、关房、移交只有房主能发。
- **座位与票据** —— 槽位号 + 玩家/电脑/观战角色；入席发票据，掉线可凭它坐回原位（盘上只存摘要）。
- **房间发现** —— 同网段 UDP 组播实时列表；跨网用邀请链接，可选 cloudflared 隧道。
- **断线重连** —— 指数退避；对局中保留座位 30 分钟（可配）；房主掉线过久直接终局。
- **落盘恢复** —— 房主机原子写快照，重启后房号、座位、票据、对局状态都回来。
- **版本与房规闸** —— 房规摘要或游戏版本对不上时挡在门外，不会开成一局不一样的。
- **按视角裁剪** —— 快照按座位生成，观战看不到别人的秘密。
- **无构建** —— 浏览器直接吃原生 ESM（import map），没有打包步骤，离线可用。
- **界面** —— 大厅 / 房间内 / 对局挂载点；暗紫主题，键盘可完整操作。

## 快速开始

前置：Windows + [Node 24](https://nodejs.org/)（`node -v` 出得来数就行）。在项目目录里先跑一次：

```bash
npm install && npm run build
```

然后双击：

| 双击 | 结果 |
|---|---|
| `房主建房.bat` | 起房主端（默认 3000 端口），浏览器打开 <http://localhost:3000> 建房 |
| `玩家本机壳.bat` | 起本地壳（3178）并自动打开页面：能看局域网房间列表，也能进别人的房 |

对局跑在**新开的那个控制台窗口**里。要停就在那个窗口按 <kbd>Ctrl</kbd>+<kbd>C</kbd>：先落盘收尾再退出，窗口自己关闭，不会问你"终止批处理操作吗"。

环境缺东西时启动器不会一闪而过——它打印该跑哪条命令并停住等你看。它不静默装东西，也不写防火墙规则：首次绑定局域网时 Windows 会弹窗，需要你亲手点"允许"。

### 命令行

```bash
npm test                                   # 全量用例
node packages/hostd/dist/cli.js host --port 3000 [--tunnel] [--no-lan] [--game echo]
node packages/hostd/dist/cli.js join --port 3178     # 本地壳，只绑 127.0.0.1
node packages/hostd/dist/cli.js diagnose             # node 版本 / 已装游戏 / cloudflared / 网卡 / 在跑的壳
node packages/hostd/dist/cli.js stop --port 3178
```

## 使用说明

1. **房主**：填房名、选游戏、定座位数 → 点「建房并坐 1 号位」，界面上出现四位房号。
2. **客人**：另一台机器双击「玩家本机壳.bat」，填房主地址（`192.168.x.x:3000` 或隧道网址）+ 房号进房；或者直接点房主复制出去的邀请链接，地址和房号都替你填好。
3. 各自点「准备」，房主的「开始对局」变亮后开局。人不够时按钮上会写明"等准备：谁"。
4. **掉线 / 关页面 / 换设备**：浏览器数据还在就会自动坐回原位；票据失效时界面会说明原因，不会只丢一句错误码。
5. **昵称会自动记住**：改完就存，不用点「建房」或「加入」才生效；下次打开直接是你上次填的名字。把输入框清空不会抹掉记忆（清空＝这次没填，仍会用上次那个）。

> 昵称与地址簿存在浏览器的同源存储里，**按"入口"分开记**：房主端提示的是 `http://localhost:3000`，本机壳自动打开的是 `http://127.0.0.1:3178/`——主机名和端口都不同，两份存储互相看不见。要在一个入口记住的名字到处都用，得等平台只有一个本机入口（见 [DESIGN.md](DESIGN.md) 的「已定语义与边界」）。

| 位置 | 房主 | 玩家 | 观战 |
|---|---|---|---|
| 房间内 | 开局、加电脑位、移交房主、请出座位、复制邀请、关房 | 准备 / 离开 | 只看桌，不能动作 |
| 对局中 | 房主面板继续开着 | 游戏自己的界面挂在牌桌位置 | 公开视角 |

房主不能直接走人：要么先移交，要么关房——这是 war3 式的房主语义，不是防误触的兜底。

## 接一个新游戏

实现 `packages/server/src/module-api.ts` 里的两个接口：

- **`GameModule`**：`id / name / version / entry / seats / allowSpectate / soloFill / roles` 加 `normalizeConfig`、`rulesHashOf`、`create`、`resume`。
- **`GameInstance`**（一局的状态机）：`serialize(viewer)`、`handle(action, by)`、`begin()`、`snapshot()`，按需再加 `tick` / `onSeatJoin` / `onSeatLeave` / `onTimeout`。

游戏碰不到 socket，所有出口都是返回 `Effect[]`（广播 / 发给某个座位 / 通知 / 系统消息 / 终局 / 踢）。把目录放进 `games/<id>/`，构建产物落在 `games/<id>/dist/index.js`，房主端运行时按 id 动态加载——平台源码不会 import 它。参考实现：`games/echo`（回合制 + 有隐私）与 `games/turncount`（无回合游标 + 无隐私 + 同时操作）。

## 线协议

| 方向 | 消息 | 要座位 | 要房主 |
|---|---|---|---|
| C→S | `hello` `roomCreate` `roomJoin` `seatResume` `resync` `ping` | 否 | 否 |
| C→S | `ready` `gameAction` `chat` `seatLeave` | 是 | 否 |
| C→S | `hostStart` `hostClose` `hostKick` `hostTransfer` `hostSeat` | 是 | **是** |
| S→C | `welcome` `seatGranted` `snapshot` `event` `chat` `notice` `error` `pong` | — | — |

完整字段与中文错误码文案在 `packages/protocol/src/wire.ts` 与 `codes.ts`。

## 限制与注意事项

- **浏览器要 Chrome/Edge 111+**：样式底座 Tabler 的颜色变量用了 `oklch()`，更老的内核算不出颜色（表现为按钮发灰、边框消失）。
- **还不是"发给朋友的那份包"**：绿色便携包（官方 `node.exe` 随包走）没做，两台机器都要自己装 Node 并 `npm install && npm run build`。
- **局域网组播未双机实测**：编解码和过期表有测试，真网卡上的收发、以及首次绑定触发防火墙弹窗这条路还没验证过。跨网目前只能靠邀请链接。
- **隧道域名每次启动都变**：别把它当固定地址记。
- **游戏自带界面还没有**：下发通道（清单、CORS、哈希校验）已通，但两个合成游戏没有客户端入口，对局区走内置占位渲染。真游戏的牌桌 UI 属于游戏侧工作。
- **宿主制天然不防房主**：权威进程在房主机上，"按视角裁剪"只防透视。移交只移权限、不迁进程，原房主断电就没有"已移交的房主"。
- **从房主拉游戏模块 = 在浏览器里执行房主给的代码**。哈希只保证"字节没被改"，不保证"代码无害"。接真游戏前要把它关进沙箱 iframe，否则房主能读你本机的座位票据与地址簿。

## 开发

```bash
npm run build          # tsc -b 项目引用，无打包器
npm test               # node --test
bash tools/check-seam.sh                        # 闸门：平台包内不得出现玩法词
node tools/monkey.mjs --seed 707 --users 8 --steps 300 --restarts 3   # 协议层猴测
```

## 产物与目录

| 位置 | 是什么 |
|---|---|
| [packages/protocol/](packages/protocol/src/wire.ts) | 线消息目录、错误码、稳定摘要、入站形状闸门 |
| [packages/server/](packages/server/src/engine.ts) | 引擎、座位与权限、落盘、ws 传输、局域网信标 |
| [packages/client/](packages/client/src/app.ts) | 浏览器端：连接、票据、界面、自绘下拉（原生 ESM，无打包） |
| [packages/hostd/](packages/hostd/src/cli.ts) | 宿主壳：host / join / diagnose / stop + 静态路由 |
| [games/](games/echo/src/index.ts) | 两个合成游戏（契约无关玩法的活证据） |
| [tools/](tools/check-seam.sh) | 接缝闸门、两层猴测、复现脚本、.bat 生成器 |
| [房主建房.bat](房主建房.bat) / [玩家本机壳.bat](玩家本机壳.bat) | 双击入口（由 [tools/gen-bat.mjs](tools/gen-bat.mjs) 生成，别手写） |
| [DESIGN.md](DESIGN.md) | 方案设计：设计取舍的完整理由与代价、架构与接缝、已定语义表、工程侧硬约束 |
| [CONTEXT.md](CONTEXT.md) | 逐阶段验收凭据、遗留问题、agent 交接记录 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 探索性 QA 报告：15 条 finding 与修法 |

## 更多

- 设计取舍（完整理由、实测代价、被否掉的方案）、架构与接缝、已定语义表：[DESIGN.md](DESIGN.md)
- 逐阶段验收凭据、遗留问题与 agent 交接记录：[CONTEXT.md](CONTEXT.md)
- 探索性 QA 报告（15 条 finding、修法与复跑计数）：[dogfood-output/猴测报告.md](dogfood-output/猴测报告.md)
- 本项目是从同工作区的 `uno-online` 剥离连接层重写而来，那边代码一行没动；玩法改动归那边，连接/身份/分发改动归这里。
