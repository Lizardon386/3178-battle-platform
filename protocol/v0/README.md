# 3178 语言中立会话协议 · v0（S1 草案）

> 状态：S1 设计草案与契约测试输入，**不接现有运行时，不兼容旧 `PROTOCOL_VERSION=1`**。
> 唯一字据：`catalog.json`（方向与权限）+ `messages.schema.json`（字段形状）+ `errors.json` + `capabilities.json`。本文解释语义；字段冲突以 JSON Schema 为准。

## 1. 边界

- 平台持有会话 `open/closed`、成员表、通用 `ready`、开始闸、票据、revision、落盘与游戏进程生命周期。
- `startGame` 通过前没有 Game Authority 进程；通过后平台才拉起它并发送 `start` 快照。
- 平台不解释 `config`、`options` 与游戏 `payload`；不替游戏做视角裁剪。
- 平台身份资料 `profile` 可传给游戏；`displayColor` 仅用于识别，不是阵营或队伍。
- 转交房主只转移权限，不迁移 Session Service 或 Game Authority 所在机器。

## 2. 状态机

### 会话

- `open`：会话存在，可入席、准备、聊天；与是否开始游戏无关。
- `closed`：会话终止；由房主关闭或平台超时策略触发。

### 成员

- `ready` 是平台成员表里的通用布尔值，只由本人 `setReady` 改变。
- `setConfig` 只在 `gameProcess=stopped` 时合法；成功后所有 `kind=player` 的成员 `ready=false`，revision 增加。
- AI 与观战成员的 `ready` 恒为 `false`，不计入开始闸。
- 开始闸：仅房主可执行 `startGame`；至少一名真人，且所有已连接真人 `ready=true`。断线真人仍处于掉线宽限时不能绕过开始闸。

### 游戏进程

```text
stopped → starting → running → exited
              └──────→ failed
```

- `stopped`：尚未开始；允许 `setConfig` / `setSeatOptions` / `startGame`。
- `starting`：平台已收到合法 `startGame`，正在拉起进程；重复开始返回 `PHASE`。
- `running`：收到 `authorityReady`；平台转发成员变化与游戏消息。
- `failed`：启动失败、启动超时或权威报告致命错误；平台广播原因，允许房主决定是否关闭会话。
- `exited`：进程退出；平台不把它解释成胜负、结算或回合结束。
- 回合、胜负、结算、再来一局归游戏。`roundClosed` 的 `payload` 对平台不透明。

## 3. 身份、权限与网页游戏

- 平台座位票据只在 `seatGranted` 下发；盘上只存其摘要。`resume` 必须带票据。
- 网页游戏不取得平台管理票据。平台通过 `gameHandoff` 返回独立 origin 的 URL 与一次性 `handoffCode`；游戏以 `gameAuth` 换取受限 `gameTicket`。
- `handoffCode` 只放 URL fragment，短期有效、一次性、绑定 session + seat；不得写入查询日志或 Referer。
- `gameTicket` 只允许 `gameAuth`、`game`、`ping` 与游戏侧重连；不得调用准备他人、配置、开始、踢人、移交或解散。
- `profile = { nick, avatar?, displayColor? }`。`displayColor` 是 `#RRGGBB`，不使用 CSS 变量。头像只能是平台校验后的资源地址；schema 只限制长度，资源安全策略由实现层执行。
- 阵营、队伍、难度等玩法含义放 `options`，不得借用 `displayColor`。

## 4. 消息与方向

消息是扁平 UTF-8 JSON 对象，以 `type` 判别；未声明字段一律拒绝。完整方向、通道与权限见 `catalog.json`。

- 客户端 ↔ 平台：WebSocket；`hello` 只协商平台协议与能力，不带大厅里预选的 `gameId/version`。
- 平台 ↔ Game Authority：本地回环 TCP；同一 `type` 在不同方向可有不同字段，分别使用 `Platform*` / `Authority*` schema。
- 客户端 `game` 只发给权威，不提供客户端直达其他座位的 `to` 字段。
- 权威 `deliver.items[]` 是唯一出站形式：`{to: seatId | 'all', payload}`。平台逐项投递，不合并、不裁剪、不读 payload。
- `sessionState` 是成员与进程状态的全量快照；`revision` 单调递增，客户端不得接受同房旧 revision 覆盖新状态。

## 5. 配置摘要与落盘

- `rulesHash` 由平台计算，不信任客户端自报。算法：对 `config` 做递归键排序的 canonical JSON（对象键按 Unicode 码点排序、数组保序、无多余空白），UTF-8 编码后 SHA-256，输出小写 hex。
- `sessionJoin` 的版本与 `rulesHash` 是针对目标房间的声明；`resume` 只凭票，不重新声明大厅预选版本。
- 平台只落盘会话元数据：房号、成员与 profile、票据摘要、连接状态、ready、config、options、gameProcess 与 revision；游戏状态归游戏。

## 6. 本地 IPC 帧

- 传输：回环 TCP，不在非本机地址监听。
- 帧：4 字节无符号大端长度 `N` + N 字节 UTF-8 JSON；N 不含长度字段自身。
- 上限：单帧 1 MiB；长度超限、JSON 解析失败或 schema 不匹配均关闭 IPC 并记 `BADMSG`。
- 每条 IPC 连接只允许一个会话；进程启动后第一条游戏侧消息必须是 `authorityReady` 或 `authorityError`。
- S1 建议默认值：启动超时 5s、IPC 请求超时 5s、心跳 10s；这些是待 S2 实测的实现参数，不是真机结论。

## 7. 错误与通知

- `error` 只用于平台级拒绝；码表见 `errors.json`。`text` 是给用户的中文说明，`details` 是可选结构化信息。
- 新增 `NOTREADY`（开始闸未满足）、`GAMEFAILED`（进程启动或运行失败）、`HANDOFF`（交接码无效 / 过期 / 已使用）、`FORBIDDEN`（受限游戏凭证越权）。
- 玩法错误由游戏定义并通过 `deliver` 发给目标座位，不进入平台错误码表。
- 链路断开时房间命令本地拒绝并说明，不静默排队；只有握手与重连消息可等待连接建立。

## 8. 示例与校验

`examples/` 里的文件都必须通过 `messages.schema.json`。校验测试位于 `tools/testkit/test/s1-protocol.test.mjs`，随 `npm test` 自动运行；测试还覆盖额外字段、非法颜色、空投递、游戏通道越权与缺失交接凭证。

S1 的下一步是用同一份 spec 生成至少两种语言的类型，并让最小参考游戏对 mock Session Service 跑通；本目录本身不启动任何服务。
