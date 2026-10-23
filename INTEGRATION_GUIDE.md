# 3178-battle-platform（3178 对战平台）· 平台 SDK 接入开发指南

> 面向准备把游戏接入 3178 的开发者：内容覆盖 SDK 获取、从零接入、GameModule / GameInstance、客户端沙箱、.bpmap 打包、game-kit，以及回合制与实时模式的边界和当前可用范围。
> 最近更新：2026-10-23

## 文档

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](README.md) | 玩家 / 房主 | 平台是什么、前置与双击入口、一局怎么走、命令行、限制与注意事项 |
| [DESIGN.md](DESIGN.md) | 开发者 / 二次开发 / 方案评审 | 目标与约束；运行模式（host 双监听 / join 单监听）；核心流程（建房、入座、准备、开局、动作广播、断线重连、存档恢复）；架构与三处接缝；线协议；开发与构建；关键设计决策；已定语义与边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 游戏开发者 / 接入方 | SDK 获取与从零接入、GameModule/GameInstance/Effect[]、客户端入口、单文件包、回合制与实时模式边界、game-kit（事件流/聊天/记分板）、沙箱限制、版本自检与升级 |
| [CONTEXT.md](CONTEXT.md) | 维护者 / 交接的 agent | 逐阶段验收凭据、遗留问题、关键约束、变更记录、agent 交接记录 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 测试 / 维护者 | 15 条问题（4 高 / 9 中 / 2 低）、修法、实测证据、复跑次数、猴测台自身 9 个缺陷与未覆盖范围 |

## 1. SDK 设计思路、作用与边界

### 1.1 这个 SDK 解决什么问题

3178 平台负责房间、座位、房主权限、准备、聊天、观战、掉线宽限、存档和传输。SDK 负责把这些功能的接入能力交到游戏开发者手里：

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
5. **模式分开**。回合制走事件驱动路径；实时动作走另一套执行模型（profile），固定 60Hz Tick，不把高频需求塞进回合制内核。
6. **薄核心，可选扩展**。核心 SDK 只放契约、打包、版本；聊天/事件流/记分板等跨游戏 UI 放进可选 game-kit；引擎、渲染、物理留在游戏工程或现成引擎里。
7. **包和版本可验证**。`.bpmap` 有清单和哈希；宿主校验 id、版本和入口，坏包只跳过、不挡启动。

### 1.3 能力边界

| SDK 交付的接入能力 | 游戏开发者负责 |
|---|---|
| 房间、座位、票据、观战、重连的接入契约 | 玩法、规则、状态设计 |
| 动作投递、视角裁剪、快照、存档恢复的接入方式 | 渲染、物理、动画、AI |
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
| `bpmap upgrade`、旧包适配器 | 规划中 |

## 2. SDK 接入完整流程

### 2.1 获取 SDK

SDK 还没有发布到 npm，当前是 `private` 包。外部工程从平台仓库打成 tarball 安装；`@bp/game-sdk` 依赖 `@bp/core-abi`，两个要一起装。

有两套做法：2.1.1 手动执行命令，2.1.2 用现成脚本。两者结果一样，选一种即可。

#### 2.1.1 手动安装（命令）

下面用 Git Bash 示例；把 `<3178 仓库>`、`<SDK 产物目录>`、`<你的游戏工程>` 换成实际路径。tarball 文件名带版本号，按 `npm pack` 的实际输出替换。

```bash
cd <3178 仓库>
mkdir -p <SDK 产物目录>
npm pack ./packages/core-abi --pack-destination <SDK 产物目录>
npm pack ./packages/game-sdk --pack-destination <SDK 产物目录>

cd <你的游戏工程>
npm init -y
npm pkg set type=module
npm install --save-dev \
  <SDK 产物目录>/bp-core-abi-0.1.0.tgz \
  <SDK 产物目录>/bp-game-sdk-0.1.0.tgz \
  esbuild
```

这些命令分别做什么：

| 命令 | 作用 |
|---|---|
| `npm pack ./packages/core-abi` | 把 `@bp/core-abi` 打成 tarball |
| `npm pack ./packages/game-sdk` | 把 `@bp/game-sdk` 打成 tarball |
| `npm init -y` | 没有 `package.json` 时创建一个 |
| `npm pkg set type=module` | 让工程按 ESM 解析 |
| `npm install --save-dev` | 同时安装两个 tarball 和 esbuild；SDK 依赖 core-abi，必须一起装 |

平台更新 SDK 后重新打包、重新安装。以后发布到 registry 后改成 `npm install @bp/game-sdk` 即可。

#### 2.1.2 用 setup-sdk.mjs 安装（脚本）

脚本在 SDK 仓库的 [setup-sdk.mjs](packages/game-sdk/templates/scripts/setup-sdk.mjs)，复制到游戏工程的 `scripts/`。安装 SDK 后，同一份也在 `node_modules/@bp/game-sdk/templates/scripts/`。

前置条件：Node 24+、npm、能访问平台仓库。游戏工程可以还没有 `package.json`，脚本会创建一个最小版本。

用法：

```bash
node scripts/setup-sdk.mjs --platform ../3178-battle-platform
```

