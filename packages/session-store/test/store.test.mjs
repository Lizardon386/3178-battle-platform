import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson, FileSessionRepository, SessionWal } from '../dist/index.js';
import { createSession, join as coreJoin } from '@bp/session-core';

const temp = () => mkdtemp(join(tmpdir(), 'bp-store-'));

test('原子写：第二次写入留下 .bak，主文件是新内容', async () => {
  const dir = await temp();
  const file = join(dir, 'state.json');
  await atomicWriteJson(file, { n: 1 });
  await atomicWriteJson(file, { n: 2 });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { n: 2 });
  assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { n: 1 });
});

test('WAL：链式哈希校验，坏尾被截断', async () => {
  const dir = await temp();
  const wal = new SessionWal(join(dir, 'session.wal'));
  await wal.append({ kind: 'a', body: { n: 1 } });
  await wal.append({ kind: 'b', body: { n: 2 } });
  await wal.append({ kind: 'c', body: { n: 3 } });
  let read = await wal.read();
  assert.equal(read.entries.length, 3);
  assert.equal(read.dropped, 0);

  await writeFile(join(dir, 'session.wal'), (await readFile(join(dir, 'session.wal'), 'utf8')) + '{"seq":4,"pre', 'utf8');
  read = await wal.read();
  assert.equal(read.entries.length, 3);
  assert.equal(read.dropped, 1);

  const repaired = await wal.repair();
  assert.deepEqual(repaired, { kept: 3, dropped: 1 });
  assert.equal((await wal.read()).entries.length, 3);
});

test('文件仓库：会话保存/读取/列表与操作去重', async () => {
  const dir = await temp();
  const repository = new FileSessionRepository({ root: dir });
  let session = createSession({
    sessionId: 'sess-1', code: 'ABCD', gameId: 'reference-duel', gameVersion: '1.0.0',
    ownerMemberId: 'm1', ownerTicketHash: 'h1', now: 1000,
  });
  await repository.save(session);
  assert.deepEqual(await repository.load('sess-1'), session);
  assert.equal((await repository.list()).length, 1);

  session = coreJoin(session, { memberId: 'm2', ticketHash: 'h2', now: 1100 }).value.session;
  await repository.save(session);
  assert.equal((await repository.load('sess-1')).members.length, 2);

  await repository.putOperation('sess-1', { key: 'k1', payloadHash: 'p', state: 'applied', createdAt: 1 });
  assert.equal((await repository.getOperation('sess-1', 'k1')).state, 'applied');
  assert.equal(await repository.getOperation('sess-1', 'missing'), null);
});

test('文件仓库：同一会话并发保存被串行化，不互相踩 rename', async () => {
  const dir = await temp();
  const repository = new FileSessionRepository({ root: dir });
  const session = createSession({
    sessionId: 'sess-1', code: 'ABCD', gameId: 'reference-duel', gameVersion: '1.0.0',
    ownerMemberId: 'm1', ownerTicketHash: 'h1', now: 1000,
  });
  await Promise.all([
    repository.save(session),
    repository.save({ ...session, revision: 2 }),
    repository.save({ ...session, revision: 3 }),
  ]);
  const loaded = await repository.load('sess-1');
  assert.ok(loaded);
  assert.ok([1, 2, 3].includes(loaded.revision));
});

test('文件仓库：非法 sessionId 拒绝路径穿越', async () => {
  const dir = await temp();
  const repository = new FileSessionRepository({ root: dir });
  await assert.rejects(() => repository.load('../escape'), /非法 sessionId/);
});
