# 3178 对战平台 · 接入契约

> 面向游戏开发者：把新玩法接进平台需要实现的接口、出站规则与目录要求。
> 平台架构与运行模式见 [DESIGN.md](DESIGN.md)，使用者说明见 [README.md](README.md)。
> 最近更新：2026-10-20

实现 [module-api.ts](packages/server/src/module-api.ts) 里的两个接口，游戏就接进来了。三条硬规矩写在文件头：

- 状态不进平台对象——平台只搬 opaque blob。
- 游戏不许直接碰 socket——一切对外投递都通过返回 `Effect[]`。
- 游戏不许改房间相位、座位表或房主权限——Ready 闸、掉线 TTL、审计都在平台。

目录名必须等于模块自称的 `id`（`^[a-z0-9][a-z0-9-]{0,31}$`），加载器会拒绝不一致。

## `GameModule`

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
  acceptsSnapshot: (snapshot) => snapshot?.version === 1,
};
```

`rulesHashOf` 只挑影响玩法的字段：房主改房名不应让客人报“房规不同”。`ctx` 提供注入的 `now()` / `random()`、`seats()` / `seat(id)`，测试因此可以确定性推进。

## `GameInstance`

- 必给：`serialize(viewer)` / `handle(action, by)` / `begin()` / `snapshot()`。
  - `serialize(viewer)` 里 `viewer === null` 是观战视角；隐私裁剪归游戏。
  - `handle` / `begin` 返回 `Effect[]`；非法动作返回 `reject('中文说明', 'PHASE')`，不要抛异常或静默吞掉。拒绝文案会直接显示给玩家。
- 按需：`tick(now)`、`onSeatJoin`、`onSeatLeave`、`onTimeout`、`dispose`。
- `Effect` 六种：`broadcast` / `toSeat` / `notice` / `system` / `end` / `kick`。

## 客户端界面（可选）

`entry` 最终解析成 `<房主地址>/games/<id>/<entry>`。入口导出 `default` 或 `client`：

```js
export default {
  mount(host, view, actions) { /* 渲染 view；按钮里 actions.send('动作名', payload) */ },
  unmount(host) {},
  onEvent({ name, payload }, actions) { /* 服务端 broadcast 的事件 */ },
};
```

拿不到 socket、拿不到别人的座位，只有 `actions.send()` 与 `actions.seatId()`。没有界面也能跑：平台会退到内置占位面板。

## 目录、构建与接缝闸门

放进 `games/<id>/`，`package.json` 的 `main` 指向 `dist/index.js`；根 `tsconfig.json` 的 `references` 加一行 `{ "path": "games/<id>" }`。漏了这步 `npm run build` 不产出 `dist/index.js`，而 `loadGames()` 会静默跳过没有该文件的目录。

`tools/check-seam.sh` 必须保持零命中：`packages/*/src` 里不得出现玩法词或 `games/` import。参考实现：[games/echo](games/echo/src/index.ts)（回合制 + 隐私）与 [games/turncount](games/turncount/src/index.ts)（无游标 + 无隐私 + 同时操作）。两者的玩家可见名都标了“测试 demo”，不是正式内容。
