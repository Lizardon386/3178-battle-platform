# 3178-battle-platform（3178 对战平台）· 平台 SDK 接入开发指南

> 面向准备把游戏接入 3178 的开发者：内容覆盖 SDK 获取、从零接入、GameModule / GameInstance、客户端沙箱、.bpmap 打包、game-kit，以及回合制与实时模式的边界和当前可用范围。
> 最近更新：2026-10-22

## 文档

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](README.md) | 玩家 / 房主 | 平台是什么、前置与双击入口、一局怎么走、命令行、限制与注意事项 |
| [DESIGN.md](DESIGN.md) | 开发者 / 二次开发 / 方案评审 | 目标与约束；运行模式（host 双监听 / join 单监听）；核心流程（建房、入座、准备、开局、动作广播、断线重连、落盘恢复）；架构与三处接缝；线协议；开发与构建；关键设计决策；已定语义与边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 游戏开发者 / 接入方 | SDK 获取与从零接入、GameModule/GameInstance/Effect[]、客户端入口、单文件包、回合制与实时模式边界、game-kit（事件流/聊天/记分板）、沙箱限制、版本自检与升级 |
| [CONTEXT.md](CONTEXT.md) | 维护者 / 交接的 agent | 逐阶段验收凭据、遗留问题、关键约束、变更记录、agent 交接记录 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 测试 / 维护者 | 15 条问题（4 高 / 9 中 / 2 低）、修法、实测证据、复跑次数、猴测台自身 9 个缺陷与未覆盖范围 |

## 1. SDK 设计思路、作用与边界

### 1.1 这个 SDK 解决什么问题

3178 平台负责房间、座位、房主权限、准备、聊天、观战、掉线宽限、落盘和传输。SDK 负责把这些功能的接入能力交到游戏开发者手里：

- 定义游戏和平台之间的唯一契约：`GameModule` / `GameInstance` / `Effect` / `GameContext`；
- 提供 `.bpmap` 打包库和 `bpmap` CLI；
- 提供客户端沙箱契约；
- 提供可选的 game-kit：事件流、聊天、记分板、座位颜色；
- 提供版本自检工具（`/api/version`、`bpmap doctor`）；升级工具规划中。

SDK 交付的是接入流程、能力和规范，不是游戏运行时，也不是游戏引擎。游戏服务端入口在房主进程里执行，导出 `GameModule` 对象；宿主加载它，按房间创建 `GameInstance`。客户端入口在浏览器沙箱 iframe 里执行，不直接碰 socket、票据或宿主存储。

### 1.2 设计原则

1. **平台管边界，游戏开发者管玩法**。房间、座位、权限、传输、存盘由平台负责；牌堆、回合、移动、碰撞、胜负由游戏开发者负责。
2. **游戏状态对平台不透明**。平台只保存和转发 `snapshot()` / `serialize(viewer)` 的结果，不解析里面的字段。
3. **宿主权威**。每个房间有一个房主进程；客户端只发动作，不直接改房间状态。
4. **对外消息走 `Effect[]`**。游戏不能直接发 socket 消息，也不能改房间相位、座位表或房主权限。
5. **模式分开**。回合制走事件驱动路径；实时动作走另一套执行模型（profile），Tick 频率由房主在建房时从 60/90/120 三档里选，不把高频需求塞进回合制内核。
6. **薄核心，可选扩展**。核心 SDK 只放契约、打包、版本；聊天/事件流/记分板等跨游戏 UI 放进可选 game-kit；引擎、渲染、物理留在游戏工程或现成引擎里。
7. **包和版本可验证**。`.bpmap` 有清单和哈希；宿主校验 id、版本和入口，坏包只跳过、不挡启动。

### 1.3 能力边界

| SDK 交付的接入能力 | 游戏开发者负责 |
|---|---|
| 房间、座位、票据、观战、重连的接入契约 | 玩法、规则、状态设计 |
| 动作投递、视角裁剪、快照、落盘恢复的接入方式 | 渲染、物理、动画、AI |
| `.bpmap` 打包、校验、缓存的流程和规范 | 关卡、数值、内容 |
| 客户端沙箱、资源下发的接入规范 | 游戏自己的 UI、美术、音频 |
| game-kit：聊天、事件流、记分板、座位颜色 | 账号、成就、排行榜等产品能力（不在平台） |
| 版本检查、`/api/version`、`bpmap doctor` | 原生宿主、移动端运行时 |

