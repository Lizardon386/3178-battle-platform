#!/usr/bin/env node
/**
 * 防止“测试包含但构建不包含”：根 tsconfig 的 references 必须覆盖
 * packages/*、examples/*、tools/* 下所有带 tsconfig 的工程。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootConfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
const references = new Set((rootConfig.references ?? []).map((entry) => entry.path.replace(/\\/g, '/')));

const candidates = [];
for (const base of ['packages', 'examples', 'tools']) {
  const dir = join(ROOT, base);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const project = join(dir, name);
    if (!statSync(project).isDirectory()) continue;
    if (!existsSync(join(project, 'tsconfig.json'))) continue;
    candidates.push(`${base}/${name}`);
  }
}

const missing = candidates.filter((project) => !references.has(project));
const dangling = [...references].filter((project) => !existsSync(join(ROOT, project, 'tsconfig.json')));

if (missing.length > 0 || dangling.length > 0) {
  if (missing.length > 0) {
    console.error('根 tsconfig 缺少 references：');
    for (const project of missing) console.error(`  - ${project}`);
  }
  if (dangling.length > 0) {
    console.error('根 tsconfig 指向不存在的工程：');
    for (const project of dangling) console.error(`  - ${project}`);
  }
  process.exit(1);
}
console.log(`build references OK: ${candidates.length} 个工程均被根 tsconfig 引用`);
