# @3178/game-sdk

3178 对战平台的游戏接入 SDK。游戏工程只需要安装这个包（构建/打包再加 `@3178/sdk-tools`）。

导出路径：

- `@3178/game-sdk`：游戏 ABI、版本常量、`reject` / `isReject` / `stableDigest`
- `@3178/game-sdk/client`：客户端契约类型
- `@3178/game-sdk/node`：`.bpmap` 读写（re-export `@3178/pack-format`）
- `@3178/game-sdk/kit`：ChatPanel / FeedPanel / ScoreboardPanel / seatColor
- `@3178/game-sdk/kit/server`：FeedLog

接入文档：[INTEGRATION_GUIDE.md](https://github.com/Lizardon386/3178-battle-platform/blob/master/INTEGRATION_GUIDE.md)

License: MIT
