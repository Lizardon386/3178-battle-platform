import { writeFileSync, readFileSync } from 'node:fs';

// 生成两个双击入口。两条硬规矩：
//  1) UTF-8 无 BOM + CRLF + 第二行 chcp 65001，中文只允许出现在 chcp 之后——
//     否则 cmd 按 cp936 解析 UTF-8 字节，第二个字节落在 GBK trail 区（含 '|'），把命令行拼断。
//  2) 脚本只当"启动器"：用 start 把 node 开进它自己的控制台窗口，然后立刻 exit /b 0。
//     这样 Ctrl+C 落在 node 那个窗口上——那里没有批处理在跑，cmd 不会再问
//     "终止批处理操作吗(Y/N)?"，node 收尾退出后窗口自己关。
//     失败分支仍然 pause，否则双击的人看不到错误原因。
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
  'start "3178 房主端" node packages\\hostd\\dist\\cli.js host --port 3000 %*',
  'exit /b 0',
  '',
].join('\r\n');

const JOIN = [
  ...HEAD,
  'where node ' + NUL + ' 2>&1',
  'if errorlevel 1 (',
  ...guard('没找到 node。请先装 Node LTS，或用绿色便携包那份（R1 还在做）。'),
  'if not exist packages\\hostd\\dist\\cli.js (',
  ...guard('还没编译。先在这个目录跑一次：npm run build'),
  'start "3178 本地壳" node packages\\hostd\\dist\\cli.js join --port 3178 %*',
  'rem 给壳两秒起服务，再开浏览器（ping 当睡眠用，timeout 在输入被重定向时会失败）',
  `ping -n 3 127.0.0.1 ${NUL}`,
  'start "" http://127.0.0.1:3178/',
  'exit /b 0',
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
