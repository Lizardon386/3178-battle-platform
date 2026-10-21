import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dataDirNote, resolveDataDir } from '../dist/data-dir.js';

/**
 * 数据目录落点的判据。env 显式传进来，不然测试要靠自己改环境变量去猜本机是什么平台。
 */

const made = [];

function tempRoot(withMarker) {
  const dir = mkdtempSync(join(tmpdir(), 'bp-data-dir-'));
  made.push(dir);
  if (withMarker) writeFileSync(join(dir, '.portable-build.json'), '{}', 'utf8');
  return dir;
}

test('开发目录（没有便携标记）时数据仍跟着仓库走', () => {
  const root = tempRoot(false);
  assert.equal(resolveDataDir(root, {}), join(root, 'data'));
});

test('BP_DATA_DIR 优先于便携判断', () => {
  const root = tempRoot(true);
  const override = tempRoot(false);
  assert.equal(resolveDataDir(root, { BP_DATA_DIR: override, LOCALAPPDATA: 'C:/should/not/use' }), resolve(override));
});

test('便携包把数据放到 LOCALAPPDATA 下的应用目录', () => {
  const root = tempRoot(true);
  const local = tempRoot(false);
  assert.equal(resolveDataDir(root, { LOCALAPPDATA: local }), join(local, '3178-battle-platform', 'data'));
});

test('没有 LOCALAPPDATA 时退回 XDG_DATA_HOME，再退回用户目录', () => {
  const root = tempRoot(true);
  const xdg = tempRoot(false);
  assert.equal(resolveDataDir(root, { XDG_DATA_HOME: xdg }), join(xdg, '3178-battle-platform', 'data'));
  assert.ok(resolveDataDir(root, {}).startsWith(homedir()));
});

test('说明行讲清为什么数据在这里', () => {
  const dev = tempRoot(false);
  const portable = tempRoot(true);
  assert.match(dataDirNote(dev, {}), /开发目录/);
  assert.match(dataDirNote(portable, { LOCALAPPDATA: tempRoot(false) }), /更新程序目录不会丢/);
});

test.after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
