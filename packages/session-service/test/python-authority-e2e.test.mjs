import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { buildPackage, openGameRegistry } from '@bp/game-package';
import { encodeFrame } from '@bp/session-ws';
import { startService } from '../dist/compose.js';

const pythonCommand = (() => {
  if (process.env.BP_PYTHON) return process.env.BP_PYTHON;
  for (const candidate of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
})();

const PYTHON_AUTHORITY = `import json
import socket
import struct
import sys

def send(sock, value):
    body = json.dumps(value).encode("utf-8")
    sock.sendall(struct.pack(">I", len(body)) + body)

def read_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            return None
        data += chunk
    return data

boot = json.loads(sys.stdin.readline())
sock = socket.create_connection(("127.0.0.1", boot["ipcPort"]))
send(sock, {"type": "authorityReady", "authorityEpoch": boot["epoch"]})

while True:
    header = read_exact(sock, 4)
    if header is None:
        break
    length = struct.unpack(">I", header)[0]
    body = read_exact(sock, length)
    if body is None:
        break
    message = json.loads(body)
    if message.get("type") == "deliver":
        member = message.get("fromMemberId")
        send(sock, {"type": "deliver", "items": [{"to": member, "payload": {"type": "echo", "member": member}}]})
`;

const MANIFEST = {
  id: 'python-echo',
  name: 'Python 回声',
  version: '1.0.0',
  platformRequirements: { protocolVersion: 1, minPlayers: 2, maxPlayers: 2 },
  entryPoints: { authority: 'authority/main.py', web: 'web/index.html' },
  sessionConfig: { fields: [] },
  reference: { entry: 'reference.json' },
};

const waitOpen = (ws) => new Promise((resolvePromise, reject) => {
  ws.once('open', resolvePromise);
  ws.once('error', reject);
});

const waitMessage = (ws, predicate, timeoutMs = 10000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待消息超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    if (isBinary) return;
    const value = JSON.parse(raw.toString());
    if (!predicate(value)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise(value);
  };
  ws.on('message', onMessage);
});

const waitBinary = (ws, predicate, timeoutMs = 10000) => new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error('等待游戏帧超时')), timeoutMs);
  const onMessage = (raw, isBinary) => {
    if (!isBinary) return;
    const text = raw.toString('utf8');
    if (!predicate(text)) return;
    clearTimeout(timer);
    ws.off('message', onMessage);
    resolvePromise(text);
  };
  ws.on('message', onMessage);
});

const connectControl = async (port) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  await waitOpen(ws);
  ws.send(JSON.stringify({ type: 'hello' }));
  await waitMessage(ws, (m) => m.type === 'welcome');
  return ws;
};

test('Python Authority 与 TS 平台经 IPC 互通', { skip: pythonCommand === null ? '本机没有 Python' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bp-python-authority-'));
  const source = join(root, 'source');
  await mkdir(join(source, 'authority'), { recursive: true });
  await mkdir(join(source, 'web'), { recursive: true });
  await writeFile(join(source, 'authority', 'main.py'), PYTHON_AUTHORITY);
  await writeFile(join(source, 'web', 'index.html'), '<!doctype html><title>python echo</title>\n');
  await writeFile(join(source, 'reference.json'), '{"name":"python echo"}\n');
  const outFile = join(root, 'python-echo.bpkg');
  buildPackage({ root: source, manifest: MANIFEST, outFile });

  const dataDir = join(root, 'data');
  const registry = openGameRegistry({ packages: [outFile], cacheRoot: join(dataDir, 'packages') });
  const service = await startService({ dataDir, port: 0, registry, gameOrigin: { port: 0 } });
  const host = await connectControl(service.port);
  const guest = await connectControl(service.port);
  try {
    host.send(JSON.stringify({ type: 'sessionCreate', gameId: 'python-echo', gameVersion: '1.0.0' }));
    const hostSeat = await waitMessage(host, (m) => m.type === 'seatGranted');
    guest.send(JSON.stringify({ type: 'sessionJoin', sessionId: hostSeat.sessionId, code: hostSeat.code }));
    await waitMessage(guest, (m) => m.type === 'seatGranted');
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.members.length === 2);

    host.send(JSON.stringify({ type: 'channelOpen' }));
    const granted = await waitMessage(host, (m) => m.type === 'channelGranted');
    const data = new WebSocket(`ws://127.0.0.1:${service.gamePort}/ws/data`);
    await waitOpen(data);
    data.send(JSON.stringify({ kind: 'data', handoffCode: granted.handoffCode }));
    await waitMessage(data, (m) => m.type === 'dataReady');

    host.send(JSON.stringify({ type: 'startGame' }));
    await waitMessage(host, (m) => m.type === 'sessionState' && m.session.gameProcess === 'running');

    const echo = waitBinary(data, (text) => text.includes('"type":"echo"'));
    const payload = Buffer.from(JSON.stringify({ action: { type: 'ping' } }));
    data.send(encodeFrame({
      v: 1, channelId: granted.channelId, to: 'all', seq: 1, mode: 'reliable', payloadBytes: payload.byteLength,
    }, payload));
    const received = await echo;
    assert.match(received, new RegExp(hostSeat.memberId));
  } finally {
    host.close();
    guest.close();
    await service.close();
  }
});
