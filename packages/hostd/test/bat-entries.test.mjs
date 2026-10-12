import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 双击入口的编码防呆。
 * 上界版本就是栽在这里：UTF-8 中文被 cmd 按 cp936 解析，第二个字节落进 GBK trail 区
 * （里面有个 '|'），于是中文里被"拼"出命令分隔符——先甩一句"系统找不到指定的路径"，
 * 再把"没找到 node"误打出来，node 其实装得好好的。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bats = readdirSync(ROOT).filter((name) => name.toLowerCase().endsWith('.bat'));

test('仓库根至少要有两个双击入口', () => {
  assert.ok(bats.length >= 2, `只找到：${bats.join('、')}`);
});

for (const name of bats) {
  test(`${name}：UTF-8 无 BOM + CRLF + chcp 先于任何中文`, () => {
    const bytes = readFileSync(join(ROOT, name));
    assert.equal(bytes[0] === 0xef && bytes[1] === 0xbb, false, '带 BOM 会让首行命令解析失败');
    assert.ok(bytes.includes(Buffer.from('\r\n')), 'cmd 对 LF 结尾的批处理会错行（标签/goto 尤其）');
    const text = bytes.toString('utf8');
    const lines = text.split('\r\n');
    assert.equal(
      lines.some((line) => line.includes('\n')),
      false,
      '混进了裸 LF，行尾不统一',
    );
    const chcpLine = lines.findIndex((line) => line.includes('chcp 65001'));
    assert.ok(chcpLine >= 0, '缺 chcp 65001：中文会被按 cp936 解析成乱码并拼断命令');
    const firstNonAscii = text.search(/[^\x00-\x7f]/);
    const asciiSoFar = firstNonAscii < 0 ? text : text.slice(0, firstNonAscii);
    assert.ok(
      asciiSoFar.includes('chcp 65001'),
      '第一个非 ASCII 字符必须出现在 chcp 之后，否则那几行仍是乱码',
    );
    assert.equal(text.includes('/dev/null'), false, '被 Git Bash 的路径转换改写过（nul → /dev/null），cmd 会报错');
    assert.match(text, /where node/, '要先确认 node 在 PATH 里，否则用户只会看到一句天书');
    assert.match(text, /packages\\hostd\\dist\\cli\.js/, '要真的指向宿主壳入口');
  });

  test(`${name}：只做启动器，最后一行必须 exit /b 0（不然后台跑着批处理，Ctrl+C 会问 Y/N）`, () => {
    const lines = readFileSync(join(ROOT, name), 'utf8').split('\r\n').filter((l) => l.trim() !== '');
    assert.equal(lines.at(-1), 'exit /b 0', '结尾不能是 pause：双击的人只是想关掉窗口');
    assert.match(readFileSync(join(ROOT, name), 'utf8'), /start "[^"]+" node /, '要把 node 开进自己的控制台窗口');
  });
}
