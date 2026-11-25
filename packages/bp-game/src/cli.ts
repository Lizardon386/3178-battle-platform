#!/usr/bin/env node
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildPackage, readPackage, validateManifest } from '@bp/game-package';
import { buildGamePackage } from './build.js';
import { initGame } from './init.js';
import { installPackage, listInstalled, uninstallPackage } from './install.js';
import { signPackage, verifyPackage, type PackageSignature } from './sign.js';

const HELP = `bp-game <命令> [参数]

命令：
  init <目录>       生成最小可运行模板（raw IPC Authority + Web 页）
  build <目录>      构建自包含 .bpkg（esbuild 打包 Authority + 复制 Web/参考资料）
  pack <目录>       把已构建目录直接打成 .bpkg（目录内需有 game.manifest.json）
  inspect <文件>    读取并校验 .bpkg，输出摘要
  install <文件>    校验并安装到 --games-dir；--trusted-key 强制签名
  uninstall <包>    从 --games-dir 删除 id@version 或文件名
  list              列出 --games-dir 中已安装包与签名状态
  doctor <路径>     检查清单、入口与包完整性，不启动游戏
  sign <文件>       用 Ed25519 私钥为整包签名，输出 <文件>.sig
  verify <文件>     校验 .sig；--key 可指定公钥 PEM

通用参数：
  --manifest <文件>   build/pack 的清单路径
  --authority <文件>  build 的 Authority 源码入口
  --web <目录>        build 的 Web 源码目录
  --reference <文件>  build 的参考资料文件
  --stage <目录>      build 的暂存目录（默认 <目录>/dist/bpkg-stage）
  --out <文件>        build/pack/sign 的输出路径
  --key <文件>        sign 的私钥 / verify 的公钥（PEM）
  --sig <文件>        verify 的签名文件（默认 <文件>.sig）
  --json              inspect/doctor 输出 JSON
  --force             init 时覆盖非空目录
`;

