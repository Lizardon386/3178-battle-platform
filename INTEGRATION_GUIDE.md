# 3178-battle-platform（3178 对战平台）· 游戏接入指南

> 面向准备把游戏接入 3178 的开发者。内容覆盖 SDK 获取、从零接入、GameModule / GameInstance、客户端沙箱、.bpmap 打包、game-kit，以及回合制与实时模式的边界和当前可用范围。
> 最近更新：2026-10-22

## 文档

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](README.md) | 玩家 / 房主 | 平台是什么、前置与双击入口、一局怎么走、命令行、限制与注意事项 |
| [DESIGN.md](DESIGN.md) | 开发者 / 二次开发 / 方案评审 | 目标与约束；运行模式（host 双监听 / join 单监听）；核心流程（建房、入座、准备、开局、动作广播、断线重连、落盘恢复）；架构与三处接缝；线协议；开发与构建；关键设计决策；已定语义与边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 游戏开发者 / 接入方 | SDK 获取与从零接入、GameModule/GameInstance/Effect[]、客户端入口、单文件包、回合制与实时模式边界、game-kit（事件流/聊天/记分板）、沙箱限制、版本自检与升级 |
| [CONTEXT.md](CONTEXT.md) | 维护者 / 交接的 agent | 逐阶段验收凭据、遗留问题、关键约束、变更记录、agent 交接记录 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 测试 / 维护者 | 15 条问题（4 高 / 9 中 / 2 低）、修法、实测证据、复跑次数、猴测台自身 9 个缺陷与未覆盖范围 |

## 1. 接入总则

### 1.1 当前能接什么

| 能力 | 状态 |
|---|---|
| 回合制、卡牌、棋类（事件驱动，4Hz tick） | 可用 |
| 实时动作、需要连续输入和高频同步 | 规划中，当前不提供 |
| 纯单机、没有联机计划的游戏 | 不作为 SDK 模式；单机用“建房 + 电脑位”；纯单机不建议接平台 |
| 游戏内事件流（谁死了/回城/轮到谁） | 已提供 `FeedLog` / `FeedPanel` |
| 座位颜色 | 已提供 `seatColor` |
| 游戏内聊天 | 已提供 `ChatPanel`，复用平台房间聊天 |
| Tab 记分板 | 已提供 `ScoreboardPanel`，列由游戏定义 |
| 版本自检、一键升级 | `/api/version` 已可用；`bpmap doctor` / `upgrade` 规划中 |

纯单机游戏接入平台不会简化玩法开发：平台只提供房间、传输、打包、沙箱和少量通用组件，不提供引擎、渲染、物理、动画、关卡编辑器或 AI。单机游戏应该先问自己为什么要经过 3178；如果答案只是“想有个启动器”，普通静态站或现成发行渠道更直接。

### 1.2 SDK 是什么

`@bp/game-sdk` 提供：

- `GameModule` / `GameInstance` / `Effect` / `GameContext` 契约；
- `stableDigest` 与客户端契约类型；
- `.bpmap` 打包库和 `bpmap` CLI；
- 可选的 game-kit：事件流、聊天、记分板、座位颜色。

它不提供引擎、渲染器、物理、动画、关卡编辑器、寻路、AI 行为、账号、成就或排行榜。房间、座位、权威、传输、重连和落盘由平台负责。

### 1.3 获取 SDK

SDK 还没有发布到 npm，当前是 `private` 包。外部工程从平台仓库打成 tarball 安装；`@bp/game-sdk` 依赖 `@bp/protocol`，两个要一起装：

```bash
cd D:/agent_workspace/3178-battle-platform
mkdir -p D:/agent_workspace/sdk-tarballs
npm pack ./packages/protocol --pack-destination D:/agent_workspace/sdk-tarballs
npm pack ./packages/game-sdk --pack-destination D:/agent_workspace/sdk-tarballs

cd D:/agent_workspace/mygame
npm init -y
npm pkg set type=module
npm install --save-dev \
  D:/agent_workspace/sdk-tarballs/bp-protocol-0.1.0.tgz \
  D:/agent_workspace/sdk-tarballs/bp-game-sdk-0.1.0.tgz \
  esbuild
```

平台更新 SDK 后重新打包、重新安装。以后如果发布到 registry，改成普通 `npm install @bp/game-sdk` 即可。

CLI 需要 Node 24+；游戏客户端本身跑在浏览器里。

### 1.4 从零走一遍

自己的游戏工程建议这样分层：