参数：

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--platform <路径>` | 否 | `../3178-battle-platform` | 平台仓库路径；脚本会确认 `packages/game-sdk/package.json` 存在，缺构建产物时先跑 `npm run build` |
| `--sdk-dir <目录>` | 否 | `sdk` | tarball 存放目录；每次重跑会先删掉这个目录里的旧 `.tgz` |

脚本做的事：

1. 没有 `package.json` 就创建一个最小的；有但缺 `"type": "module"` 就补上。
2. 检查平台是否已构建；`packages/game-sdk/dist/index.js` 或 `packages/core-abi/dist/index.js` 不存在时在平台仓库跑 `npm run build`。
3. 把 `@bp/core-abi` 和 `@bp/game-sdk` 打进 `sdk/`，清掉旧的 tarball。
4. 在游戏工程执行 `npm install --save-dev sdk/*.tgz esbuild`。
5. 打印安装的 tarball 文件名和下一步命令。

跑完后会得到：

| 位置 | 内容 |
|---|---|
| `sdk/bp-core-abi-<版本>.tgz` | core-abi tarball |
| `sdk/bp-game-sdk-<版本>.tgz` | SDK tarball |
| `package.json` 的 `devDependencies` | 两个 tarball 和 esbuild |
| `node_modules/@bp/game-sdk/` | 已安装的 SDK |

注意：

- 平台更新 SDK 后重跑一次，脚本会重新打包并覆盖安装。
- 脚本用 npm 安装依赖；工程如果改用 pnpm/yarn，需要自己把两个 tarball 装上。
- 脚本只负责装 SDK，不写 `bp` 配置；`bp.id` / `bp.entry` 在 2.8 里配。
- `--sdk-dir` 是相对游戏工程根目录的路径；不要指到会被打包的目录里。

### 2.2 工程结构

```text
mygame/
├─ scripts/              # 可选：从 SDK templates 复制的 setup/build
├─ package.json
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

`sdk/` 和 `node_modules/` 是安装/构建生成的，不进包。`dist-pack/` 只放运行产物；不要把 `bpmap pack` 指向 `src/`，否则 TypeScript 源码、测试和不需要的文件都会进包。

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

`id` 要匹配 `^[a-z0-9][a-z0-9-]{0,31}$`，并与 `bpmap.json` 的 `id` 一致；`version` 也要和 `bpmap.json` 的 `version` 一致，打成包时非空白、最多 64 字符。

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

### 2.5 构建

构建到 `dist-pack/`。服务端入口可以把 `@bp/game-sdk` / `@bp/game-sdk/node` / `@bp/core-abi` 交给宿主解析；这是通过 `--external` 实现的，宿主版本要和构建时一致。其他第三方依赖不要 external，应该打进 `server.js`：

```bash
npx esbuild src/server.ts --bundle --platform=node --format=esm \
  --external:@bp/game-sdk --external:@bp/game-sdk/node --external:@bp/core-abi \
  --outfile=dist-pack/server.js

npx esbuild src/client.ts --bundle --platform=browser --format=esm \
  --outfile=dist-pack/client/client.js

mkdir -p dist-pack/client/assets
cp -r src/assets/* dist-pack/client/assets/
```

构建结果：

| 路径 | 内容 |
|---|---|
| `dist-pack/server.js` | 服务端入口，宿主加载它拿 `GameModule` |
| `dist-pack/client/client.js` | 客户端单文件 ESM，交给沙箱 |
| `dist-pack/client/assets/` | 客户端资源，用 `fetch('assets/...')` 取 |

没有客户端时跳过第二条 esbuild 和资源复制；`GameModule.entry` 仍要填字符串，父页面会回退到占位面板。没有 `src/assets/` 时也不需要 `cp`。`dist-pack/` 每次构建前建议清空，避免旧文件混进包。

也可以用 2.8 的 `build.mjs` 一次完成构建、打包和安装。

### 2.6 打包

在 `dist-pack/` 根目录写 `bpmap.json`：

```json
{
  "id": "mygame",
  "version": "0.1.0",
  "mode": "turn",
  "apiVersion": 1,
  "server": "server.js",
  "client": "client/client.js"
}
```

字段：

| 字段 | 说明 |
|---|---|
| `id` | 和 `GameModule.id` 一致，匹配 `^[a-z0-9][a-z0-9-]{0,31}$` |
| `version` | 和 `GameModule.version` 一致；非空白、最多 64 字符 |
| `mode` | 执行模式；当前宿主只支持 `turn`，省略时默认 `turn` |
| `apiVersion` | 游戏 ABI 版本；当前宿主支持 `1`，省略时默认 `1` |
| `server` | 包内服务端入口，通常是 `server.js` |
| `client` | 包内客户端入口，通常是 `client/client.js`；无客户端时可以省略 |

路径都相对 `dist-pack/`，不能是绝对路径，也不能含 `..`。宿主启动时会按 `mode` / `apiVersion` 做兼容闸，不支持就跳过这个包。打包、检查、本地校验：

```bash
npx bpmap pack dist-pack --out dist/mygame.bpmap
npx bpmap inspect dist/mygame.bpmap
npx bpmap doctor dist-pack
```

`pack` 会跳过 `bpmap.json`，把其他普通文件按清单打进 `.bpmap`；`inspect` 打印包头、每个文件大小和 sha256；`doctor dist-pack` 检查源目录的入口是否存在。包的格式、上限和缓存规则见 3.9。

也可以用 2.8 的 `build.mjs` 自动生成 `bpmap.json` 并打包。

### 2.7 安装到平台

把包复制到平台的 `games/`，再启动宿主：

```bash
cp dist/mygame.bpmap <3178 仓库>/games/
cd <3178 仓库>
# 先确保平台已经 npm run build，dist/cli.js 不存在时先构建
node packages/hostd/dist/cli.js host --port 3178 --lan-port 3000
```

打开 `http://127.0.0.1:3178`，建房时应该能在游戏列表里看到它。

宿主只在启动时扫描 `games/`，换包后要重启；同一个 `id` 不要同时留两个包，加载器会跳过后面的。宿主启动后可以查兼容性：

```bash
bpmap doctor dist/mygame.bpmap --host http://127.0.0.1:3178
```

也可以用 2.8 的 `build.mjs --platform ... --start` 完成复制和启动。

### 2.8 用 build.mjs 一键完成

`build.mjs` 在 SDK 仓库的 [build.mjs](packages/game-sdk/templates/scripts/build.mjs)，复制到游戏工程的 `scripts/`。它把 2.5–2.7 串起来：构建、生成清单、打包、校验，可选复制到平台、查宿主、启动宿主。

前置条件：

- 已经按 2.1 装好 SDK 和 esbuild。
- `src/server.ts` 存在；`src/client.ts` 和 `src/assets/` 可选。
- `package.json` 里有包 id 和客户端入口，`bp.id` 要和 `GameModule.id` 一致：

```json
{
  "name": "mygame",
  "version": "0.1.0",
  "type": "module",
  "bp": { "id": "mygame", "entry": "client/client.js", "mode": "turn", "apiVersion": 1 }
}
```

`bp.mode` / `bp.apiVersion` 可省略，默认 `turn` / `1`；当前宿主只支持 `turn` 和 `1`，其他值会被加载闸挡住。

完整用法：

```bash
node scripts/build.mjs [--platform <3178 仓库>] [--start] [--host <地址>] [--port 3178] [--lan-port 3000] [--out dist/<id>.bpmap]
```

参数：

| 参数 | 必填 | 默认值 | 作用 |
|---|---|---|---|
| `--platform <路径>` | 否 | 无 | 把 `.bpmap` 复制到 `<路径>/games/`；`--start` 也用它 |
| `--start` | 否 | 关 | 安装后启动宿主；必须同时给 `--platform` |
| `--port <端口>` | 否 | `3178` | 宿主界面端口，只在 `--start` 时用 |
| `--lan-port <端口>` | 否 | `3000` | 局域网/隧道端口，只在 `--start` 时用 |
| `--host <地址>` | 否 | 无 | 打包后跑 `bpmap doctor --host`；宿主必须已经启动 |
| `--out <文件>` | 否 | `dist/<id>.bpmap` | 输出包路径；不能放在 `dist-pack/` 里 |

常见用法：

```bash
# 只构建和打包，不安装
node scripts/build.mjs

# 构建、打包、复制到平台 games/
node scripts/build.mjs --platform ../3178-battle-platform

# 复制后直接启动宿主
node scripts/build.mjs --platform ../3178-battle-platform --start

# 改宿主端口
node scripts/build.mjs --platform ../3178-battle-platform --start --port 3180 --lan-port 3001

# 宿主已经在跑，检查它和包的兼容性
node scripts/build.mjs --host http://127.0.0.1:3178

# 改输出文件
node scripts/build.mjs --out build/mygame.bpmap
```

脚本按这个顺序执行：

1. 读 `package.json`，校验 `bp.id` / `version` / `bp.entry`；没有 `bp.id` 时退回 `package.json` 的 `name`。
2. 清空 `dist-pack/`；构建服务端，三个 SDK 包标成 external。
3. 如果存在 `src/client.ts`，构建客户端到 `bp.entry` 指定的位置，并复制 `src/assets/` 到入口目录的 `assets/`。
4. 写 `dist-pack/bpmap.json`，带 id/version/mode/apiVersion；没有客户端时不写 `client`。
5. 打包、校验、打印 id/version、文件数、总字节和包哈希。
6. 有 `--platform` 时复制到 `<平台>/games/<id>.bpmap`；有 `--host` 时调 `bpmap doctor --host`；有 `--start` 时启动宿主。

它会打印这些结果：

| 输出 | 含义 |
|---|---|
| `已生成 <路径>` | `.bpmap` 的最终位置 |
| `id/version` | 包 id 和版本 |
| `文件` | 打进包的文件数和总字节 |
| `包哈希` | 整包的 sha256，宿主用它区分同名版本 |
| `已安装到 <路径>` | 只有给了 `--platform` 才有 |
| `检查宿主兼容性` | 只有给了 `--host` 才有 |
| `启动宿主` | 只有给了 `--start` 才有 |

注意：

- `dist-pack/` 是生成目录，每次都会删掉重建；不要把源文件或手写配置放进去。
- 宿主只在启动时扫描 `games/`。`--start` 会新起一个宿主；端口被占用时先停掉旧宿主，或者去掉 `--start` 手动重启。
- `--host` 不能和第一次 `--start` 一起用，因为检查时宿主还没起来。
- 没有 `src/client.ts` 时脚本按无客户端游戏打包；`bp.entry` 只作为占位，不要求文件存在。
- 脚本是模板；SDK 以后更新模板，不会自动改你工程里已经复制的那份。

### 2.9 迭代和测试

迭代：重新构建、重新 `bpmap pack`、替换 `games/` 里的同名包、重启宿主。用 `build.mjs` 就是改完重跑 `node scripts/build.mjs --platform <3178 仓库> --start`；宿主已经在跑时先停掉，或者去掉 `--start` 手动重启。

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
| `@bp/game-sdk` | `GameModule` / `GameInstance` / `GameContext` / `GameSeatInfo` / `GameAction` / `Effect` / `Outcome` / `Reject` / `reject()` / `isReject()` / `ViewerId` / `stableDigest` / `GameManifest` / `GameAsset` / `GameUiOptions` / `SeatRole` / `RoomPhase` / `SeatView` / `PlatformCode` / `NoticeCode` |
| `@bp/game-sdk/client` | `GameClientContract` / `GameActions`（只有类型，没有运行时） |
| `@bp/game-sdk/node` | `packDirectory` / `readPack` / `readPackSource` / `extractPack` / `listPackFiles` / `PACK_FORMAT` / `PACK_MAGIC` / `PACK_EXTENSION` / `PackError` 和对应类型 |
| `@bp/game-sdk/kit` | `ChatPanel` / `FeedPanel` / `ScoreboardPanel` / `seatColor`，以及 `normalizeFeedEntry`、`mergeFeedEntries`、`formatFeedTime`、`normalizeChatLine`、`mergeChatLines`、`chatText`、`resolveColumnValue`、`formatColumnValue`、`sortScoreboardRows`、`buildScoreboardRows`、`connectionLabel` 等纯函数 |
| `@bp/game-sdk/kit/server` | `FeedLog` / `FeedLogOptions` / `FeedEmitInput` / `FeedSeat` / `FeedEntry` / `FeedVisibility` / `FeedError` / `FEED_EVENT` |
| `bpmap` bin | `pack` / `inspect` / `unpack` / `doctor` |

`reject()` 是构造 `Reject` 的助手；`stableDigest` 是确定性摘要，只用于“两端配置是否一致”，不是签名或安全哈希。`@bp/core-abi` 是 SDK 底层的游戏 ABI 包，由 `@bp/game-sdk` 作为依赖安装并重新导出，游戏工程不需要直接 import。

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

字段和契约约束：

| 字段 | 约束 / 默认 |
|---|---|
| `id` | 匹配 `^[a-z0-9][a-z0-9-]{0,31}$`，必须和 `bpmap.json` 的 id 一致。 |
| `version` | 打成包时非空白、最多 64 字符，必须和 `bpmap.json` 的 version 一致。宿主加载包后会把它改成 `版本+包哈希前 12 位`，客户端握手用这个值。 |
| `entry` | 包内相对路径，不能含 `..`、不能是 http(s) 地址；指向实际存在的客户端文件。没有客户端时仍要填一个字符串，父页面回退到占位面板。 |
| `seats` | 契约要求 `min >= 1`、`max >= min`、`max <= 16`；建房时槽位会被夹到 `[min, max]`。电脑位计入人数。 |
| `allowSpectate` | 房间设置和模块值都为 true 才允许观战。 |
| `soloFill` | `true` 才允许加 `ai` 座位。只表示允许加电脑位，不代表电脑会行动。 |
| `roles` | 声明性字段，取值 `host` / `player` / `ai` / `spectator`；平台目前不用它做拦截，实际开关是 `soloFill`。 |
| `normalizeConfig` | 平台启动时用 `{}` 调一次生成默认 manifest，建房和恢复时用房主原始配置再调（`raw` 可能是 `undefined`）。返回普通对象，必须是确定性函数，不能抛异常。 |
| `rulesHashOf` | 只摘要真正影响玩法的字段；建议直接 `stableDigest(config)`；同一配置必须得到同一结果。 |
| `create` / `resume` | 开局时 / 恢复存档时调用。`resume` 抛异常时平台丢弃这条存档。 |
| `acceptsSnapshot` | 可选；返回 false 时平台丢弃快照，不再调用 `resume`。 |
| `ui.chat` | 只支持 `chat` 一个键，取值 `platform`（默认）或 `game`；`game` 时父页面在对局阶段隐藏平台聊天卡。 |

`seats.min` 是开局人数下限，电脑位也算人数；`seats.max` 和房间槽位限制总座位数。`roles` 里建议写 `ai` 作为声明，但当前代码不会因为缺 `ai` 而拒绝加电脑位。

`stableDigest(value)` 先做规范化 JSON，再算 FNV-1a 64 位，输出 16 位十六进制。键顺序不影响结果，数组顺序保留，`undefined` 按 `null` 处理，循环引用会抛错。它只用于房规比对，不用于防篡改。

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

`Outcome` 是 `Effect[] | Reject`；`Reject` 是 `{ reject: string; code?: PlatformCode }`。`GameAction` 是 `{ name: string; payload?: unknown }`；`ViewerId` 是座位 id 或 `null`（观战）。

| 方法 | 什么时候调用 | 要注意 |
|---|---|---|
| `begin()` | 房主点开局，人数和 Ready 闸通过后 | 返回 `Reject` 时平台报错并丢弃这个实例；不要抛异常 |
| `handle(action, by)` | 只有 `host` / `player` 座位、房间处于 `playing` | `by` 是座位 id；观战和未入座由平台先挡；`Reject` 变成该座位的 error，显示在平台状态栏 |
| `serialize(viewer)` | 每次 fanout，每个在线座位和观战各调一次 | `viewer` 是人类座位 id，观战是 `null`；不要改状态，返回值按 JSON 传 |
| `snapshot()` | 宿主每 250ms 同步存档时调用 | 返回完整状态，必须能 JSON 序列化；不要改状态；恢复走 `GameModule.resume()` |
| `tick(now)` | 仅 `playing`，宿主 4Hz 心跳 | 用 `ctx.now()` 计时；返回非空 `Effect[]` 才会触发 fanout |
| `onSeatJoin(seat)` | 玩家、观战或电脑位加入 | 观战和电脑位也会进来，不要假设都是真人 |
| `onSeatLeave(seat, phase)` | 主动离席、被踢、电脑位移除、掉线宽限到期收回 | `phase` 是离开时的房间相位 |
| `onTimeout(seat)` | 掉线超过宽限期（默认 30 分钟，宿主可配），在收回座位前 | 不是回合超时；回合计时用 `tick(now)` |
| `dispose()` | 重开一局、关房、宿主退出、房间被清理 | `end` Effect 不会立刻调用它，别把关键清理只放在这里 |

- 每个连接默认 20 条消息/秒、突发 40 条；`handle` 的动作也受这个限制，超过返回 `RATE`。单条 WebSocket 消息默认上限 64KB。
- `Reject` 的 `code` 不填时平台按 `PHASE` 处理。它是平台错误，会出现在平台状态栏，不会作为游戏事件进 `onEvent`；要在游戏界面里提示，自己发 `broadcast` / `toSeat`。
- `tick` 里改了状态但返回空数组，平台不会 bump，也不会立刻 fanout；状态会存档，但客户端要等下一次动作或事件才能看到。
- `serialize` 和 `snapshot` 都按调用次数计费，尤其 `snapshot` 每 250ms 调一次；别在里面做重计算或写外部状态。

平台不直接改游戏状态；玩家动作和游戏事件都通过 `Effect[]` 交给平台投递。

### 3.4 GameContext、座位和 Effect

`GameContext` 是平台注入给游戏的只读上下文：

| 字段/方法 | 用途 |
|---|---|
| `roomCode` | 房号 |
| `config` | 规范化后的房规；按约定只读，游戏不要改 |
| `now()` | 平台注入的时钟；计时统一用它，测试可固定 |
| `random()` | 平台注入的随机源，返回 `[0, 1)`；测试可固定 |
| `seats()` | 当前座位列表，包含观战和电脑位，按入座顺序返回；每次是新数组，改它不影响房间 |
| `seat(seatId)` | 单个座位；座位不存在时返回 `undefined` |

`GameSeatInfo` 只含 `seatId`、`slot`、`name`、`role`、`team`、`ready`、`connected`，不含 socket、票据、`ageMs` 或 `isHost`。补充语义：

- `role` 是 `host` / `player` / `ai` / `spectator`；判断房主用 `role === 'host'`。
- `slot` 对玩家是 `1..seats.max`，观战从 901 起；房主可以用 `move` 改槽位，所以不要假设连续。
- `team` 初始是 `null`，房主可以改；类型是 `string | number | null`。
- `ready` 只影响开局闸；房主、电脑位和观战不参与检查，电脑位通常是 `false`。
- `connected` 对电脑位和掉线玩家是 `false`；不要用它判断电脑能不能行动。
- 观战也会出现在 `seats()` / `onSeatJoin` 里，不要假设座位表全是参与者。

`RoomPhase` 取值是 `lobby`、`playing`、`ended`；`onSeatLeave` 的 `phase` 就是这个值。房主掉线超过宽限期会直接结束对局，不触发 `onTimeout`。

`Effect` 有六种，平台按数组顺序处理：

| kind | 平台行为 | 客户端看到 |
|---|---|---|
| `broadcast` | 作为 `event` 发给房间内所有在线座位，包括观战 | `onEvent({ name, payload })` |
| `toSeat` | 作为 `event` 只发给指定座位；座位不存在或离线时没有接收者 | 该座位的 `onEvent` |
| `notice` | 房间级平台通知，`code` 用 `NoticeCode`，`text` 可选 | 平台通知栏 |
| `system` | 房间聊天里的一条系统消息，发送者是“系统” | 聊天历史 |
| `end` | 房间相位置为 `ended`，发结束通知，客户端会断开并回大厅；房间约 10 分钟后清理，不会立刻 `dispose()` | 平台通知 |
| `kick` | 移除座位；不能踢房主。被踢的在线座位收到 `SEAT_EJECTED` 并断开，同时触发 `onSeatLeave` | 平台通知 |

`end` 和 `kick` 可以带 `reason`，会显示在通知或系统消息里。

`NoticeCode` 取值：`HOSTLEFT`（房主离开/掉线）、`HOST_CHANGED`（房主移交）、`ROOM_CLOSED`（房间关闭）、`SEAT_EJECTED`（被踢）、`RULES_MISMATCH`（房规变化）、`REJOINED`（同票据重新连上）、`TOO_FEW`（人数不足结束）。客户端收到 `HOSTLEFT` / `ROOM_CLOSED` 会直接回大厅，游戏自己发的通知不要用这两个码。

`reject()` 的 `code` 用 `PlatformCode`：`PROTOCOL`、`VERSION`、`RULES`、`UNKNOWN_GAME`、`NOROOM`、`NOSEAT`、`FULL`、`NOTHOST`、`HOSTONLY`、`PASSWORD`、`PHASE`、`RATE`、`SEATLOST`、`BADMSG`、`INTERNAL`；不填默认 `PHASE`。`broadcast` / `toSeat` 的 `payload` 走 JSON，单条消息默认不超过 64KB。

### 3.5 游戏执行模式（turn / realtime）

这里说的模式（mode）是平台推进一局游戏的方式：游戏实例什么时候被调用、输入和快照多久走一次。它和 DESIGN 里 host/join 的“运行模式”不是一回事，也和几个人玩无关。

| 模式 | 平台怎么推进 | 适合 | 状态 |
|---|---|---|---|
| `turn` | 事件驱动：动作到达时调用 `handle()`；平台按 4Hz 调 `tick(now)`，只用于计时窗口 | 回合制、卡牌、棋类、文字对抗 | 当前唯一可用模式 |
| `realtime` | 固定 Tick 60Hz：输入帧带序号，快照按固定频率下发，客户端自己跑循环并插值 | 动作、射击、RTS | 规划中，当前不提供 |

`realtime` 固定 60Hz，不提供玩家可调档位。Tick 是服务端模拟频率，不是客户端渲染帧率：客户端仍按显示器刷新率渲染，在快照之间插值。游戏逻辑要按 `now` 的时间推进，不能按“每 Tick 走一格”设计。快照配比和传输方案见 5.2。

模式由包清单的 `mode` 声明，不是 `GameModule` 字段。宿主启动时检查包的 `mode` 和 `apiVersion`：当前支持 `turn` / `1`，不支持的包直接跳过并在控制台报原因；目录游戏没有包清单，按 `turn` / `1` 加载。`bpmap doctor` 对源目录和成品包都读这两个字段并和宿主 `/api/version` 比对，见 4.3。

**没有 `client-only` 模式。** 平台不把“只挂客户端、服务端不做模拟”当成一种模式：房间状态必须由房主进程里的游戏实例产生，客户端只发动作。以后如果真要做单机游戏目录，会另做启动器，不混进游戏契约。

### 3.6 单机游玩与电脑位

单机不是一种模式，它就是一个 `turn` 房间加了电脑位：房主建房，加电脑位，开局。war3 的房间可以加电脑，3178 的房间同样可以，不需要为单机另做一套运行时。

**如果项目从始至终只想做一个普通单机游戏，不建议大费周章接入 3178。** 平台交付的是房间、传输、打包、沙箱这些接入能力，不提供引擎、渲染、UI、关卡和玩法；你仍然要自己开发游戏，还要额外承担宿主、打包和沙箱限制。普通 Web 分发或现成发行渠道更直接。

**联机游戏同样可以单机游玩。** 只要游戏允许电脑位，1 个真人 + N 个电脑就能开局；电脑位计入 `occupied()` 和 `seats.min`，所以不需要为了单机把最少人数硬改成 1。

接入和设计时注意：

1. `GameModule.soloFill` 必须为 `true`；`roles` 建议包含 `ai`，它只是随 manifest 下发的声明，平台目前不用它拦截。当前房间层实际用 `soloFill` 控制“能不能加电脑位”。
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

- **每次新快照都会再次调用 `mount`**，不是只调用一次；`host` 是 iframe 里的固定容器，平台不会替你清空，渲染时自己 `replaceChildren`。
- `onEvent` 只收到 `broadcast` / `toSeat` 产生的游戏事件；`notice`、`system`、聊天和平台错误走平台 UI，不会进 `onEvent`。
- 事件可能先于 `mount` 到达，平台会排队到首次 `mount` 之后；`onEvent` 里不要假设界面已经渲染。
- `mount` / `onEvent` 里抛异常时，沙箱显示错误面板，父页面回退到占位界面。
- `unmount(host)` 在平台卸载游戏界面时调用，可选；用来清定时器、监听和 DOM。
- `actions.send(name, payload)` 只负责把动作发给父页面，不在客户端做阶段校验；服务端按 20 条消息/秒、突发 40 条限流。
- `actions.seatId()` 返回当前座位 id；未入座时是 `null`。观战拿到的是观战座位 id，但服务端会拒绝观战动作。
- 游戏拿不到 socket、票据、其他座位的私有信息。

沙箱和平台桥：

- 入口在 `sandbox="allow-scripts"` 的 iframe 里执行，不带 `allow-same-origin`：读不到宿主的 `localStorage`、cookie 和 DOM。
- 入口是 Blob ESM，必须是单文件，不能保留任何 `import`；资源用 `fetch('assets/...')`，base 指向入口目录。
- 沙箱加载超时 8 秒；超时或入口抛错时回退到占位面板。
- 入口源码的哈希校验发生在 `manifest.assets` 带入口记录时；`loadGameClientSource` 会先算 sha256。当前 `/api/games` 会给单文件包补 `assets`，但 `seatGranted` 下发的房间 manifest 不带，正常入房路径还没有真正校验，这块接缝待补。校验依赖 Web Crypto，只在安全上下文可用（`http://127.0.0.1` 或 HTTPS）；局域网普通 HTTP 下即使带哈希也会拒绝执行。没有哈希时照跑，界面会标记“未校验”。
- `bp:chat-history`：最近 100 条聊天，每条是 `{ seatId, name, text, at, kind: 'say' | 'system' }`，内容变化时整包重推。
- `bp:room`：`{ code, phase, seats }` 或 `null`；`seats` 是 `SeatView[]`，含 `seatId`、`slot`、`name`、`role`、`team`、`ready`、`connected`、`ageMs`、`isHost`。
- 聊天发送：iframe 发 `{ type: 'chat', text }`，父页面校验 1..300 字、阶段为 `playing`、连接状态为 `open`；发送者身份由服务端座位决定。
- `bp:chat` 是保留的增量事件；当前平台不发，以 `bp:chat-history` 为准。
- 当前沙箱没有指针锁定/全屏，实时动作需要的这些能力在规划中。

### 3.8 game-kit

game-kit 在同一个 SDK 包里，按需导入；全部是可选的跨游戏组件。下面的客户端 `import` 写在游戏客户端源码里，构建时由 esbuild 等打包器内联成单文件；最终交给沙箱的 `client.js` 不能保留 `import`。

#### 3.8.1 事件流

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

- `visibility` 支持 `all`、`{ seatId }`、`{ team }`；`{ team }` 需要在构造 `FeedLog` 时传 `seatTeams`，平台会给该队每个座位各发一条 `toSeat`。
- `viewFor(viewer)` 按视角裁剪历史；放进 `serialize` 可以在重连后恢复。`viewer` 传座位 id，观战传 `null`，此时只返回 `all` 事件。
- `snapshot()` / `restore()` 把事件历史放进游戏快照；快照版本是 1，恢复会按 `seq` 排序、裁到 `max`、重置 pending，坏记录抛 `FeedError`。
- 客户端示例里的 `view.feed` 是游戏自己在 `serialize` 里返回的字段，不是平台内置结构。

`FeedLog` 参数和默认值：

| 项 | 默认 / 约束 |
|---|---|
| `max` | 默认 100，夹到 1..500 |
| `maxText` | 默认 200，夹到 1..2000；`emit` 的文本超过就截断 |
| `now` | 默认 `Date.now` |
| `seatTeams` | 不传时不能用 `{ team }` 可见性，否则 `emit` 抛错 |
| `emit.type` | 去掉首尾空白后不能为空，最长 64 字符 |
| `emit.text` | 去掉首尾空白后不能为空 |
| `emit.actor` / `target` | 可选字符串 |
| `emit.data` | 可选普通对象，JSON 序列化后不超过 2000 字符 |
| `emit.visibility` | 默认 `all`；也可以是 `{ seatId }` 或 `{ team }` |
| `emit.at` | 可选有限数字，不传用 `now()`；返回的 `FeedEntry.seq` 从 1 开始 |

其他方法：`emit(input)` 返回写入的 `FeedEntry`；`drainEffects()` 取出并清空待投递的 `broadcast` / `toSeat`；`clear()` 清空历史并把序号重置为 1。

客户端：

```ts
import { FeedPanel } from '@bp/game-sdk/kit';

const feed = new FeedPanel({ mount: feedEl, max: 100 });
feed.setEntries(view.feed);
feed.handleEvent(event);   // 放进 onEvent
```

`FeedPanel` 参数：`mount` 不传时只跑状态和回调；`max` 默认 100（1..500）；`maxText` 默认 240（1..2000）；`types` 只显示列出的 `type`；`emptyText` 默认“暂无事件”；`timeFormat` 默认 `HH:MM:SS`；`colorOf(seatId)` 给 actor 上色；`onEntry` 只在 `append` 新事件时触发，`setEntries` 初始历史不触发。

方法：`setEntries(entries)` 整体替换；`append(entry)` 按 `seq` 去重；`handleEvent(event)` 只处理 `name === 'bp.feed'`，payload 可以是单条或数组，返回是否处理；`clear()`；`destroy()` 会清空挂载点和状态。DOM 类名是 `bp-feed`、`bp-feed-item`、`bp-feed-time`、`bp-feed-text`、`bp-feed-empty`。

#### 3.8.2 聊天

`ChatPanel` 监听 3.7 里的 `bp:chat-history`；`ScoreboardPanel` 监听 `bp:room`。

```ts
import { ChatPanel } from '@bp/game-sdk/kit';

const chat = new ChatPanel({ mount: chatEl, showSystem: true });
```

`ChatPanel` 自动监听 history，输入后默认通过 `parent.postMessage({ type: 'chat', text })` 发送；父页面校验 1..300 字、对局阶段和连接状态，发送者身份由服务端座位决定。

参数和默认值：`mount` 不传时是无界面模式；`max` 默认 200（1..500）；`maxText` 默认 300；`showSystem` 默认 `true`，设 `false` 隐藏系统消息；`placeholder` 默认“说点什么”；`sendLabel` 默认“发送”；`onSend(text)` 覆盖默认发送方式；`onLine` 只在新消息进来时触发；`listen` 在有 `mount` 时默认 `true`，没有 `mount` 时默认 `false`。

方法：`setLines(lines)` 整体替换；`append(line)` 按时间、座位、类型和文本去重；`send()` 读取面板输入并发送，1..300 字之外直接丢弃；`clear()`；`destroy()` 会移除监听并清空挂载点。没有 `mount` 且不在 iframe 里、也没传 `onSend` 时，`send()` 不会发出去。DOM 类名是 `bp-chat`、`bp-chat-log`、`bp-chat-form`、`bp-chat-input`、`bp-chat-send`、`bp-chat-line`、`bp-chat-say` / `bp-chat-system`、`bp-chat-name`、`bp-chat-text`。

如果声明了 `GameModule.ui.chat = 'game'`，父页面会对局阶段隐藏平台聊天卡；这时游戏必须自己挂 `ChatPanel` 或画聊天。

#### 3.8.3 记分板

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

参数和默认值：`columns` 必填，`key` 为空的列会被丢掉；`rows` 是 `{ seatId, values }`；`seats` 可直接传，不传就靠 `bp:room`；`showTeam` / `showConnection` / `showHost` 都默认 `true`；`emptyText` 默认“暂无数据”；`sort` 是 `{ key, dir: 'asc' | 'desc' }`；`listen` 在有 `mount` 时默认 `true`。

列字段：`value` 不填时取 `row.values[column.key]`；`format(value, row)` 默认把值转字符串，空值是“—”；`render(value, row)` 返回 `Node`，返回 `null` 时退回 `format`；`sortValue(row)` 不填时用 `value`；`sortable` 只有显式 `false` 才关闭；`align` 默认 `left`；`width` 可传数字（px）或 CSS 宽度。

方法：`setRows(rows)`、`setSeats(seats)`、`setRoom(room)`、`setSort(sort)`、`clear()`、`destroy()`。行顺序以座位为主：座位按 `slot` 排序，没有游戏行的座位也显示；有行但没有座位的排在后面。排序时空值永远排最后，字符串按 `zh-CN` 比较。内置列是“玩家”“队伍”“连接”，连接列显示“在线 / 离线 / 电脑 / 观战 / —”。

#### 3.8.4 座位颜色

```ts
import { seatColor } from '@bp/game-sdk/kit';

const color = seatColor({ seatId: 's1', slot: 1, team: 1 });
// { index: 0, name: 'red', value: '#e05d5d' }
```

固定 8 色：red、blue、green、yellow、purple、teal、orange、pink。优先级是队伍、座位号：数字队伍按 `team - 1` 取色，字符串队伍做哈希，`team` 为空才用 `slot - 1`，都没有就用第一色。输出是 `{ index, name, value }`，同一输入永远得到同一种颜色；聊天、事件流、记分板共用同一套颜色。

### 3.9 打包库与 CLI

`@bp/game-sdk/node` 提供 `.bpmap` 的读取、校验、打包和解包缓存；`bpmap` CLI 封装了常用操作：

```bash
bpmap pack dist-pack --out dist/mygame.bpmap
bpmap inspect dist/mygame.bpmap
bpmap unpack dist/mygame.bpmap ./unpacked
bpmap doctor dist-pack
```

日常构建也可以用 2.8 的 [build.mjs](packages/game-sdk/templates/scripts/build.mjs)，这些子命令留给单独排查和手工检查。

`@bp/game-sdk/node` 的公共函数：

| 函数 | 作用 |
|---|---|
| `readPackSource(root)` | 读 `bpmap.json`，校验 id/version/mode/apiVersion/server/client 的类型和路径；其他字段忽略 |
| `packDirectory(root, outFile, source)` | 把源目录打成 `.bpmap`，返回包头 manifest；先写临时文件再 rename |
| `readPack(filePath, { maxTotalBytes? })` | 读包并逐文件校验 sha256，返回 `{ manifest, files, packageHash, source }` |
| `extractPack(pack, cacheRoot)` | 解到 `<cacheRoot>/<id>/<packageHash>/`，返回 `{ dir, packageHash, reused }`；缓存不完整会重新解 |
| `listPackFiles(root)` | 列出目录下所有 `.bpmap`，按路径排序 |
| `sha256Hex(data)` | 算 `Buffer` / 字符串的 sha256 十六进制；打包和校验内部用 |

常量是 `PACK_FORMAT = 1`、`PACK_MAGIC = 'BPMAP1\n'`、`PACK_EXTENSION = '.bpmap'`、`PACK_MARKER = '.bpmap-ok'`。失败抛 `PackError`，`message` 可以直接显示给开发者。

CLI 行为：

- `pack` 默认输出到当前目录的 `<id>.bpmap`；输出不能放在源目录里；成功后打印 id/version、mode/apiVersion、文件数、总字节和包哈希。
- `inspect` 打印包头和每个文件的 size / sha256。
- `unpack` 解到指定目录，路径越界会被拒绝。
- `doctor` 见 4.3；参数错误或检查失败退出码 1，`--help` / `-h` 打印用法。

包的规则：

- 源目录除 `bpmap.json` 外的普通文件都会进包；不允许符号链接、`..` 和绝对路径。
- `.bpmap` 布局是 `BPMAP1\n` + 4 字节小端包头长度 + JSON 包头 + 按清单顺序拼接的文件段；不压缩，包头上限 1MB。
- `bpmap.json` 认 `id`、`version`、`mode`、`apiVersion`、`server`、`client` 六个字段；其他字段打包时忽略。`mode` / `apiVersion` 省略时默认 `turn` / `1`。`client` 只用于打包时确认入口文件存在；运行时客户端地址取模块导出的 `entry`，两者通常写同一个路径。
- 单文件上限 64MB，总量上限 256MB，最多 512 个文件；`readPack` 会校验魔数、包头、每个文件的 sha256 和包尾多余字节。
- 宿主把包解到数据目录下的 `packs/<id>/<包哈希>/`：开发目录是 `data/packs`，便携包是 `%LOCALAPPDATA%\3178-battle-platform\data\packs`。
- 缓存文件集合必须和包清单完全一致；多一个、少一个或改一个字节都会重新解包。
- 同一个 id 只加载一个包；重名时后面的包会被跳过并在控制台报错。
- 包版本在入房握手里是 `模块版本+包哈希前 12 位`，两边不一致会被版本闸挡住。

### 3.10 宿主怎么加载

宿主启动时按顺序加载两类游戏：

1. 目录游戏：`games/<id>/dist/index.js`，模块 id 必须和目录名一致。
2. 单文件包：`games/*.bpmap`，先检查包头 `mode` / `apiVersion`，再读包、解到缓存、`import()` 包里的 `server` 入口。当前宿主支持 `turn` / `1`，不支持的包跳过并记录原因。包的 id/version 必须和模块导出一致，否则这个包跳过。同一个 id 已被目录游戏或前一个包占用时，后面的包跳过并记录错误；坏包只记错误，不挡启动。加载完按 id 排序。目录游戏没有包清单，按 `turn` / `1` 处理。

包内服务端入口的裸导入只解析 `@bp/game-sdk`、`@bp/game-sdk/node`、`@bp/core-abi`，它们指向宿主自己的依赖；`@bp/protocol` 只保留给旧包过渡。其他第三方依赖要打进 `server.js`，不要指望宿主有。

宿主把模块版本改成 `模块版本+包哈希前 12 位`，并把包内所有文件作为 `assets` 挂到 manifest 上（`path`、`hash: sha256:<hex>`、`bytes`）。`hash` 允许带 `sha256:` 前缀，也接受裸十六进制。目录游戏没有包哈希，也就没有这组自动 `assets`。`/api/games` 返回各模块用 `normalizeConfig({})` 生成的默认 manifest；`/games/<id>/<路径>` 直接从解包目录取文件。客户端入口的哈希校验和局域网 HTTP 的限制见 3.7。

下发给客户端的 manifest 包含 `id`、`name`、`version`、`rulesHash`、`seats`、`allowSpectate`、`soloFill`、`roles`、`entry`，有 UI 声明时再带 `ui`。`/api/games` 的 manifest 会给单文件包补 `assets`；`seatGranted` 下发的是房间 manifest，目前不带 `assets`，客户端校验现状见 3.7。

平台源码不 import 任何 `games/` 路径，运行时按 id 动态加载。宿主只在启动时扫描，替换包后要重启。

包里服务端代码在房主进程里执行，等同于安装一个程序，只装来源可信的包。客户端入口在沙箱 iframe 中执行，源码校验规则见 3.7。

## 4. SDK 版本、自检与升级

### 4.1 当前版本模型

- 游戏包里的 `id` / `version` 必须和模块导出一致；
- 包清单带 `mode` / `apiVersion`，宿主启动时按支持范围检查，不支持就不加载；
- 宿主加载后把模块版本变成 `模块版本+包哈希前 12 位`；
- 客户端在 `hello` 里声明自己装的 `gameId`、`version`、`rulesHash`，入房前房主先比对版本再比对房规，不一致返回 `VERSION` / `RULES`；
- 恢复存档时再比对 `gameVersion`、`rulesHash` 和 `acceptsSnapshot`，任何一项不一致就丢弃这个房。

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

字段含义：

| 字段 | 含义 |
|---|---|
| `platform` | 平台版本，只用于展示和排查 |
| `packFormats` | 支持的 `.bpmap` 容器格式，当前是 `[1]` |
| `protocolVersions` | 支持的线协议版本，当前是 `[1]` |
| `apiVersions` | 支持的游戏契约版本，当前是 `[1]` |
| `modes` | 模式名到支持的 profile 版本，当前只有 `turn: [1]` |
| `clientCaps` | 客户端能力清单，当前为空 |

### 4.3 bpmap doctor

```bash
bpmap doctor dist-pack
# 先启动宿主，再查宿主兼容性
bpmap doctor dist/mygame.bpmap --host http://127.0.0.1:3178
```

用 2.8 的 [build.mjs](packages/game-sdk/templates/scripts/build.mjs) 时，跑 `node scripts/build.mjs --host http://127.0.0.1:3178` 就行，同样要先启动宿主。

- 源目录：检查 `bpmap.json`、服务端/客户端入口；读取 `mode` / `apiVersion`（缺省 `turn` / `1`）。
- 单文件包：检查包格式、服务端入口和清单；从包头读 `mode` / `apiVersion`，旧包头缺字段时按 `turn` / `1`。
- `--host`：请求 `/api/version`（5 秒超时），比对 `packFormats` 是否包含包格式、`apiVersions` 是否包含目标 API 版本、`modes[目标模式]` 是否包含 profile 1。`platform`、`protocolVersions`、`clientCaps` 目前不参与比对。
- 失败的检查打印 `[x]`，只要有一项失败退出码就是 1；全部通过退出码 0。

当前宿主支持 `turn` / `apiVersion 1`；`realtime` 和更高 API 版本会报不兼容。规划中的版本层见 4.4。

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

- game-kit 沙箱集成验证已完成（2026-10-23）：真实沙箱客户端验证 ChatPanel / ScoreboardPanel / `ui.chat='game'`，并落成 `fixture-kit` 测试夹具（带客户端入口）做回归；`tools/checks/fixture-kit.page.js` 可在真实大厅一键复验。
- 游戏设置 `configSchema`：让大厅自动渲染房主设置表单，不再每个游戏手写。
- 赛后结果面板和“再来一局”流程。
- 房主设置队伍 UI；game-kit 已有队伍颜色。
- game-kit 暂无新增组件计划；不把它扩展成引擎或游戏框架。

### 5.2 实时模式

- 独立实时 profile：固定 Tick 60Hz，输入帧带序号，快照按固定频率下发，客户端自己跑循环并插值。
- Tick 是模拟频率，不是渲染帧率；客户端按显示器刷新率渲染，在快照之间插值。玩法必须按时间推进，不能依赖某个固定帧率。
- 快照频率按 Tick 配比，默认每 2 个 Tick 发一次，即 30Hz，实测后再调。
- 宿主按单调时钟做固定步长累加，不能把 `setInterval` / `setTimeout` 直接当 Tick 源；60Hz 也要测抖动、CPU 和包量。
- 第一版只做 2–4 人局域网合作/简单对抗，传输先用 WebSocket；测完 RTT、抖动、包大小后再决定 WebTransport/WebRTC。
- 指针锁定在局域网 HTTP 下受安全上下文限制；3D 鼠标视角需要 HTTPS 或改控制方式。
- 实时 profile 不改变现有回合制路径，两者各自调度。

成品包的 `mode` 字段仍在规划中，写法和校验随实时 profile 一起定，见 3.5 和 4.4。

### 5.3 内容包和 UGC

- 先做“内容包/地图包”：只有数据，绑定某个游戏 id 和版本；schema 和编辑器由具体游戏提供。
- 平台负责分发、版本校验和房间选择，不做通用地图编辑器。
- 通用编辑器等于自研引擎，单独立项，不塞进 SDK。

### 5.4 SDK 分发和生态

- 当前 SDK 还是 `private`，靠 tarball；下一步定 registry/tarball 和版本范围。
- 如果要真正支持“开发者不拉平台仓库就能开发”，最终需要一个独立分发的 SDK 包；这仍不是二进制文件，Node/TS 生态交付的是 JS + 类型声明 + CLI。
- 成就、全局排行榜、跨房间聊天需要账号、后端和防作弊，属于另一个后端产品，不在当前 SDK 范围。

### 5.5 暂不启动

- 通用游戏引擎、渲染器、物理、动画、关卡编辑器、寻路、AI 行为树；
- 单独的 `client-only` 模式，理由见 3.5；
- 全局账号、成就、排行榜；
- 未经作者授权或来源不明的 `.bpmap`。