interface Parsed {
  positionals: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === 'json' || name === 'help' || name === 'force') {
      flags.set(name, 'true');
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${name} 缺少值`);
    flags.set(name, value);
    index += 1;
  }
  return { positionals, flags };
}

function required(parsed: Parsed, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (!value) throw new Error(`缺少${label}`);
  return value;
}

async function readManifest(dir: string, manifestPath?: string): Promise<unknown> {
  const file = resolve(manifestPath ?? join(dir, 'game.manifest.json'));
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const [command] = parsed.positionals;
  if (!command || parsed.flags.has('help')) {
    console.log(HELP);
    return 0;
  }
  const json = parsed.flags.has('json');

  switch (command) {
    case 'init': {
      const dir = required(parsed, 1, '项目目录');
      const result = await initGame({
        dir,
        ...(parsed.flags.get('id') === undefined ? {} : { id: parsed.flags.get('id')! }),
        ...(parsed.flags.get('name') === undefined ? {} : { name: parsed.flags.get('name')! }),
        ...(parsed.flags.has('force') ? { force: true } : {}),
      });
      console.log(`BP_GAME_DIR=${result.dir}`);
      console.log(`BP_GAME_ID=${result.id}`);
      return 0;
    }
    case 'build': {
      const dir = required(parsed, 1, '游戏目录');
      const result = await buildGamePackage({
        root: dir,
        ...(parsed.flags.get('manifest') === undefined ? {} : { manifestPath: parsed.flags.get('manifest')! }),
        ...(parsed.flags.get('authority') === undefined ? {} : { authoritySource: parsed.flags.get('authority')! }),
        ...(parsed.flags.get('web') === undefined ? {} : { webSource: parsed.flags.get('web')! }),
        ...(parsed.flags.get('reference') === undefined ? {} : { referenceSource: parsed.flags.get('reference')! }),
        ...(parsed.flags.get('stage') === undefined ? {} : { stageDir: parsed.flags.get('stage')! }),
        ...(parsed.flags.get('out') === undefined ? {} : { outFile: parsed.flags.get('out')! }),
      });
      console.log(`BP_PACKAGE=${result.source}`);
      console.log(`BP_PACKAGE_HASH=${result.packageHash}`);
      console.log(`BP_PACKAGE_STAGE=${result.stageDir}`);
      return 0;
    }
    case 'pack': {
      const dir = resolve(required(parsed, 1, '目录'));
      const manifest = validateManifest(await readManifest(dir, parsed.flags.get('manifest')));
      const outFile = resolve(parsed.flags.get('out') ?? join(dirname(dir), `${manifest.id}-${manifest.version}.bpkg`));
      const result = buildPackage({ root: dir, manifest, outFile });
      console.log(`BP_PACKAGE=${result.source}`);
      console.log(`BP_PACKAGE_HASH=${result.packageHash}`);
      return 0;
    }
    case 'inspect': {
      const file = resolve(required(parsed, 1, '包文件'));
      const pack = readPackage(file);
      const summary = {
        id: pack.manifest.id,
        name: pack.manifest.name,
        version: pack.manifest.version,
        packageHash: pack.packageHash,
        entryPoints: pack.manifest.entryPoints,
        reference: pack.manifest.reference,
        files: pack.files.map((entry) => ({ path: entry.path, bytes: entry.bytes.length })),
      };
      print(json ? summary : [
        `${summary.id}@${summary.version}（${summary.name}）`,
        `packageHash: ${summary.packageHash}`,
        `authority: ${summary.entryPoints.authority}`,
        `web: ${summary.entryPoints.web ?? '—'}`,
        `reference: ${summary.reference.entry}`,
        `files: ${summary.files.length}`,
      ].join('\n'), json);
      return 0;
    }
    case 'install': {
      const file = required(parsed, 1, '包文件');
      const gamesDir = parsed.flags.get('games-dir');
      if (!gamesDir) throw new Error('install 需要 --games-dir <目录>');
      const keyFile = parsed.flags.get('trusted-key');
      const trustedKeys = keyFile === undefined ? undefined : [await readFile(resolve(keyFile), 'utf8')];
      const installed = await installPackage({
        file,
        gamesDir,
        ...(trustedKeys === undefined ? {} : { trustedKeys }),
        ...(parsed.flags.has('force') ? { force: true } : {}),
      });
      console.log(`BP_INSTALLED=${installed.file}`);
      console.log(`signed=${installed.signed} valid=${installed.signatureValid}`);
      return 0;
    }
    case 'uninstall': {
      const spec = required(parsed, 1, '包 id@version 或文件名');
      const gamesDir = parsed.flags.get('games-dir');
      if (!gamesDir) throw new Error('uninstall 需要 --games-dir <目录>');
      const removed = await uninstallPackage(gamesDir, spec);
      console.log(`BP_REMOVED=${removed}`);
      return 0;
    }
    case 'list': {
      const gamesDir = parsed.flags.get('games-dir');
      if (!gamesDir) throw new Error('list 需要 --games-dir <目录>');
      const installed = await listInstalled(gamesDir);
      if (json) {
        console.log(JSON.stringify(installed, null, 2));
      } else if (installed.length === 0) {
        console.log('（空）');
      } else {
        for (const entry of installed) {
          console.log(`${entry.id}@${entry.version}  signed=${entry.signed} valid=${entry.signatureValid}${entry.error ? `  error=${entry.error}` : ''}`);
        }
      }
      return 0;
    }
    case 'doctor': {
      const target = resolve(required(parsed, 1, '目录或包文件'));
      const problems: string[] = [];
      const warnings: string[] = [];
      let summary: Record<string, unknown>;
      const info = await lstat(target).catch(() => null);
      if (!info) throw new Error(`路径不存在：${target}`);
      if (info.isFile()) {
        const pack = readPackage(target);
        summary = { target, kind: 'package', id: pack.manifest.id, version: pack.manifest.version, files: pack.files.length };
        for (const [label, path] of Object.entries(pack.manifest.entryPoints)) {
          if (!pack.files.some((entry) => entry.path.toLowerCase() === path.toLowerCase())) {
            problems.push(`${label} 入口不在包内：${path}`);
          }
        }
      } else {
        const manifest = validateManifest(await readManifest(target, parsed.flags.get('manifest')));
        summary = { target, kind: 'source', id: manifest.id, version: manifest.version };
        if (!manifest.entryPoints.web) warnings.push('清单没有声明 Web 入口，浏览器无法打开游戏');
        problems.push(...await checkSources(target));
        warnings.push(...checkManifestWarnings(manifest));
      }
      print(json ? { ...summary, ok: problems.length === 0, problems, warnings } : [
        `${String(summary.id)}@${String(summary.version)}：${problems.length === 0 ? 'OK' : `${problems.length} 个问题`}`,
        ...problems.map((problem) => `  - ${problem}`),
        ...warnings.map((warning) => `  ! ${warning}`),
      ].join('\n'), json);
      return problems.length === 0 ? 0 : 1;
    }
    case 'sign': {
      const file = resolve(required(parsed, 1, '包文件'));
      const keyFile = parsed.flags.get('key');
      if (!keyFile) throw new Error('sign 需要 --key <私钥 PEM>');
      const signature = signPackage(file, await readFile(resolve(keyFile), 'utf8'));
      const outFile = resolve(parsed.flags.get('out') ?? `${file}.sig`);
      await writeFile(outFile, `${JSON.stringify(signature, null, 2)}\n`, 'utf8');
      console.log(`BP_SIGNATURE=${outFile}`);
      return 0;
    }
    case 'verify': {
      const file = resolve(required(parsed, 1, '包文件'));
      const sigFile = resolve(parsed.flags.get('sig') ?? `${file}.sig`);
      const signature = JSON.parse(await readFile(sigFile, 'utf8')) as PackageSignature;
      const keyFile = parsed.flags.get('key');
      const ok = verifyPackage(file, signature, keyFile ? await readFile(resolve(keyFile), 'utf8') : undefined);
      console.log(ok ? 'signature OK' : 'signature INVALID');
      return ok ? 0 : 1;
    }
    default:
      throw new Error(`未知命令：${command}`);
  }
}

async function checkSources(root: string): Promise<string[]> {
  const problems: string[] = [];
  const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
  const authority = [
    join(root, 'src', 'authority', 'process.ts'),
    join(root, 'src', 'authority', 'index.ts'),
    join(root, 'src', 'authority', 'process.js'),
    join(root, 'src', 'authority', 'index.js'),
  ];
  const found = await Promise.all(authority.map(exists));
  if (!found.some(Boolean)) problems.push('找不到 Authority 源码（src/authority/process.ts 或 index.ts）');
  if (!(await exists(join(root, 'src', 'web')))) problems.push('Web 源码目录不存在：src/web');
  if (!(await exists(join(root, 'src', 'reference.json')))) problems.push('参考资料不存在：src/reference.json');
  return problems;
}

function checkManifestWarnings(manifest: ReturnType<typeof validateManifest>): string[] {
  const warnings: string[] = [];
  if (manifest.platformRequirements.minPlayers < 2) warnings.push('minPlayers 小于 2，单人会话可能无法开始');
  if (manifest.requiredCapabilities && manifest.requiredCapabilities.length > 0) {
    warnings.push(`声明了能力 ${manifest.requiredCapabilities.join(', ')}，首版平台可能不提供`);
  }
  return warnings;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`bp-game: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