输入、音频、存档、资源管线这些游戏功能当前不在 SDK 里；game-kit 只覆盖跨游戏的聊天、事件流、记分板和座位颜色，不扩展成引擎或游戏框架。

**不提供通用地图编辑器。** UGC 以后先做“内容包/地图包”，由具体游戏定义数据和编辑器；通用编辑器等于自研引擎，单独立项，不塞进 SDK。

当前执行模式只有回合制（`turn`），实时（`realtime`）在规划中，见 3.5。只做纯单机、没有联机计划的项目为什么不适合接入，见 3.6。

### 1.4 当前支持状态

| 能力 | 状态 |
|---|---|
| 回合制、卡牌、棋类（事件驱动，4Hz tick） | 可用 |
| 单机游玩：建房 + 电脑位（AI 由游戏实现） | 可用 |
| 实时动作、连续输入和高频同步 | 规划中，当前不提供 |
| game-kit：事件流、聊天、记分板、座位颜色 | 可用 |
| `/api/version`、`bpmap doctor` | 可用 |
| `apiVersion` / `mode` 包字段、`bpmap upgrade`、旧包适配器 | 规划中 |

## 2. SDK 接入完整流程

### 2.1 获取 SDK

SDK 还没有发布到 npm，当前是 `private` 包。外部工程从平台仓库打成 tarball 安装；`@bp/game-sdk` 依赖 `@bp/protocol`，两个要一起装。

下面用 Git Bash 示例；把 `<3178 仓库>`、`<SDK 产物目录>`、`<你的游戏工程>` 换成实际路径。tarball 文件名带版本号，按 `npm pack` 的实际输出替换。

```bash
cd <3178 仓库>
mkdir -p <SDK 产物目录>
npm pack ./packages/protocol --pack-destination <SDK 产物目录>
npm pack ./packages/game-sdk --pack-destination <SDK 产物目录>

cd <你的游戏工程>
npm init -y
npm pkg set type=module
npm install --save-dev \
  <SDK 产物目录>/bp-protocol-0.1.0.tgz \
  <SDK 产物目录>/bp-game-sdk-0.1.0.tgz \
  esbuild
```

平台更新 SDK 后重新打包、重新安装。以后发布到 registry 后改成 `npm install @bp/game-sdk` 即可。

CLI 需要 Node 24+；游戏客户端本身跑在浏览器里。

### 2.2 工程结构

```text
mygame/
├─ src/
│  ├─ server.ts          # GameModule
│  ├─ client.ts          # 可选：客户端入口
│  └─ assets/            # 图片、音频等
├─ dist-pack/            # 只放构建产物，给 bpmap pack 用
│  ├─ bpmap.json
│  ├─ server.js
│  └─ client/
│     ├─ client.js
│     └─ assets/
└─ dist/
   └─ mygame.bpmap       # 最终分发包
```

`dist-pack/` 只放运行产物。不要把 `bpmap pack` 指向 `src/`，否则 TypeScript 源码、测试和不需要的文件都会进包。

### 2.3 写服务端模块

