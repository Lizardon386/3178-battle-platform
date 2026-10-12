// 由测试通过 NODE_OPTIONS=--import 注入：等宿主壳把服务起起来，再在这个进程里触发一次 SIGINT。
// 这只验证 cli 自己注册的收尾处理器（落盘、删 run 记录、exit 0）；
// "按下 Ctrl+C 会不会被投递成 SIGINT" 是 libuv/控制台的事，Windows 上无法从外部模拟（见 CONTEXT）。
const delayMs = Number(process.env.BP_SIGINT_DELAY_MS ?? '1500');
setTimeout(() => {
  process.emit('SIGINT');
}, delayMs);
