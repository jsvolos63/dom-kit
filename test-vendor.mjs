// Tests for bin/vendor.mjs — the kit-side vendoring CLI. Generic on purpose:
// the same test file ships in every @jfs kit and derives its expectations
// from the kit's own index.js, so it keeps passing as the kit's API grows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = dirname(fileURLToPath(import.meta.url));
const BIN = join(KIT_DIR, 'bin', 'vendor.mjs');
const pkg = JSON.parse(readFileSync(join(KIT_DIR, 'package.json'), 'utf8'));
const source = readFileSync(join(KIT_DIR, 'index.js'), 'utf8');

// Mirror of the bin's surface derivation, kept intentionally simple: every
// top-level export declaration name plus aggregate `export { a as b }` aliases.
function exportedNames(esm) {
  const names = [];
  const declRe = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = declRe.exec(esm)) !== null) names.push(m[1]);
  const aggRe = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
  while ((m = aggRe.exec(esm)) !== null) {
    for (const part of m[1].split(',')) {
      const spec = part.trim();
      if (!spec) continue;
      const alias = spec.match(/^([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/);
      if (alias) names.push(alias[2] || alias[1]);
    }
  }
  return names;
}

const NAMES = exportedNames(source);

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function syntaxCheck(file) {
  return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
}

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-test-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the kit has a non-empty derived export surface', () => {
  assert.ok(NAMES.length > 0, 'exportedNames found nothing — derivation regex or kit layout changed');
});

test('esm format: provenance header + verbatim source', () => {
  const dir = freshDir();
  const r = run(['--format', 'esm', '--out', 'out.js'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = readFileSync(join(dir, 'out.js'), 'utf8');
  assert.ok(out.startsWith(`// VENDORED from ${pkg.name}`));
  assert.ok(out.includes('DO NOT EDIT'));
  assert.ok(out.endsWith(source), 'esm output must end with the unmodified source');
});

test('global format: parseable classic script exposing every export on the named global', () => {
  const dir = freshDir();
  const r = run(['--format', 'global', '--name', 'TestKitGlobal', '--out', 'out.global.js'], dir);
  assert.equal(r.status, 0, r.stderr);
  const file = join(dir, 'out.global.js');
  const out = readFileSync(file, 'utf8');
  assert.equal(syntaxCheck(file).status, 0, 'global output must parse as a classic script');
  assert.ok(out.includes('globalThis.TestKitGlobal = {'));
  assert.ok(!/^export\s/m.test(out), 'no export keywords may survive');
  for (const name of NAMES) {
    assert.ok(new RegExp(`^  ${name.replace(/\$/g, '\\$')}:`, 'm').test(out), `surface map must expose ${name}`);
  }
});

test('global format: --name is required and validated', () => {
  const dir = freshDir();
  assert.notEqual(run(['--format', 'global', '--out', 'x.js'], dir).status, 0);
  assert.notEqual(run(['--format', 'global', '--name', 'not a name', '--out', 'x.js'], dir).status, 0);
});

test('global format: --pick narrows the surface and rejects unknown names', () => {
  const dir = freshDir();
  const pickTwo = NAMES.slice(0, 2);
  const r = run(['--format', 'global', '--name', 'G', '--pick', pickTwo.join(','), '--out', 'picked.js'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = readFileSync(join(dir, 'picked.js'), 'utf8');
  const mapped = [...out.matchAll(/^  ([A-Za-z0-9_$]+):/gm)].map((m) => m[1]);
  assert.deepEqual(mapped.sort(), [...pickTwo].sort());

  const bad = run(['--format', 'global', '--name', 'G', '--pick', 'definitelyNotAnExport', '--out', 'x.js'], dir);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /definitelyNotAnExport/);
});

test('bare format: parseable, export-free, no global assignment', () => {
  const dir = freshDir();
  const r = run(['--format', 'bare', '--out', 'out.bare.js'], dir);
  assert.equal(r.status, 0, r.stderr);
  const file = join(dir, 'out.bare.js');
  const out = readFileSync(file, 'utf8');
  assert.equal(syntaxCheck(file).status, 0, 'bare output must parse as a classic script');
  assert.ok(!/^export\s/m.test(out), 'no export keywords may survive');
  assert.ok(!out.includes('globalThis.'), 'bare output must not assign a global');
  assert.ok(!out.includes('module.exports'));
});

test('cjs format: parseable and exports the full derived surface', () => {
  const dir = freshDir();
  const r = run(['--format', 'cjs', '--out', 'out.cjs'], dir);
  assert.equal(r.status, 0, r.stderr);
  const file = join(dir, 'out.cjs');
  const out = readFileSync(file, 'utf8');
  assert.equal(syntaxCheck(file).status, 0, 'cjs output must parse');
  assert.ok(out.includes('module.exports = {'));
  for (const name of NAMES) {
    assert.ok(new RegExp(`^  ${name.replace(/\$/g, '\\$')}:`, 'm').test(out), `module.exports must include ${name}`);
  }
});

test('--check: passes in sync, fails on drift, fails when missing', () => {
  const dir = freshDir();
  const args = ['--format', 'global', '--name', 'G', '--out', 'v.js'];
  assert.notEqual(run([...args, '--check'], dir).status, 0, 'missing dest must fail');

  assert.equal(run(args, dir).status, 0);
  assert.equal(run([...args, '--check'], dir).status, 0, 'freshly generated copy must be in sync');

  writeFileSync(join(dir, 'v.js'), readFileSync(join(dir, 'v.js'), 'utf8') + '\n// tampered\n');
  const drift = run([...args, '--check'], dir);
  assert.notEqual(drift.status, 0, 'tampered copy must fail the check');
  assert.match(drift.stderr, /out of sync/);
});

test('argument validation: bad format, missing --out, --pick outside global', () => {
  const dir = freshDir();
  assert.notEqual(run(['--format', 'nope', '--out', 'x.js'], dir).status, 0);
  assert.notEqual(run(['--format', 'esm'], dir).status, 0);
  assert.notEqual(run(['--format', 'esm', '--out', 'x.js', '--pick', 'a'], dir).status, 0);
});
