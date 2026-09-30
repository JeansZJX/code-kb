import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/install.mjs');
function fixture(t) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-kb-install-'));
  const packageRoot = path.join(temporaryRoot, 'distribution');
  const projectRoot = path.join(temporaryRoot, '成员 工作副本');
  fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, 'skills/code-kb/scripts'), { recursive: true });
  fs.mkdirSync(projectRoot);
  fs.copyFileSync(installer, path.join(packageRoot, 'scripts/install.mjs'));
  fs.writeFileSync(path.join(packageRoot, 'skills/code-kb/SKILL.md'), '---\nname: code-kb\ndescription: fixture\n---\n');
  fs.writeFileSync(path.join(packageRoot, 'skills/code-kb/scripts/kb.mjs'), '// version 1\n');
  t.after(() => {
    const target = fs.realpathSync(temporaryRoot);
    assert.equal(target, path.resolve(temporaryRoot));
    assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir()));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync(process.execPath, [path.join(packageRoot, 'scripts/install.mjs'), '--project-root', projectRoot, ...args], { encoding: 'utf8', cwd: temporaryRoot });
  return { temporaryRoot, packageRoot, projectRoot, run, destination: path.join(projectRoot, '.agents/skills/code-kb') };
}

test('installer uses the selected working copy and preserves project knowledge', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.projectRoot, 'code-kb.project.json'), '{"knowledge_base":"Engineering/Knowledge"}');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(f.destination, 'SKILL.md')));
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'code-kb.project.json'), 'utf8'), '{"knowledge_base":"Engineering/Knowledge"}');
  assert.equal(fs.existsSync(path.join(f.projectRoot, '.code-kb')), false);
  fs.writeFileSync(path.join(f.destination, 'SKILL.md'), 'member customization');
  const repeated = f.run();
  assert.equal(repeated.status, 1);
  assert.equal(fs.readFileSync(path.join(f.destination, 'SKILL.md'), 'utf8'), 'member customization');
});

test('explicit replacement updates packaged files and retains unrelated files', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  fs.writeFileSync(path.join(f.destination, 'notes.txt'), 'keep');
  fs.writeFileSync(path.join(f.packageRoot, 'skills/code-kb/scripts/kb.mjs'), '// version 2\n');
  const result = f.run('--replace');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.destination, 'scripts/kb.mjs'), 'utf8'), '// version 2\n');
  assert.equal(fs.readFileSync(path.join(f.destination, 'notes.txt'), 'utf8'), 'keep');
});

test('installer preflights file conflicts before overwriting anything', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.destination, 'scripts/kb.mjs'), { recursive: true });
  fs.writeFileSync(path.join(f.destination, 'SKILL.md'), 'existing');
  const result = f.run('--replace');
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(path.join(f.destination, 'SKILL.md'), 'utf8'), 'existing');
});

test('installer refuses a linked destination outside the selected project', t => {
  const f = fixture(t);
  const outside = path.join(f.temporaryRoot, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.projectRoot, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run('--replace');
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('installer excludes downloaded dependency and Git directories', t => {
  const f = fixture(t);
  for (const directory of ['node_modules', '.git']) {
    fs.mkdirSync(path.join(f.packageRoot, 'skills/code-kb', directory));
    fs.writeFileSync(path.join(f.packageRoot, 'skills/code-kb', directory, 'fixture.txt'), 'fixture dependency');
  }
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.destination, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(f.destination, '.git')), false);
});