```text
mygame/
  src/server.ts          # GameModule
  src/client.ts          # 可选：客户端入口
  src/assets/            # 图片、音频等
  dist-pack/             # 只放构建产物，给 bpmap pack 用
    bpmap.json
    server.js
    client/client.js
    client/assets/
  dist/mygame.bpmap      # 最终分发包
```

步骤：

1. 写服务端模块，实现 [GameModule](#2-gamemodule) 和 [GameInstance](#3-gameinstance)，导出 `default` 或具名对象。
2. 写客户端入口，实现 [客户端界面](#4-客户端界面可选)；不写也能跑，平台会显示原始状态占位面板。
3. 构建到 `dist-pack/`。服务端入口可以用相对 import，`@bp/game-sdk` / `@bp/protocol` 交给宿主解析；其他依赖要打进产物或随包携带。客户端入口必须是单文件 ESM，不能有相对 import。

```bash
npx esbuild src/server.ts --bundle --platform=node --format=esm \
  --external:@bp/game-sdk --external:@bp/protocol \
  --outfile=dist-pack/server.js

npx esbuild src/client.ts --bundle --platform=browser --format=esm \
  --outfile=dist-pack/client/client.js

mkdir -p dist-pack/client/assets
cp -r src/assets/* dist-pack/client/assets/
```

4. 在 `dist-pack/` 根目录写 `bpmap.json`：

```json
{
  "id": "mygame",
  "version": "0.1.0",
  "server": "server.js",
  "client": "client/client.js"
}
```

5. 打包并检查：

```bash
npx bpmap pack dist-pack --out dist/mygame.bpmap
npx bpmap inspect dist/mygame.bpmap
```

6. 把包放进平台并启动宿主：

```bash
cp dist/mygame.bpmap D:/agent_workspace/3178-battle-platform/games/
cd D:/agent_workspace/3178-battle-platform
node packages/hostd/dist/cli.js host --port 3178 --lan-port 3000
```

打开 `http://127.0.0.1:3178`，建房时应该能在游戏列表里看到它。宿主只在启动时扫描 `games/`，换包后要重启。

7. 迭代：重新构建、重新 `bpmap pack`、替换 `games/` 里的同名包、重启宿主。不要同时留同一个 `id` 的两个包，加载器会跳过后面的。

打包前先测规则：用 `node:test` 直接调用 `create()` / `begin()` / `handle()`，注入固定时钟和随机源；这比每次都起宿主快。

### 1.5 模式与适用边界

- **当前只有回合制/事件驱动模式**：一次动作、一次快照，平台 4Hz 推进游戏时钟。卡牌、棋类、桌游、回合制 RPG 都适合。
- **实时动作模式是规划中**：固定 Tick、输入帧、二进制快照、客户端循环，尚未实现。当前不要把实时游戏按“已经能跑”来设计。
- **没有 client-only 模式**：单机需求用 `seats.min = 1` + 电脑位；游戏必须自己实现电脑行动。纯单机、没有联机计划的项目，不建议接平台。
- **对标 war3 的是房间和内容分发，不是 World Editor**：平台不提供通用地图编辑器或引擎；以后如果做 UGC，会先做“内容包/地图包”，由具体游戏定义数据格式和编辑器。

## 2. GameModule

```ts
export const myModule: GameModule = {
  id: 'mygame', name: '我的游戏', version: '0.1.0',
  entry: 'client/client.js',          // 相对包根的地址，不能含 '..' 或 http
  seats: { min: 2, max: 8 },          // max 不超过 16
  allowSpectate: true,
  soloFill: true,
  roles: ['host', 'player', 'ai', 'spectator'],
  normalizeConfig: (raw) => ({ /* 把房主填的设置整理成固定形状 */ }),
  rulesHashOf: (config) => stableDigest(config), // 只算真的影响玩法的字段
  create: (config, ctx) => new MyInstance(config, ctx),
  resume: (snapshot, ctx) => { /* 从快照恢复 */ },
  acceptsSnapshot: (snapshot) => snapshot?.version === 1,
};
```

`id` 要匹配 `^[a-z0-9][a-z0-9-]{0,31}$`，并与 `bpmap.json` 的 `id` 一致。`version` 同理。

`rulesHashOf` 只摘要影响玩法的字段。房主改房名不应该让客人看到“房规不同”。`ctx` 里的 `now()` 和 `random()` 是平台注入的，测试可以按固定节奏推进，不用等真计时器。

`soloFill` 只表示允许加电脑位，不代表电脑会行动。设为 true 的游戏要自己实现电脑出招（例如在 `tick` 或动作处理里推进），否则单机局会卡在电脑回合。

## 3. GameInstance

必须实现：

- `serialize(viewer)`：按视角返回状态。`viewer === null` 表示观战；哪些信息该藏起来由游戏决定。
- `handle(action, by)` 和 `begin()`：返回 `Effect[]`。动作不合法时用 `reject('中文说明', 'PHASE')` 返回，不要抛异常，也不要静默忽略。提示会直接显示给玩家。
- `snapshot()`：返回要落盘和恢复的完整状态。

按需实现：`tick(now)`、`onSeatJoin`、`onSeatLeave`、`onTimeout`、`dispose`。

`Effect` 有六种：`broadcast`、`toSeat`、`notice`、`system`、`end`、`kick`。

## 4. 客户端界面（可选）

`entry` 会解析成 `<房主地址>/games/<id>/<entry>`。入口导出 `default` 或 `client`：

```js
export default {
  mount(host, view, actions) { /* 渲染 view；按钮里调用 actions.send('动作名', payload) */ },
  unmount(host) {},
  onEvent({ name, payload }, actions) { /* 接收服务端 broadcast 的事件 */ },
};
```

游戏界面拿不到 socket，也拿不到别人的座位，只能用 `actions.send()` 和 `actions.seatId()`。不写界面也能运行，平台会显示一个简单的占位面板；但 `GameModule.entry` 仍要填一个字符串，父页面取不到入口时会走这个降级路径。

客户端入口在 `sandbox="allow-scripts"` 的 iframe 里执行，不带 `allow-same-origin`：读不到宿主的 `localStorage`、票据和 DOM。入口源码先在父页面按清单哈希校验，再交给沙箱。入口要写成单文件模块，不要用相对 `import`；包内资源用 `fetch('assets/...')`，iframe 的 base 已指向入口目录。

当前沙箱只有 `allow-scripts`，指针锁定和全屏还没有开放；实时动作游戏需要的这些能力在规划中。

## 5. 目录与构建

平台仓库里的目录式模块只用于测试夹具：`tools/testkit/src/test-games/`，由 testkit 的 `tsconfig` 编译；`games/` 里只放生成的 `.bpmap`。第三方游戏在自己的工程里构建，打成 `.bpmap` 分发，不要把源码加进平台 monorepo。

不要直接把 `bpmap pack` 指向 `src/`。准备一个只含构建产物的目录（上面的 `dist-pack/`），否则 TypeScript 源码、测试和不需要的文件都会进包。

`bash tools/checks/check-seam.sh` 扫运行时平台包和 testkit 的工具代码：运行时包里不能出现玩法词，也不能 import `games/`；测试夹具在 testkit 里，按测试资产处理。

参考夹具：[turn-based](tools/testkit/src/test-games/turn-based/index.ts)、[simultaneous](tools/testkit/src/test-games/simultaneous/index.ts)。

## 6. 单文件游戏包（.bpmap）

游戏分发用 `.bpmap` 单文件；目录式只用于平台自己的测试夹具和开发。把 `.bpmap` 丢进 `games/`，宿主启动时会扫描、校验、解包，并像目录游戏一样加载。

源目录里放一个 `bpmap.json`：

```json
{
  "id": "mygame",
  "version": "0.1.0",
  "server": "server.js",
  "client": "client/client.js"
}
```

- `id` 和模块导出的 `id` 一致，`version` 和模块导出的 `version` 一致；不一致时宿主跳过这个包并在控制台说明原因。
- `server` 是包内服务端入口；`client` 可选，填了就必须在包内，并和模块导出的 `entry` 一致。
- 源目录里除 `bpmap.json` 外的普通文件都会进包。不允许符号链接、`..` 和绝对路径。单文件上限 64MB，总量上限 256MB，最多 512 个文件。
- 服务端入口可以直接 `import '@bp/game-sdk'` 或 `'@bp/protocol'`，宿主按自己装的版本解析，不要求把 SDK 打进包。除此之外的裸包名，宿主不会替你在它的 `node_modules` 里找：要么打进包内（例如源目录里的 `node_modules/`），要么改成相对路径。
- `mode`、`apiVersion`、`ui` 等字段还在规划中，当前打包器不会校验它们；先不要依赖。

打包、检查、调试解包：

```bash
node tools/packaging/bpmap.mjs pack dist-pack --out dist/mygame.bpmap
node tools/packaging/bpmap.mjs inspect dist/mygame.bpmap
node tools/packaging/bpmap.mjs unpack dist/mygame.bpmap ./mygame-unpacked

# 外部工程装 @bp/game-sdk 后也可以直接用 bpmap 这个 bin
bpmap pack dist-pack --out dist/mygame.bpmap
```

把 `mygame.bpmap` 放进 `games/`，重启宿主即可。宿主把包解到数据目录下的 `packs/<id>/<包哈希>/`：开发目录是 `data/packs`，便携包是 `%LOCALAPPDATA%\3178-battle-platform\data\packs`。缓存的文件集合必须和包清单完全一致；多一个文件、少一个文件或改一个字节都会重新解包。

同一个 id 只加载一个包：和目录游戏或其他包重名时，后面的包会被跳过并在控制台报错。包版本在入房握手里是 `模块版本+包哈希前 12 位`，两边不一致会被版本闸挡住。

包里的服务端代码会在房主进程里执行，和安装一个程序一样，只装来源可信的包。客户端入口在沙箱 iframe 中执行，源码先按包清单的 sha256 校验（清单随 `/api/games` 下发）再交给沙箱；它不继承宿主的 localStorage 和票据。

## 7. game-kit（可选）

game-kit 在同一个 SDK 包里，通过子路径导入：

```ts
import { FeedLog } from '@bp/game-sdk/kit/server';                 // 服务端
import { ChatPanel, FeedPanel, ScoreboardPanel, seatColor } from '@bp/game-sdk/kit'; // 客户端
```

它只提供跨游戏的展示/数据组件，不提供引擎。

### 7.1 事件流（已提供）

服务端：

```ts
import { FeedLog } from '@bp/game-sdk/kit/server';

const feed = new FeedLog({
  max: 100,
  maxText: 200,
  seatTeams: () => ctx.seats().map((seat) => ({ seatId: seat.seatId, team: seat.team })),
});

// 在动作/开局/掉线等地方
feed.emit({
  type: 'death',                 // 游戏自定义分类
  text: '甲 被 乙 击杀',        // 游戏自己填文本
  actor: 's1',
  target: 's2',
  visibility: 'all',             // all | { seatId } | { team }
});

return [...otherEffects, ...feed.drainEffects()];
```

- `viewFor(viewer)` 按视角裁剪历史；`serialize` 里带上它，重连能恢复。
- `snapshot()` / `restore()` 用于把事件历史放进游戏快照。
- `visibility: { seatId }` 只发给本人；`{ team }` 需要 `seatTeams`。

客户端：

```ts
import { FeedPanel, seatColor } from '@bp/game-sdk/kit';

const feed = new FeedPanel({
  mount: feedEl,
  max: 100,
  colorOf: (seatId) => seatColor({ seatId }).value,
});

feed.setEntries(view.feed);                    // 每次 mount/快照
feed.handleEvent(event);                       // 放进 onEvent
```

- 事件用纯文本渲染，不执行 HTML。
- `onEntry` 只回调新到的事件，初始历史不会触发。
- 不挂 `mount` 时是 headless，自己画 HUD 也可以。

### 7.2 聊天（已提供）

平台会把房间聊天和座位信息送进游戏 iframe，事件名是：

- `bp:chat-history`：最近 100 条聊天，内容变化时重推；**没有增量 `bp:chat`，以 history 为准**。
- `bp:room`：`{ code, phase, seats } | null`，座位或阶段变化时重推。
- `bp:chat`：已预留单条事件，父页面暂不发送。

直接用面板：

```ts
import { ChatPanel } from '@bp/game-sdk/kit';

const chat = new ChatPanel({
  mount: chatEl,
  showSystem: true,
});
```

- 面板自动监听 `bp:chat-history`，整表替换；历史以平台为准。
- 输入提交后默认在 iframe 里 `parent.postMessage({ type: 'chat', text })`；也可以用 `onSend` 换成自己的发送方式。
- 纯文本渲染，系统行可过滤，自动滚动；`onLine` 只回调新消息。
- 不挂 `mount` 时是 headless，自己画聊天也可以。

自己画时直接监听桥：

```ts
window.addEventListener('bp:chat-history', (event) => {
  renderChat((event as CustomEvent).detail);
});

parent.postMessage({ type: 'chat', text }, '*');   // 只发文本
```

父页面会校验 1..300 字、对局阶段和连接状态，发送者身份由服务端座位决定，游戏不能伪造。聊天复用平台房间聊天：200 条历史、落盘、限流都在平台侧，不要自己再存一份。

`ui.chat: 'game'` 协议字段已预留，但 SDK 还没把它带进 manifest；当前父页面仍显示平台聊天卡，等后续接入 `ui.chat` 后再用这个开关。现在用 `ChatPanel` 会出现平台聊天卡和游戏内聊天两份，接入前先接受这个重复，或者暂不挂 `ChatPanel`。

### 7.3 记分板（已提供）

记分板完全由游戏定义列和值，平台只提供座位元数据（名字、队伍、颜色、连接状态、房主标记）。没有固定的“击杀/死亡”列。

```ts
import { ScoreboardPanel } from '@bp/game-sdk/kit';

const board = new ScoreboardPanel({
  mount: el,
  rows: view.scoreboard.rows,   // [{ seatId, values: { ... } }]
  columns: [
    { key: 'hand', label: '手牌', value: 'hand' },
    { key: 'score', label: '分数', value: 'score' },
    { key: 'state', label: '状态', value: (row) => row.values.state },
  ],
  showTeam: true,
  showConnection: true,
  sort: { key: 'score', dir: 'desc' },
});
```

- 面板自动监听 `bp:room`，用平台座位表补齐玩家名、队伍、连接状态和房主标记；每次游戏视图更新时调用 `board.setRows(view.scoreboard.rows)`。
- 座位是主列表：没有游戏行的玩家也会显示，有行但没座位的排在后面。
- `value` 可以是字段名或函数；`format` 只返回文本，需要图标时用 `render` 返回 DOM 节点。
- 点表头可以切换排序；也可以在初始化时给 `sort`。没有 `sortValue` 时按列值比较，缺值始终排最后。
- 行和值按视角给，观战/对手不能看到隐藏数据。
- 自己的 RTT 暂未通过桥传给 iframe；当前只显示连接状态，不假装有全员 ping。

### 7.4 座位颜色（已提供）

```ts
import { seatColor } from '@bp/game-sdk/kit';

const color = seatColor({ seatId: 's1', slot: 1, team: 1 });
// { index: 0, name: 'red', value: '#e05d5d' }
```

队伍优先、座位号兜底，同一输入稳定。聊天、事件流、记分板共用同一套颜色；游戏可以覆盖 CSS 或自己调色。

### 7.5 game-kit 不做什么

不做引擎、渲染器、物理、动画、关卡编辑器、寻路、AI 行为树、资源导入器。不做跨房间全局聊天、私聊、盟友聊天（需要身份和可见性，后续再定）。不做成就、排行榜、账号体系（需要后端和防作弊，另立项）。

## 8. 实时游戏（规划中）

当前不可用，不要按它来设计接入。现状和规划如下：

- 现状：宿主 250ms 一次游戏 Tick（4Hz），JSON 消息，全量视图，没有输入帧、预测、回滚或二进制快照。
- 规划：独立实时 profile，固定 Tick 20–30Hz，输入带序号，快照 10–20Hz，客户端自己跑循环并插值；第一版只做 2–4 人局域网合作/简单对抗。
- 传输先用 WebSocket；局域网休闲够不够，要量 RTT、抖动和包大小后再决定是否上 WebTransport/WebRTC。
- 指针锁定在局域网 HTTP 下受安全上下文限制；3D 鼠标视角需要 HTTPS 或改控制方式，这个成本要提前算。
- 实时 profile 不会改变现有回合制路径；两种模式各自调度。

在实时契约落地前，不要在游戏里用 `tick(now)` 模拟 60Hz 动作，平台不会按那个频率调用。

## 9. 版本、自检与升级

当前可用：

- 包内 `id` / `version` 必须和模块导出一致；
- 宿主的包版本是 `模块版本+包哈希前 12 位`，客户端版本不一致会被版本闸挡住；
- `GET /api/version` 返回平台版本、支持的包格式/协议/API/模式清单，可用于诊断。

规划中：

- `GameModule.apiVersion`、`mode`、`profileVersion`，宿主只加载自己支持的版本；
- `bpmap doctor` 在打包前检查清单、模块、宿主能力；
- `bpmap upgrade` 对有源码的旧工程做机械 codemod 和清单升级；编译后的 `.bpmap` 无法还原源码，只能靠宿主适配器或让作者重发；
- 宿主保留“当前 + 上一个主版本”的适配器。

在这些落地前，不要依赖 `bpmap doctor` / `upgrade` 命令。

## 10. 明确不做

- 通用游戏引擎、渲染器、物理、动画、关卡编辑器、寻路、AI 行为树；
- 单独的 `client-only` 模式；纯单机游戏用普通 Web 分发更合适；
- 跨房间全局聊天、私聊、账号、成就、全局排行榜；
- 未经作者授权或来源不明的 `.bpmap`。
