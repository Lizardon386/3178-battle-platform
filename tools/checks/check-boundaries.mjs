#!/usr/bin/env node
/**
 * 依赖方向闸门：只检查新架构的包，旧包由 check-seam 管。
 * 规则来自 plan/bright-swinging-wren.md §3：core 无 I/O、app 不依赖适配器、
 * UI 不依赖服务内部、任何新包不 import 旧 ABI。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PACKAGES = join(ROOT, 'packages');

const LEGACY = new Set(['core-abi', 'protocol', 'server', 'hostd', 'client']);
const NEW = [
  'protocol-contract',
  'session-core',
  'session-app',
  'session-store',
  'session-ws',
  'session-service',
  'authority-runtime',
  'tunnel-manager',
  'game-package',
  'game-sdk',
  'game-kit',
  'bp-game',
  'web-console',
];

const FORBIDDEN_IMPORTS = {
  'session-core': [/^node:/, /^@bp\/session-(app|store|ws|service)$/, /^@bp\/(web-console|authority-runtime)$/],
  'protocol-contract': [/^@bp\//, /^node:(?!crypto$)/],
  'session-app': [/^@bp\/(session-store|session-ws|session-service)$/, /^@bp\/(web-console|authority-runtime)$/],
  'session-store': [/^@bp\/(session-ws|session-service|web-console)$/],
  'session-ws': [/^@bp\/(session-service|web-console)$/],
  'authority-runtime': [/^@bp\/(session-|web-console)/],
  'game-sdk': [/^@bp\/(session-|authority-runtime|web-console)/],
  'game-kit': [/^@bp\/(session-|authority-runtime|web-console)/],
  'web-console': [/^@bp\/(session-app|session-core|session-store|session-ws|session-service|authority-runtime)/],
  'bp-game': [/^@bp\/(session-|authority-runtime)/],
  'game-package': [/^@bp\/(session-|authority-runtime|web-console)/],
};

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) out.push(...walk(file));
    else if (/\.(ts|mts|cts)$/.test(name)) out.push(file);
  }
  return out;
}

function packageOf(spec) {
  if (spec.startsWith('@bp/')) return spec.split('/')[1] ?? null;
  if (spec.startsWith('@lizardon386/')) return spec.split('/')[1] ?? null;
  return null;
}

const violations = [];
const graph = new Map();

for (const name of NEW) {
  const dir = join(PACKAGES, name, 'src');
  const edges = new Set();
  graph.set(name, edges);
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const target = packageOf(spec);
      if (target && !NEW.includes(target)) {
        violations.push(`${relative(ROOT, file)}: 新包引用了非新架构包 ${spec}`);
      }
      if (target && target !== name) edges.add(target);
      for (const pattern of FORBIDDEN_IMPORTS[name] ?? []) {
        if (pattern.test(spec)) {
          violations.push(`${relative(ROOT, file)}: ${name} 禁止 import ${spec}`);
        }
      }
    }
  }
}

// 循环依赖检测
const state = new Map();
const stack = [];
function visit(node) {
  if (state.get(node) === 'done') return;
  if (state.get(node) === 'visiting') {
    const cycle = [...stack.slice(stack.indexOf(node)), node].join(' -> ');
    violations.push(`循环依赖: ${cycle}`);
    return;
  }
  state.set(node, 'visiting');
  stack.push(node);
  for (const next of graph.get(node) ?? []) visit(next);
  stack.pop();
  state.set(node, 'done');
}
for (const node of graph.keys()) visit(node);

if (violations.length > 0) {
  console.error('依赖边界违规：');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`boundaries OK: ${NEW.length} 个新包，无越界 import、无循环依赖`);
