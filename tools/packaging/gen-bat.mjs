import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// 生成两个双击入口。两条硬规矩：
//  1) UTF-8 无 BOM + CRLF + 第二行 chcp 65001，中文只允许出现在 chcp 之后——
//     否则 cmd 按 cp936 解析 UTF-8 字节，第二个字节落在 GBK trail 区（含 '|'），把命令行拼断。
//  2) 脚本只当"启动器"：用 start 把 node 开进它自己的控制台窗口，然后立刻 exit /b 0。
//     这样 Ctrl+C 落在 node 那个窗口上——那里没有批处理在跑，cmd 不会再问
//     "终止批处理操作吗(Y/N)?"，node 收尾退出后窗口自己关。
//     失败分支仍然 pause，否则双击的人看不到错误原因。
//
// 开发目录与便携包只差"node 从哪来"：开发目录用 PATH 里的 node，便携包用同目录的 node.exe。
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

const nodeGuard = (portable) => (portable
  ? ['if not exist "%~dp0node.exe" (', ...guard('同目录缺少 node.exe。便携包应该自带它；开发目录请先装 Node LTS。')]
  : ['where node ' + NUL + ' 2>&1', 'if errorlevel 1 (', ...guard('没找到 node。请先装 Node LTS。')]);

const depsGuard = (portable) => (portable
  ? []
  : ['if not exist node_modules\\ws (', ...guard('缺依赖。先在这个目录跑一次：npm install')]);

const distGuard = (portable) => [
  'if not exist packages\\hostd\\dist\\cli.js (',
  ...guard(portable ? '便携包不完整（缺 packages\\hostd\\dist\\cli.js），重新解压或重新制作。' : '还没编译。先在这个目录跑一次：npm run build'),
];

const nodeCommand = (portable) => (portable ? '"%~dp0node.exe"' : 'node');

const tail = [
  'rem 给壳两秒起服务，再开浏览器（ping 当睡眠用，timeout 在输入被重定向时会失败）',
  `ping -n 3 127.0.0.1 ${NUL}`,
  'start "" http://127.0.0.1:3178/',
  'exit /b 0',
  '',
];

export function renderHostBat({ portable = false } = {}) {
  return [
    ...HEAD,
    ...nodeGuard(portable),
    ...depsGuard(portable),
    ...distGuard(portable),
    `start "3178 房主端" ${nodeCommand(portable)} packages\\hostd\\dist\\cli.js host --port 3178 --lan-port 3000 %*`,
    ...tail,
  ].join('\r\n');
}

export function renderJoinBat({ portable = false } = {}) {
  return [
    ...HEAD,
    ...nodeGuard(portable),
    ...depsGuard(portable),
    ...distGuard(portable),
    `start "3178 玩家进房" ${nodeCommand(portable)} packages\\hostd\\dist\\cli.js join --port 3178 %*`,
    ...tail,
  ].join('\r\n');
}

export function verifyBat(name, text) {
  const bytes = Buffer.from(text, 'utf8');
  const firstNonAscii = [...text].findIndex((c) => c.codePointAt(0) > 127);
  const lines = text.split('\r\n');
  const chcpLine = lines.findIndex((l) => l.includes('chcp 65001'));
  console.log(
    name,
    '| BOM:', bytes[0] === 0xef,
    '| CRLF:', bytes.includes(Buffer.from('\r\n')),
    '| 含 /dev/null:', text.includes('/dev/null'),
    '| 首个中文在第', firstNonAscii, '字符，chcp 在第', chcpLine + 1, '行',
  );
}

function writeRepoBats() {
  const host = renderHostBat();
  const join = renderJoinBat();
  writeFileSync('房主建房.bat', host, 'utf8');
  writeFileSync('玩家进房.bat', join, 'utf8');
  verifyBat('房主建房.bat', readFileSync('房主建房.bat', 'utf8'));
  verifyBat('玩家进房.bat', readFileSync('玩家进房.bat', 'utf8'));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) writeRepoBats();
