# @bp/game-sdk

3178 对战平台的游戏接入 SDK。游戏工程只需要安装这个包（构建/打包再加 `@bp/sdk-tools`）。

导出路径：

- `@bp/game-sdk`：游戏 ABI、版本常量、`reject` / `isReject` / `stableDigest`
- `@bp/game-sdk/client`：客户端契约类型
- `@bp/game-sdk/node`：`.bpmap` 读写（re-export `@bp/pack-format`）
- `@bp/game-sdk/kit`：ChatPanel / FeedPanel / ScoreboardPanel / seatColor
- `@bp/game-sdk/kit/server`：FeedLog

接入文档：[INTEGRATION_GUIDE.md](https://github.com/Lizardon386/3178-battle-platform/blob/master/INTEGRATION_GUIDE.md)

License: MIT
