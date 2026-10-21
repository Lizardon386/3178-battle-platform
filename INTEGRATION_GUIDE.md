# 游戏接入指南

> 写给要接新游戏的人。平台架构见 [DESIGN.md](DESIGN.md)，玩家说明见 [README.md](README.md)。
> 最近更新：2026-10-20

把游戏接进平台，需要实现 [module-api.ts](packages/server/src/module-api.ts) 里的两个接口。平台负责房间、座位、权限和消息投递，玩法逻辑放在游戏模块里。

接入时有三条限制：

1. 游戏状态由游戏自己保存。平台不解析它，只负责原样保存和转发。
2. 游戏不能直接操作 socket。所有对外消息都通过返回 `Effect[]` 交给平台发送。
3. 游戏不能改房间相位、座位表或房主权限。这些由平台处理。

模块目录名要和模块导出的 `id` 一致（`^[a-z0-9][a-z0-9-]{0,31}$`），否则加载器会拒绝加载。

## GameModule

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

## GameInstance

必须实现：

- `serialize(viewer)`：按视角返回状态。`viewer === null` 表示观战；哪些信息该藏起来由游戏决定。
- `handle(action, by)` 和 `begin()`：返回 `Effect[]`。动作不合法时用 `reject('中文说明', 'PHASE')` 返回，不要抛异常，也不要静默忽略。提示会直接显示给玩家。
- `snapshot()`：返回要落盘和恢复的完整状态。

按需实现：`tick(now)`、`onSeatJoin`、`onSeatLeave`、`onTimeout`、`dispose`。

`Effect` 有六种：`broadcast`、`toSeat`、`notice`、`system`、`end`、`kick`。

## 客户端界面（可选）

`entry` 会解析成 `<房主地址>/games/<id>/<entry>`。入口导出 `default` 或 `client`：

```js
export default {
  mount(host, view, actions) { /* 渲染 view；按钮里调用 actions.send('动作名', payload) */ },
  unmount(host) {},
  onEvent({ name, payload }, actions) { /* 接收服务端 broadcast 的事件 */ },
};
```

游戏界面拿不到 socket，也拿不到别人的座位，只能用 `actions.send()` 和 `actions.seatId()`。不写界面也能运行，平台会显示一个简单的占位面板。

## 目录与构建

把模块放在 `games/<id>/`，`package.json` 的 `main` 指向 `dist/index.js`。根 `tsconfig.json` 的 `references` 里加一行 `{ "path": "games/<id>" }`；不加的话 `npm run build` 不会生成 `dist/index.js`，`loadGames()` 会跳过这个目录。

`bash tools/check-seam.sh` 应该保持无输出：`packages/*/src` 里不要出现玩法词，也不要 import `games/`。参考实现是 [games/echo](games/echo/src/index.ts) 和 [games/turncount](games/turncount/src/index.ts)，两者都标成测试 demo。

## 单文件游戏包（.bpmap）

除了把模块放进 `games/<id>/`，也可以打成一个 `.bpmap` 文件丢进 `games/`。宿主启动时会扫描、校验、解包，并像目录游戏一样加载。

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
- 打包、检查、调试解包：

```bash
node tools/bpmap.mjs pack mygame --out mygame.bpmap
node tools/bpmap.mjs inspect mygame.bpmap
node tools/bpmap.mjs unpack mygame.bpmap ./mygame-unpacked
```

把 `mygame.bpmap` 放进 `games/`，重启宿主即可。宿主把包解到数据目录下的 `packs/<id>/<包哈希>/`：开发目录是 `data/packs`，便携包是 `%LOCALAPPDATA%\3178-battle-platform\data\packs`。缓存的文件集合必须和包清单完全一致；多一个文件、少一个文件或改一个字节都会重新解包。

同一个 id 只加载一个包：和目录游戏或其他包重名时，后面的包会被跳过并在控制台报错。包版本在入房握手里是 `模块版本+包哈希前 12 位`，两边不一致会被版本闸挡住。

包里的服务端代码会在房主进程里执行，和安装一个程序一样，只装来源可信的包。客户端入口仍按现有方式从 `/games/<id>/<entry>` 加载；客户端沙箱落地后这里会补上对应限制。
