# 3178-battle-platform（3178 对战平台）· 游戏接入指南

> 写给要接新游戏的人。
> 最近更新：2026-10-21

## 文档

| 文档 | 阅读对象 | 内容 |
|---|---|---|
| [README.md](README.md) | 玩家 / 房主 | 平台是什么、前置与双击入口、一局怎么走、命令行、限制与注意事项 |
| [DESIGN.md](DESIGN.md) | 开发者 / 二次开发 / 方案评审 | 目标与约束；运行模式（host 双监听 / join 单监听）；核心流程（建房、入座、准备、开局、动作广播、断线重连、落盘恢复）；架构与三处接缝；线协议；开发与构建；关键设计决策；已定语义与边界 |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | 游戏开发者 / 接入方 | GameModule / GameInstance / Effect[]、客户端入口、单文件包、沙箱限制、目录与构建、check-seam 要求 |
| [CONTEXT.md](CONTEXT.md) | 维护者 / 交接的 agent | 逐阶段验收凭据、遗留问题、关键约束、变更记录、agent 交接记录 |
| [dogfood-output/猴测报告.md](dogfood-output/猴测报告.md) | 测试 / 维护者 | 15 条 finding（4 High / 9 Medium / 2 Low）、修法、实测证据、复跑计数、猴测台自身 9 个缺陷与未覆盖范围 |

## 1. 接入总则

把游戏接进平台，需要实现 [module-api.ts](packages/game-sdk/src/module-api.ts) 里的两个接口。平台负责房间、座位、权限和消息投递，玩法逻辑放在游戏模块里。公开类型、客户端契约和 `bpmap` 打包器在 `@bp/game-sdk`；平台内部仍从 `@bp/server` 兼容入口导出同一套类型。

接入时有三条限制：

1. 游戏状态由游戏自己保存。平台不解析它，只负责原样保存和转发。
2. 游戏不能直接操作 socket。所有对外消息都通过返回 `Effect[]` 交给平台发送。
3. 游戏不能改房间相位、座位表或房主权限。这些由平台处理。

模块目录名要和模块导出的 `id` 一致（`^[a-z0-9][a-z0-9-]{0,31}$`），否则加载器会拒绝加载。

## 2. GameModule

```ts
export const myModule: GameModule = {
  id: 'mygame', name: '我的游戏', version: '0.1.0',
  entry: 'client.js',                 // 相对 games/<id>/ 的地址，不能含 '..' 或 http
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

游戏界面拿不到 socket，也拿不到别人的座位，只能用 `actions.send()` 和 `actions.seatId()`。不写界面也能运行，平台会显示一个简单的占位面板。

客户端入口在 `sandbox="allow-scripts"` 的 iframe 里执行，不带 `allow-same-origin`：读不到宿主的 `localStorage`、票据和 DOM。入口源码先在父页面按清单哈希校验，再交给沙箱。入口要写成单文件模块，不要用相对 `import`；包内资源用 `fetch('assets/...')`，iframe 的 base 已指向入口目录。

## 5. 目录与构建

平台仓库里的目录式模块只用于测试夹具：`tools/testkit/test-games/`，由 testkit 的 `tsconfig` 编译；`games/` 里只放生成的 `.bpmap`。第三方游戏在自己的工程里构建，打成 `.bpmap` 分发，不要把源码加进平台 monorepo。

`bash tools/devtools/check-seam.sh` 扫运行时平台包和 testkit 的工具代码：运行时包里不能出现玩法词，也不能 import `games/`；测试夹具在 testkit 里，按测试资产处理。

参考夹具：[turn-based](tools/testkit/test-games/turn-based/index.ts)、[simultaneous](tools/testkit/test-games/simultaneous/index.ts)。

## 6. 单文件游戏包（.bpmap）

游戏分发用 `.bpmap` 单文件；目录式只用于平台自己的测试夹具和开发。把 `.bpmap` 丢进 `games/`，宿主启动时会扫描、校验、解包，并像目录游戏一样加载。

源目录里放一个 `bpmap.json`：

```json
{
  "id": "mygame",
  "version": "0.1.0",
  "server": "server.js",
  "client": "client.js"
}
```

- `id` 和模块导出的 `id` 一致，`version` 和模块导出的 `version` 一致；不一致时宿主跳过这个包并在控制台说明原因。
- `server` 是包内服务端入口；`client` 可选，填了就必须在包内，并和模块导出的 `entry` 一致。
- 源目录里除 `bpmap.json` 外的普通文件都会进包。不允许符号链接、`..` 和绝对路径。
- 服务端入口可以直接 `import '@bp/game-sdk'` 或 `'@bp/protocol'`，宿主按自己装的版本解析，不要求把 SDK 打进包。除此之外的裸包名，宿主不会替你在它的 `node_modules` 里找：要么打进包内（例如源目录里的 `node_modules/`），要么改成相对路径。
- 打包、检查、调试解包：

```bash
node tools/devtools/bpmap.mjs pack mygame --out mygame.bpmap
node tools/devtools/bpmap.mjs inspect mygame.bpmap
node tools/devtools/bpmap.mjs unpack mygame.bpmap ./mygame-unpacked

# 外部工程装 @bp/game-sdk 后也可以直接用 bpmap 这个 bin
bpmap pack mygame --out mygame.bpmap
```

把 `mygame.bpmap` 放进 `games/`，重启宿主即可。宿主把包解到数据目录下的 `packs/<id>/<包哈希>/`：开发目录是 `data/packs`，便携包是 `%LOCALAPPDATA%\3178-battle-platform\data\packs`。缓存的文件集合必须和包清单完全一致；多一个文件、少一个文件或改一个字节都会重新解包。

同一个 id 只加载一个包：和目录游戏或其他包重名时，后面的包会被跳过并在控制台报错。包版本在入房握手里是 `模块版本+包哈希前 12 位`，两边不一致会被版本闸挡住。

包里的服务端代码会在房主进程里执行，和安装一个程序一样，只装来源可信的包。客户端入口在沙箱 iframe 中执行，源码先按包清单的 sha256 校验（清单随 `/api/games` 下发）再交给沙箱；它不继承宿主的 localStorage 和票据。
