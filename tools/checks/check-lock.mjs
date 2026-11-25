#!/usr/bin/env node
/**
 * 防止 npm ci 因 lock 缺少新 workspace 而失败：
 * 每个 workspace 包都必须在 package-lock.json 里有同 name/version 的条目。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const locked = lock.packages ?? {};

const workspaceDirs = [];
for (const pattern of rootPackage.workspaces ?? []) {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const project = join(dir, name);
      if (!statSync(project).isDirectory()) continue;
      if (existsSync(join(project, 'package.json'))) workspaceDirs.push(`${base}/${name}`);
    }
  } else if (existsSync(join(ROOT, pattern, 'package.json'))) {
    workspaceDirs.push(pattern);
  }
}

const problems = [];
for (const dir of workspaceDirs) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  const entry = locked[dir];
  if (!entry) {
    problems.push(`${dir}: lock 缺少条目`);
    continue;
  }
  if (entry.name !== pkg.name || entry.version !== pkg.version) {
    problems.push(`${dir}: lock 为 ${entry.name}@${entry.version}，package.json 为 ${pkg.name}@${pkg.version}`);
  }
}

if (problems.length > 0) {
  console.error('package-lock.json 与 workspace 不一致（先跑 npm install 并提交 lock）：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`lock OK: ${workspaceDirs.length} 个 workspace 与 package-lock 一致`);