实现 [GameModule](#32-gamemodule) 和 [GameInstance](#33-gameinstance)，导出 `default` 或具名对象。下面只列 `GameModule` 对象；`MyGame` 是你要实现的 `GameInstance`，方法见 3.3，`fromSnapshot` 也由你实现。

```ts
import { stableDigest, type GameModule } from '@bp/game-sdk';

export const myGame: GameModule = {
  id: 'mygame',
  name: '我的游戏',
  version: '0.1.0',
  entry: 'client/client.js',
  seats: { min: 2, max: 4 },
  allowSpectate: true,
  soloFill: false,
  roles: ['host', 'player', 'ai', 'spectator'],
  normalizeConfig: (raw) => ({ target: Number(raw?.target) || 10 }),
  rulesHashOf: (config) => stableDigest(config),
  create: (config, ctx) => new MyGame(config, ctx),
  resume: (snapshot, ctx) => MyGame.fromSnapshot(snapshot, ctx),
};

export default myGame;
```

`id` 要匹配 `^[a-z0-9][a-z0-9-]{0,31}$`，并与 `bpmap.json` 的 `id` 一致。`version` 同理。

### 2.4 写客户端入口

`entry` 会解析成 `<房主地址>/games/<id>/<entry>`。入口导出 `default` 或 `client`：

```js
export default {
  mount(host, view, actions) { /* 渲染 view；按钮里调用 actions.send('动作名', payload) */ },
  unmount(host) {},
  onEvent({ name, payload }, actions) { /* 接收服务端 broadcast 的事件 */ },
};
```

客户端入口必须是单文件 ESM，不能有任何 `import`（相对路径和裸包名都不行）；所有依赖都要打进这一个文件。包内资源用 `fetch('assets/...')`，iframe 的 base 已指向入口目录。不写客户端也能运行，平台会显示原始状态占位面板；但 `GameModule.entry` 仍要填一个字符串。

### 2.5 构建、打包、安装

构建到 `dist-pack/`。服务端入口可以把 `@bp/game-sdk` / `@bp/protocol` 交给宿主解析；这是通过 `--external` 实现的，宿主版本要和构建时一致。其他第三方依赖不要 external，应该打进 `server.js`：

```bash
npx esbuild src/server.ts --bundle --platform=node --format=esm \
  --external:@bp/game-sdk --external:@bp/protocol \
  --outfile=dist-pack/server.js

npx esbuild src/client.ts --bundle --platform=browser --format=esm \
  --outfile=dist-pack/client/client.js

mkdir -p dist-pack/client/assets
cp -r src/assets/* dist-pack/client/assets/
```

在 `dist-pack/` 根目录写 `bpmap.json`：

```json
{
  "id": "mygame",
  "version": "0.1.0",
  "server": "server.js",
  "client": "client/client.js"
}
```

打包、检查、安装：

```bash
npx bpmap pack dist-pack --out dist/mygame.bpmap
npx bpmap inspect dist/mygame.bpmap
npx bpmap doctor dist-pack

cp dist/mygame.bpmap <3178 仓库>/games/
cd <3178 仓库>
# 先确保平台已经 npm run build，dist/cli.js 不存在时先构建
node packages/hostd/dist/cli.js host --port 3178 --lan-port 3000
```

打开 `http://127.0.0.1:3178`，建房时应该能在游戏列表里看到它。宿主只在启动时扫描 `games/`，换包后要重启。宿主启动后可以再用 `bpmap doctor <包> --host http://127.0.0.1:3178` 检查兼容性，见 4.3。

### 2.6 迭代和测试

迭代：重新构建、重新 `bpmap pack`、替换 `games/` 里的同名包、重启宿主。

不要同时留同一个 `id` 的两个包，加载器会跳过后面的。

打包前先测规则：用 `node:test` 直接调用 `create()` / `begin()` / `handle()`，注入固定时钟和随机源；这比每次都起宿主快。

## 3. SDK 内部模块详解

### 3.1 包与导出路径

当前 SDK 源码结构：

```text
packages/game-sdk/src/
├─ contract/
│  ├─ module-api.ts      # GameModule / GameInstance / Effect / GameContext
│  └─ client.ts          # 客户端 mount / onEvent / actions 类型
├─ cli/
│  ├─ index.ts           # bpmap pack / inspect / unpack / doctor
│  └─ doctor.ts          # 入口与宿主兼容检查
├─ node/
│  └─ pack.ts            # .bpmap 读取、打包、校验、解包缓存
└─ kit/
   ├─ palette.ts         # 座位颜色
   ├─ server/feed.ts     # FeedLog
   └─ client/            # FeedPanel / ChatPanel / ScoreboardPanel
```

公共导入路径：

| 导入 | 内容 |
|---|---|
| `@bp/game-sdk` | `GameModule` / `GameInstance` / `Effect` / `GameContext` / `stableDigest` |
| `@bp/game-sdk/client` | `GameClientContract` / `GameActions` |
| `@bp/game-sdk/node` | `packDirectory` / `readPack` / `readPackSource` / `extractPack` |
| `@bp/game-sdk/kit` | `ChatPanel` / `FeedPanel` / `ScoreboardPanel` / `seatColor` |
| `@bp/game-sdk/kit/server` | `FeedLog` / 事件类型 |
| `bpmap` bin | `pack` / `inspect` / `unpack` / `doctor` |

`index.ts` 保留在源码根目录作为包入口；内部目录调整不改变上面的公共路径。

### 3.2 GameModule

`GameModule` 是游戏的“出厂说明书”，平台启动/加载时读一次，长期存在。它不保存某一局的状态。

```ts
export interface GameModule {
  id: string;
  name: string;
  version: string;
  entry: string;
  seats: { min: number; max: number };
  allowSpectate: boolean;
  soloFill: boolean;
  roles: SeatRole[];
  normalizeConfig(raw: Record<string, unknown> | undefined): Record<string, unknown>;
  rulesHashOf(config: Record<string, unknown>): string;
  create(config: Record<string, unknown>, ctx: GameContext): GameInstance;
  resume(snapshot: unknown, ctx: GameContext): GameInstance;
  acceptsSnapshot?(snapshot: unknown): boolean;
  ui?: { chat?: 'platform' | 'game' };
}
```

- `seats` / `allowSpectate` / `soloFill`：座位范围、是否允许观战、是否允许电脑位。
- `roles`：声明模块支持的角色，会随 manifest 下发给客户端；当前房间层对电脑位的实际开关是 `soloFill`。
- `entry`：客户端入口路径；没有客户端时仍要填一个字符串，父页面会回退到占位面板。
- `normalizeConfig`：把房主原始设置整理成固定形状，决定 `rulesHash` 和 `create` 的输入。
- `rulesHashOf`：只摘要真正影响玩法的字段；改房名不应该让客人看到“房规不同”。
- `create` / `resume`：创建一个新对局 / 从落盘快照恢复。
- `acceptsSnapshot`：快照兼容性闸；返回 false 时平台丢弃快照。
- `ui.chat`：可选。`platform`（默认）由平台显示聊天卡；`game` 表示游戏自带聊天面板，父页面在对局阶段隐藏平台聊天卡。

`soloFill` 只表示允许加电脑位，不代表电脑会行动；电脑出招由游戏实现，见 3.6。

### 3.3 GameInstance

`GameInstance` 是**某一局**游戏本身，每个房间一份，互相隔离。

```ts
export interface GameInstance {
  serialize(viewer: ViewerId): unknown;
  handle(action: GameAction, by: string): Outcome;
  begin(): Outcome;
  snapshot(): unknown;
  tick?(now: number): Effect[];
  onSeatJoin?(seat: GameSeatInfo): Effect[];
  onSeatLeave?(seat: GameSeatInfo, phase: RoomPhase): Effect[];
  onTimeout?(seat: GameSeatInfo): Effect[];
  dispose?(): void;
}
```

`Outcome` 是 `Effect[] | Reject`；`Reject` 是 `{ reject: string; code?: PlatformCode }`。

- `begin()`：开局初始化，返回 `Effect[]`。
- `handle(action, by)`：处理玩家动作；不合法时用 `reject('中文说明', 'PHASE')` 返回，不要抛异常或静默忽略。
- `serialize(viewer)`：按视角返回状态；`viewer === null` 是观战视角。哪些信息该藏起来由游戏决定。
- `snapshot()`：返回完整状态，供平台落盘；恢复时平台调用 `GameModule.resume()`，不是实例的 `resume()`。
- `tick(now)`：平台心跳调用，用于计时窗口；调用频率由执行模式决定，见 3.5。
- 座位回调：玩家离开、超时等事件由游戏决定怎么处理。

平台不直接改游戏状态；玩家动作和游戏事件都通过 `Effect[]` 交给平台投递。

### 3.4 GameContext、座位和 Effect

`GameContext` 是平台注入给游戏的只读上下文：

| 字段/方法 | 用途 |
|---|---|
| `roomCode` | 房号 |
| `config` | 规范化后的房规 |
| `now()` | 平台注入的时钟 |
| `random()` | 平台注入的随机源，测试可固定 |
| `seats()` | 当前座位列表 |
| `seat(seatId)` | 单个座位 |

`GameSeatInfo` 只含 `seatId`、`slot`、`name`、`role`、`team`、`ready`、`connected`，不含 socket 或票据。

`Effect` 有六种：

- `broadcast`：广播给房间；
- `toSeat`：只发给某个座位；
- `notice`：平台通知；
- `system`：系统消息；
- `end`：结束对局；
- `kick`：踢出座位。

### 3.5 游戏执行模式（turn / realtime）

这里说的模式（mode）是平台推进一局游戏的方式：游戏实例什么时候被调用、输入和快照多久走一次。它和 DESIGN 里 host/join 的“运行模式”不是一回事，也和几个人玩无关。

| 模式 | 平台怎么推进 | 适合 | 状态 |
|---|---|---|---|
| `turn` | 事件驱动：动作到达时调用 `handle()`；平台按 4Hz 调 `tick(now)`，只用于计时窗口 | 回合制、卡牌、棋类、文字对抗 | 当前唯一可用模式 |
| `realtime` | 固定 Tick 循环（60/90/120 三档）：输入帧带序号，快照按固定频率下发，客户端自己跑循环并插值 | 动作、射击、RTS | 规划中，当前不提供 |

`realtime` 的 Tick 频率不写死，房主在建房时从 60/90/120 三档里选，默认 60；平台负责调度。Tick 是服务端模拟频率，不是客户端渲染帧率：客户端仍按显示器刷新率渲染，在快照之间插值。游戏逻辑要按 `now` 的时间推进，不能按“每 Tick 走一格”设计，否则换档玩法就变了。档位细节、字段形态、快照配比和传输方案见 5.2。

当前 `GameModule` 没有 `mode` 字段，宿主一律按 `turn` 加载。`bpmap doctor` 会读源目录 `bpmap.json` 里可选的 `mode`，成品 `.bpmap` 还没有这个字段，所以按 `turn` / `apiVersion 1` 检查，见 4.3。

**没有 `client-only` 模式。** 平台不把“只挂客户端、服务端不做模拟”当成一种模式：房间状态必须由房主进程里的游戏实例产生，客户端只发动作。以后如果真要做单机游戏目录，会另做启动器，不混进游戏契约。

### 3.6 单机游玩与电脑位

单机不是一种模式，它就是一个 `turn` 房间加了电脑位：房主建房，加电脑位，开局。war3 的房间可以加电脑，3178 的房间同样可以，不需要为单机另做一套运行时。

**如果项目从始至终只想做一个普通单机游戏，不建议大费周章接入 3178。** 平台交付的是房间、传输、打包、沙箱这些接入能力，不提供引擎、渲染、UI、关卡和玩法；你仍然要自己开发游戏，还要额外承担宿主、打包和沙箱限制。普通 Web 分发或现成发行渠道更直接。

**联机游戏同样可以单机游玩。** 只要游戏允许电脑位，1 个真人 + N 个电脑就能开局；电脑位计入 `occupied()` 和 `seats.min`，所以不需要为了单机把最少人数硬改成 1。

接入和设计时注意：

1. `GameModule.soloFill` 必须为 `true`；`roles` 里要声明 `ai`，这是给平台和客户端看的角色清单。当前房间层实际用 `soloFill` 控制“能不能加电脑位”。
2. `seats.min` 是开局人数下限，电脑位也算人数；按游戏真实最少人数设置。`seats.max` / 房间槽位仍限制总座位数。
3. 平台只提供 `role: 'ai'` 的座位，**不提供 AI 行为**。电脑的决策、出招、节奏都由游戏实现：在 `begin()` 初始化，在 `tick(now)` 或人类动作之后推进；不要用 `setTimeout`，用 `ctx.now()`。
4. 电脑座位在 `GameContext.seats()` 里是 `role: 'ai'`，`connected` 可能是 `false`；不要用 `connected` 判断电脑能不能行动，要按 `role` 判断。
5. 电脑位可能被房主加入或移除；在 `onSeatJoin` / `onSeatLeave` 里处理，不要假设座位表里全是真人。
6. AI 动作和人类动作走同一个出口：由游戏内部产生 `Effect[]`，不要伪装成客户端消息。发给 AI 的 `toSeat` 没有连接可收，通常没必要。
7. AI 的随机源和计时用 `ctx.random()` / `ctx.now()`，测试时可固定；AI 状态要放进 `snapshot()`，`resume()` 后继续。
8. 界面要把电脑显示为“电脑”，不要显示“离线”；记分板目前已经按 `role` 处理这一点。

### 3.7 客户端契约与沙箱

```ts
export interface GameClientContract {
  mount(host: HTMLElement, view: unknown, actions: GameActions): void;
  unmount?(host: HTMLElement): void;
  onEvent?(event: { name: string; payload?: unknown }, actions: GameActions): void;
}

export interface GameActions {
  send(name: string, payload?: unknown): void;
  seatId(): string | null;
}
```

- **每次新快照都会再次调用 `mount`**，不是只调用一次；渲染时要替换内容，不要反复 append。
- 事件可能先于 `mount` 到达，平台会排队；`onEvent` 里不要假设界面已经渲染。
- 游戏拿不到 socket、票据、其他座位的私有信息；动作只能走 `actions.send`，`actions.seatId()` 返回当前座位。
- 客户端入口在 `sandbox="allow-scripts"` 的 iframe 里执行，不带 `allow-same-origin`：读不到宿主的 `localStorage`、cookie 和 DOM。
- 入口要打成单文件，不能有任何 `import`；资源用 `fetch('assets/...')`。当前沙箱没有指针锁定/全屏，实时动作需要的这些能力在规划中。

### 3.8 game-kit

game-kit 在同一个 SDK 包里，按需导入；全部是可选的跨游戏组件。下面的客户端 `import` 写在游戏客户端源码里，构建时由 esbuild 等打包器内联成单文件；最终交给沙箱的 `client.js` 不能保留 `import`。

#### 事件流

服务端：

```ts
import { FeedLog } from '@bp/game-sdk/kit/server';

const feed = new FeedLog({
  max: 100,
  maxText: 200,
  seatTeams: () => ctx.seats().map((seat) => ({ seatId: seat.seatId, team: seat.team })),
});

feed.emit({
  type: 'death',
  text: '甲 被 乙 击杀',
  actor: 's1',
  target: 's2',
  visibility: 'all',
});

return [...otherEffects, ...feed.drainEffects()];
```

- `visibility` 支持 `all`、`{ seatId }`、`{ team }`；`{ team }` 需要在构造 `FeedLog` 时传 `seatTeams`。
- `viewFor(viewer)` 按视角裁剪历史；放进 `serialize` 可以在重连后恢复。
- `snapshot()` / `restore()` 把事件历史放进游戏快照。
- 客户端示例里的 `view.feed` 是游戏自己在 `serialize` 里返回的字段，不是平台内置结构。

客户端：

```ts
import { FeedPanel } from '@bp/game-sdk/kit';

const feed = new FeedPanel({ mount: feedEl, max: 100 });
feed.setEntries(view.feed);
feed.handleEvent(event);   // 放进 onEvent
```

#### 聊天

平台会把房间聊天和座位信息送进 iframe：

- `bp:chat-history`：最近 100 条，内容变化时重推；没有增量 `bp:chat`，以 history 为准。
- `bp:room`：`{ code, phase, seats } | null`，座位或阶段变化时重推。

```ts
import { ChatPanel } from '@bp/game-sdk/kit';

const chat = new ChatPanel({ mount: chatEl, showSystem: true });
```

`ChatPanel` 自动监听 history，输入后默认通过 `parent.postMessage({ type: 'chat', text })` 发送；父页面校验 1..300 字、对局阶段和连接状态，发送者身份由服务端座位决定。

如果声明了 `GameModule.ui.chat = 'game'`，父页面会对局阶段隐藏平台聊天卡；这时游戏必须自己挂 `ChatPanel` 或画聊天。

#### 记分板

```ts
import { ScoreboardPanel } from '@bp/game-sdk/kit';

const board = new ScoreboardPanel({
  mount: boardEl,
  rows: view.scoreboard.rows,   // [{ seatId, values: { ... } }]
  columns: [
    { key: 'hand', label: '手牌', value: 'hand' },
    { key: 'score', label: '分数', value: 'score' },
    { key: 'state', label: '状态', value: (row) => row.values.state },
  ],
  showTeam: true,
  showConnection: true,
});
```

- `view.scoreboard` 是游戏自己在 `serialize` 里返回的结构，不是平台内置字段。
- 列完全由游戏定义；`value` 支持字段名或函数，`format` 返回文本，复杂单元格用 `render` 返回 DOM。
- 面板自动监听 `bp:room`，补齐玩家名、队伍、连接状态和房主标记。
- 行和值按视角给，观战/对手不能看到隐藏数据。
- 当前只显示连接状态，没有全员 ping；自己的 RTT 也还没有通过桥传入。

#### 座位颜色

```ts
import { seatColor } from '@bp/game-sdk/kit';

const color = seatColor({ seatId: 's1', slot: 1, team: 1 });
// { index: 0, name: 'red', value: '#e05d5d' }
```

队伍优先、座位号兜底，同一输入稳定。聊天、事件流、记分板共用同一套颜色。

### 3.9 打包库与 CLI

`@bp/game-sdk/node` 提供 `.bpmap` 的读取、校验、打包和解包缓存；`bpmap` CLI 封装了常用操作：

```bash
bpmap pack dist-pack --out dist/mygame.bpmap
bpmap inspect dist/mygame.bpmap
bpmap unpack dist/mygame.bpmap ./unpacked
bpmap doctor dist-pack
```

包的规则：

- 源目录除 `bpmap.json` 外的普通文件都会进包；不允许符号链接、`..` 和绝对路径。
- 单文件上限 64MB，总量上限 256MB，最多 512 个文件。
- 宿主把包解到数据目录下的 `packs/<id>/<包哈希>/`：开发目录是 `data/packs`，便携包是 `%LOCALAPPDATA%\3178-battle-platform\data\packs`。
- 缓存文件集合必须和包清单完全一致；多一个、少一个或改一个字节都会重新解包。
- 同一个 id 只加载一个包；重名时后面的包会被跳过并在控制台报错。
- 包版本在入房握手里是 `模块版本+包哈希前 12 位`，两边不一致会被版本闸挡住。

### 3.10 宿主怎么加载

宿主启动时扫描 `games/*.bpmap`，校验、解包并 `import()` 包内服务端入口，拿到 `GameModule`；建房时调用 `create()`。平台源码不 import 任何 `games/` 路径，运行时按 id 动态加载。

包里服务端代码在房主进程里执行，等同于安装一个程序，只装来源可信的包。客户端入口在沙箱 iframe 中执行；如果包清单声明了入口资源的哈希，父页面会先校验再把源码交给沙箱。

## 4. SDK 版本、自检与升级

### 4.1 当前版本模型

- 游戏包里的 `id` / `version` 必须和模块导出一致；
- 宿主加载后把模块版本变成 `模块版本+包哈希前 12 位`；
- 客户端握手发现版本不一致会被版本闸挡住；
- 当前还没有独立的 `apiVersion` / `mode` 包字段；这些是下一步。

### 4.2 `/api/version`

宿主提供只读接口：

```http
GET /api/version
```

返回平台版本、支持的包格式、协议版本、API 版本、模式和客户端能力。下面是当前返回示例，`platform` 会随平台版本变化：

```json
{
  "platform": "0.1.0",
  "packFormats": [1],
  "protocolVersions": [1],
  "apiVersions": [1],
  "modes": { "turn": [1] },
  "clientCaps": []
}
```

### 4.3 bpmap doctor

```bash
bpmap doctor dist-pack
# 先启动宿主，再查宿主兼容性
bpmap doctor dist/mygame.bpmap --host http://127.0.0.1:3178
```

- 源目录：检查 `bpmap.json`、服务端/客户端入口；读取可选的 `mode` / `apiVersion`。
- 单文件包：检查包格式、入口和清单。
- `--host`：请求 `/api/version`，比对 `packFormats`、`apiVersions`、`modes`。

当前成品 `.bpmap` 包头还没有 `mode` / `apiVersion` 字段，因此包目标按 `turn` / `apiVersion 1` 检查。宿主不支持时 `doctor` 会列出失败项并退出码 1。

### 4.4 规划中的版本层

后续会把版本拆成五层：

| 版本 | 作用 |
|---|---|
| `packFormat` | `.bpmap` 容器格式 |
| `protocolVersion` | 线协议消息集 |
| `apiVersion` | 游戏契约 |
| `profileVersion` | 执行模型（turn/realtime） |
| `sdkVersion` | SDK 包自身 |

规则：

- 加字段、加可选方法不升 `apiVersion`；
- 删字段、改签名、改语义才升；
- 宿主保留“当前 + 上一个主版本”的适配器；
- 宿主不认识的新版本直接拒绝，并给出升级提示。

### 4.5 升级策略

- **有源码**：后续提供 `bpmap upgrade`，按版本做机械 codemod、更新清单和依赖，输出无法自动处理的 TODO。
- **只有成品包**：无法从编译后的 JS 还原源码，只能靠宿主适配器，或者让作者重新发包。
- 当前 `bpmap upgrade` 还没实现，不要依赖它。

## 5. 后续更新计划

### 5.1 近期

- 用真实临时客户端做一遍 game-kit 沙箱集成验证，包括 `ui.chat='game'` 隐藏平台聊天。
- 游戏设置 `configSchema`：让大厅自动渲染房主设置表单，不再每个游戏手写。
- 赛后结果面板和“再来一局”流程。
- 房主设置队伍 UI；game-kit 已有队伍颜色。
- game-kit 暂无新增组件计划；先做现有四个组件的沙箱集成验证和文档，不把它扩展成引擎或游戏框架。

### 5.2 实时模式

- 独立实时 profile：固定 Tick 循环，输入帧带序号，快照按固定频率下发，客户端自己跑循环并插值。
- Tick 档位先提供 60/90/120 三档，房主建房时选，默认 60；游戏包可以只声明自己支持的子集，平台和包的交集才是可选档位。开局后不能换档，房间列表和加入确认里显示当前档位。
- Tick 是模拟频率，不是渲染帧率；客户端按显示器刷新率渲染，在快照之间插值。玩法必须按时间推进，不能依赖某个固定帧率。
- 快照频率按 Tick 配比，默认每 2 个 Tick 发一次，对应 30/45/60Hz，实测后再调。
- 宿主按单调时钟做固定步长累加，不能把 `setInterval` / `setTimeout` 直接当 Tick 源；120Hz 档要重点测抖动、CPU 和包量，撑不住的局在下一局建议降档，不在局中改频率。
- 第一版只做 2–4 人局域网合作/简单对抗，传输先用 WebSocket；测完 RTT、抖动、包大小后再决定 WebTransport/WebRTC。
- 指针锁定在局域网 HTTP 下受安全上下文限制；3D 鼠标视角需要 HTTPS 或改控制方式。
- 实时 profile 不改变现有回合制路径，两者各自调度。

规划中的包字段（只列新增项，写在 `bpmap.json`，当前宿主不读）：

```json
{
  "mode": "realtime",
  "realtime": {
    "tickRate": { "options": [60, 90, 120], "default": 60 }
  }
}
```

包声明的是自己支持的档位子集，例如只支持 60 就写 `"options": [60]`。档位只是调度参数，不进入 `normalizeConfig` 的玩法配置，也不影响 `rulesHash`。

### 5.3 内容包和 UGC

- 先做“内容包/地图包”：只有数据，绑定某个游戏 id 和版本；schema 和编辑器由具体游戏提供。
- 平台负责分发、版本校验和房间选择，不做通用地图编辑器。
- 通用编辑器等于自研引擎，单独立项，不塞进 SDK。

### 5.4 SDK 分发和生态

- 当前 SDK 还是 `private`，靠 tarball；下一步定 registry/tarball、版本范围和 `apiVersion`。
- 如果要真正支持“开发者不拉平台仓库就能开发”，最终需要一个独立分发的 SDK 包；这仍不是二进制文件，Node/TS 生态交付的是 JS + 类型声明 + CLI。
- 成就、全局排行榜、跨房间聊天需要账号、后端和防作弊，属于另一个后端产品，不在当前 SDK 范围。

### 5.5 暂不启动

- 通用游戏引擎、渲染器、物理、动画、关卡编辑器、寻路、AI 行为树；
- 单独的 `client-only` 模式，理由见 3.5；
- 全局账号、成就、排行榜；
- 未经作者授权或来源不明的 `.bpmap`。
