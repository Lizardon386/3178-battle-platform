import { writeFileSync, readFileSync } from 'node:fs';

// 生成两个双击入口。要点：UTF-8 无 BOM + CRLF + 第二行 chcp 65001，
// 中文只允许出现在 chcp 之后——否则 cmd 按 cp936 解析 UTF-8 字节，
// 第二个字节会落在 GBK trail 区（含 '|'），把命令行拼断。
const NUL = '>nul';
const HEAD = [
  '@echo off',
  `${NUL} chcp 65001`,
  'setlocal EnableExtensions',
  'cd /d "%~dp0"',
  '',
];

const guard = (message) => [
  `  echo [x] ${message}`,
  '  pause',
  '  exit /b 1',
  ')',
];

const HOST = [
  ...HEAD,
  'where node ' + NUL + ' 2>&1',
  'if errorlevel 1 (',
  ...guard('没找到 node。请先装 Node LTS，或用绿色便携包那份（R1 还在做）。'),
  'if not exist node_modules\\ws (',
  ...guard('缺依赖。先在这个目录跑一次：npm install'),
  'if not exist packages\\hostd\\dist\\cli.js (',
  ...guard('还没编译。先在这个目录跑一次：npm run build'),
  'echo 房主端启动中：本机 http://localhost:3000    Ctrl+C 结束对局并落盘',
  'node packages\\hostd\\dist\\cli.js host --port 3000 %*',
  'pause',
  '',
].join('\r\n');

const JOIN = [
  ...HEAD,
  'where node ' + NUL + ' 2>&1',
  'if errorlevel 1 (',
  ...guard('没找到 node。请先装 Node LTS，或用绿色便携包那份（R1 还在做）。'),
  'if not exist packages\\hostd\\dist\\cli.js (',
  ...guard('还没编译。先在这个目录跑一次：npm run build'),
  'echo 本地壳启动中：http://127.0.0.1:3178    （Ctrl+C 退出）',
  'start "" http://127.0.0.1:3178/',
  'node packages\\hostd\\dist\\cli.js join --port 3178 %*',
  'pause',
  '',
].join('\r\n');

writeFileSync('房主建房.bat', HOST, 'utf8');
writeFileSync('玩家本机壳.bat', JOIN, 'utf8');

for (const name of ['房主建房.bat', '玩家本机壳.bat']) {
  const bytes = readFileSync(name);
  const text = bytes.toString('utf8');
  const firstNonAscii = [...text].findIndex((c) => c.codePointAt(0) > 127);
  const chcpLine = text.split('\r\n').findIndex((l) => l.includes('chcp 65001'));
  console.log(
    name,
    '| BOM:', bytes[0] === 0xef,
    '| CRLF:', bytes.includes(Buffer.from('\r\n')),
    '| 含 /dev/null:', text.includes('/dev/null'),
    '| 首个中文在第', firstNonAscii, '字符，chcp 在第', chcpLine + 1, '行',
  );
}
