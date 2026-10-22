#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { packDirectory, readPack, readPackSource } from '../node/pack.js';

function usage(): void {
  console.log(`用法：
  bpmap pack <源目录> [--out <文件>]
  bpmap inspect <文件.bpmap>
  bpmap unpack <文件.bpmap> <目录>

源目录必须有 bpmap.json：{ "id", "version", "server", "client?" }。
源目录里除 bpmap.json 外的普通文件都会进包。`);
}

function fail(message: string): never {
  console.error(`[x] ${message}`);
  process.exit(1);
}

interface Parsed {
  command: string | undefined;
  args: string[];
  out: string | null;
}

function parse(argv: string[]): Parsed {
  const command = argv[0];
  const args: string[] = [];
  let out: string | null = null;
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === '--out') {
      const value = argv[i + 1];
      if (!value) fail('--out 后要跟文件路径');
      out = value;
      i += 1;
    } else if (token === '--help' || token === '-h') {
      usage();
      process.exit(0);
    } else {
      args.push(token);
    }
  }
  return { command, args, out };
}

const { command, args, out } = parse(process.argv.slice(2));
if (!command) {
  usage();
  process.exit(1);
}

try {
  if (command === 'pack') {
    const source = args[0];
    if (!source) fail('用法：bpmap pack <源目录> [--out <文件>]');
    const sourceAbs = resolve(source);
    if (!existsSync(join(sourceAbs, 'bpmap.json'))) fail(`源目录缺 bpmap.json：${sourceAbs}`);
    const manifest = readPackSource(sourceAbs);
    const outAbs = resolve(out ?? join(process.cwd(), `${manifest.id}.bpmap`));
    if (outAbs === sourceAbs || outAbs.startsWith(`${sourceAbs}${sep}`)) {
      fail('输出不能放在源目录里，否则下次打包会把旧包也装进去');
    }
    const packed = packDirectory(sourceAbs, outAbs, manifest);
    const pack = readPack(outAbs);
    const bytes = packed.files.reduce((sum, file) => sum + file.size, 0);
    console.log(`已生成 ${outAbs}`);
    console.log(`  id/version：${packed.id} ${packed.version}`);
    console.log(`  文件：${packed.files.length} 个，${bytes} 字节`);
    console.log(`  包哈希：${pack.packageHash}`);
    console.log('把文件丢进 games/，下次启动宿主就会加载。');
  } else if (command === 'inspect') {
    const file = args[0];
    if (!file) fail('用法：bpmap inspect <文件.bpmap>');
    const pack = readPack(resolve(file));
    const bytes = pack.manifest.files.reduce((sum, entry) => sum + entry.size, 0);
    console.log(`包：${resolve(file)}`);
    console.log(`  id/version：${pack.manifest.id} ${pack.manifest.version}`);
    console.log(`  服务端入口：${pack.manifest.server}`);
    console.log(`  客户端入口：${pack.manifest.client ?? '（没有）'}`);
    console.log(`  文件：${pack.manifest.files.length} 个，${bytes} 字节`);
    console.log(`  包哈希：${pack.packageHash}`);
    for (const entry of pack.manifest.files) {
      console.log(`  ${entry.path}  ${entry.size}  ${entry.sha256}`);
    }
  } else if (command === 'unpack') {
    const file = args[0];
    const target = args[1];
    if (!file || !target) fail('用法：bpmap unpack <文件.bpmap> <目录>');
    const pack = readPack(resolve(file));
    const outDir = resolve(target);
    for (const entry of pack.files) {
      const absolute = resolve(outDir, ...entry.path.split('/'));
      if (absolute !== outDir && !absolute.startsWith(`${outDir}${sep}`)) fail(`路径越界：${entry.path}`);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, entry.bytes);
    }
    console.log(`已解包到 ${outDir}`);
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
