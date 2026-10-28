# @lizardon386/game-sdk

3178 对战平台的游戏接入 SDK。游戏工程只需要安装这个包（构建/打包再加 `@lizardon386/sdk-tools`）。

导出路径：

- `@lizardon386/game-sdk`：游戏 ABI、版本常量、`reject` / `isReject` / `stableDigest`、规则表单与静态资料的校验（`parseRuleConfig` / `parseGameReference`）
- `@lizardon386/game-sdk/client`：客户端契约类型
- `@lizardon386/game-sdk/node`：`.bpmap` 读写（re-export `@lizardon386/pack-format`）
- `@lizardon386/game-sdk/kit`：ChatPanel / FeedPanel / ScoreboardPanel / seatColor
- `@lizardon386/game-sdk/kit/server`：FeedLog

接入文档：[INTEGRATION_GUIDE.md](https://github.com/Lizardon386/3178-battle-platform/blob/master/INTEGRATION_GUIDE.md)

License: MIT
