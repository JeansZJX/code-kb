import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init, loadKnowledge, inventory, verify, status, inspectSvn, run, parseArgs } from '../skills/code-kb/scripts/kb.mjs';

const runtime = fileURLToPath(new URL('../skills/code-kb/scripts/kb.mjs', import.meta.url));
const fixtures = [];
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
}
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'code-kb-test-'));
  fixtures.push(base);
  const root = path.join(base, 'TeamProject');
  fs.mkdirSync(root);
  init({ projectRoot: root, projectId: 'team-example', preset: 'unity-svn' });
  const kb = path.join(root, '.code-kb');
  const manifest = read(path.join(kb, 'manifest.json'));
  manifest.modules.client.sources['client-main'].code_status = 'available';
  manifest.modules.client.sources['client-feature-example'].code_status = 'available';
  manifest.modules.server.sources['server-main'].code_status = 'planned';
  write(path.join(kb, 'manifest.json'), manifest);
  write(path.join(root, 'apps/unity/trunk/Assets/Scripts/Example.cs'), 'public class Example { }\n');
  write(path.join(root, 'apps/unity/branches/example-feature/Assets/Scripts/Example.cs'), 'public class FutureExample { }\n');
  return { base, root, kb, manifest, context: () => loadKnowledge({ kb }, { svnRunner: () => null }) };
}
function addRecord(fix, sourceId = 'client-main', definition = {}) {
  const source = fix.manifest.modules.client.sources[sourceId];
  const sourcePath = path.join(fix.root, source.project_relative_root, 'Assets/Scripts/Example.cs');
  const body = fs.readFileSync(sourcePath, 'utf8');
  const recordPath = `code/client/${sourceId}/entries.json`;
  const record = { schema_version: 2, project_id: 'team-example', module: 'client', source_id: sourceId, symbols: [{
    id: 'Example', status: 'verified', definition: { path: 'Assets/Scripts/Example.cs', line: 1, evidence: sourceId === 'client-main' ? 'public class Example' : 'public class FutureExample', file_sha256: sha(body), ...definition }, references: []
  }] };
  write(path.join(fix.kb, recordPath), record);
  const index = read(path.join(fix.kb, 'code/index.json'));
  index.modules.client.sources[sourceId].records = [recordPath];
  write(path.join(fix.kb, 'code/index.json'), index);
  return { record, recordPath, sourcePath };
}

test.after(() => {
  for (const directory of fixtures) fs.rmSync(directory, { recursive: true, force: true });
});

test('init preflights collisions and preserves existing content', () => {
  const fix = fixture();
  const original = fs.readFileSync(path.join(fix.kb, 'manifest.json'), 'utf8');
  assert.throws(() => init({ projectRoot: fix.root }), /already exists/);
  assert.equal(fs.readFileSync(path.join(fix.kb, 'manifest.json'), 'utf8'), original);
  const other = path.join(fix.base, 'Other');
  fs.mkdirSync(other);
  write(path.join(other, 'code-kb.project.json'), 'do not overwrite');
  assert.throws(() => init({ projectRoot: other }), /already exists/);
  assert.equal(fs.existsSync(path.join(other, '.code-kb')), false);
});

test('init creates proposed placeholders and all sources remain planned', () => {
  const fix = fixture();
  const root = path.join(fix.base, 'Generic');
  fs.mkdirSync(root);
  const result = init({ projectRoot: root, projectId: 'generic-example' });
  assert.equal(result.preset, 'generic');
  const manifest = read(path.join(root, '.code-kb/manifest.json'));
  assert.equal(manifest.modules.app.sources.main.code_status, 'planned');
  assert.deepEqual(read(path.join(root, '.code-kb/catalog/index.json')).capabilities, []);
  assert.match(fs.readFileSync(path.join(root, '.code-kb/rules/shared.md'), 'utf8'), /proposed/);
});

test('init supports a non-ASCII local directory without embedding it in the shared ID', () => {
  const fix = fixture();
  const root = path.join(fix.base, '团队工作目录');
  fs.mkdirSync(root);
  assert.equal(init({ projectRoot: root }).project_id, 'project');
  assert.equal(read(path.join(root, '.code-kb/manifest.json')).project_id, 'project');
});

test('discovery from nested working folder and explicit KB from unrelated cwd', () => {
  const fix = fixture();
  const nested = path.join(fix.root, 'apps/unity/trunk/Assets/Scripts');
  assert.equal(loadKnowledge({ cwd: nested }, { svnRunner: () => null }).projectRoot, fix.root);
  const result = spawnSync(process.execPath, [runtime, 'status', '--kb', fix.kb], { cwd: fix.base, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).project_id, 'team-example');
  assert.equal(result.stdout.includes(fix.root), false);
});

test('relocation preserves project-relative data and verified record locations', () => {
  const fix = fixture();
  addRecord(fix);
  const moved = path.join(fix.base, 'Moved');
  fs.cpSync(fix.root, moved, { recursive: true });
  const context = loadKnowledge({ kb: path.join(moved, '.code-kb'), cwd: os.tmpdir() }, { svnRunner: () => null });
  assert.equal(verify(context).exit_code, 0);
  assert.equal(inventory(context, 'client').file_count, 1);
});

test('inventory isolates branches and deterministic writes preserve unchanged file', () => {
  const fix = fixture();
  const context = fix.context();
  const first = inventory(context, 'client');
  assert.equal(first.output, 'code/client/client-main/file-inventory.json');
  assert.equal(first.changed, true);
  assert.equal(inventory(context, 'client').changed, false);
  const branch = inventory(context, 'client', 'client-feature-example');
  assert.equal(branch.output, 'code/client/client-feature-example/file-inventory.json');
  const demo = read(path.join(fix.kb, first.output));
  const trunk = read(path.join(fix.kb, branch.output));
  assert.notEqual(demo.files[0].sha256, trunk.files[0].sha256);
  assert.equal(JSON.stringify(demo).includes(fix.root), false);
  assert.equal(demo.svn.status, 'unknown');
});

test('inventory rejects rebinding an existing source ID to another branch', () => {
  const fix = fixture();
  inventory(fix.context(), 'client');
  fix.manifest.modules.client.sources['client-main'].project_relative_root = 'apps/unity/branches/example-feature';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(() => inventory(fix.context(), 'client'), /identity differs/);
});

test('configured language extensions and generated exclusions apply', () => {
  const fix = fixture();
  fix.manifest.modules.client.extensions = ['.go', '.proto'];
  fix.manifest.modules.client.exclude_dirs = ['Generated', 'Assets/Scripts/vendor'];
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  for (const name of ['normal.go', 'UPPER.GO', 'message.proto', 'Generated/skip.go', 'vendor/skip.go', 'Library/skip.go', '.svn/skip.go']) write(path.join(fix.root, 'apps/unity/trunk/Assets/Scripts', name), 'example\n');
  const result = inventory(fix.context(), 'client');
  assert.equal(result.file_count, 3);
  assert.deepEqual(read(path.join(fix.kb, result.output)).files.map(item => item.path), ['Assets/Scripts/UPPER.GO', 'Assets/Scripts/message.proto', 'Assets/Scripts/normal.go']);
});

test('verify distinguishes checked, stale changed, deleted and zero coverage', () => {
  const fix = fixture();
  assert.equal(verify(fix.context()).exit_code, 2);
  const { sourcePath } = addRecord(fix);
  assert.equal(verify(fix.context()).checked_locations, 1);
  write(sourcePath, 'public class Changed { }\n');
  assert.match(verify(fix.context()).failures[0], /Stale source/);
  fs.unlinkSync(sourcePath);
  const result = verify(fix.context());
  assert.equal(result.exit_code, 1);
  assert.match(result.failures[0], /does not exist/);
});

test('candidate references are not counted while confirmed references require evidence', () => {
  const fix = fixture();
  const entry = addRecord(fix);
  entry.record.symbols[0].references = [{ status: 'candidate', path: '../not-read.cs' }];
  write(path.join(fix.kb, entry.recordPath), entry.record);
  assert.equal(verify(fix.context()).checked_locations, 1);
  entry.record.symbols[0].references.push({ ...entry.record.symbols[0].definition, status: 'confirmed', evidence: 'does-not-match' });
  write(path.join(fix.kb, entry.recordPath), entry.record);
  assert.match(verify(fix.context()).failures[0], /evidence differs/);
});

test('verified locations require exact source line and valid hash', () => {
  const fix = fixture();
  addRecord(fix, 'client-main', { line: 100 });
  assert.match(verify(fix.context()).failures[0], /Invalid source line/);
  addRecord(fix, 'client-main', { file_sha256: 'invalid' });
  assert.match(verify(fix.context()).failures[0], /Stale source/);
});

test('verification scope does not fail unrelated unavailable or broken sources', () => {
  const fix = fixture();
  addRecord(fix);
  const index = read(path.join(fix.kb, 'code/index.json'));
  index.modules.server.sources['server-main'].records = ['code/server/server-main/missing.json'];
  write(path.join(fix.kb, 'code/index.json'), index);
  assert.equal(verify(fix.context(), { module: 'client', source: 'client-main' }).exit_code, 0);
  assert.equal(verify(fix.context()).exit_code, 1);
  assert.throws(() => verify(fix.context(), { module: 'absent' }), /Unknown module/);
});

test('manifest and record traversal paths are refused', () => {
  const fix = fixture();
  const record = addRecord(fix, 'client-main', { path: '../outside.cs' });
  assert.match(verify(fix.context()).failures[0], /parent traversal/);
  fix.manifest.modules.client.sources['client-main'].project_relative_root = '../outside';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(fix.context, /parent traversal/);
  assert.equal(record.record.symbols[0].status, 'verified');
});

test('absolute source paths, backslash paths and invalid schemas are refused', () => {
  const fix = fixture();
  fix.manifest.modules.client.sources['client-main'].project_relative_root = 'C:/private/example';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(fix.context, /portable relative path/);
  fix.manifest.modules.client.sources['client-main'].project_relative_root = 'apps\\unity\\trunk';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(fix.context, /portable relative path/);
  fix.manifest.schema_version = 99;
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(fix.context, /manifest schema/);
});

test('symbol and record identity conflicts are refused', () => {
  const fix = fixture();
  const entry = addRecord(fix);
  entry.record.symbols.push(entry.record.symbols[0]);
  write(path.join(fix.kb, entry.recordPath), entry.record);
  assert.match(verify(fix.context()).failures[0], /duplicated/);
  entry.record.symbols.pop();
  entry.record.source_id = 'client-feature-example';
  write(path.join(fix.kb, entry.recordPath), entry.record);
  assert.match(verify(fix.context()).failures[0], /identity differs/);
});

test('symbolic links cannot escape inventory or record roots', t => {
  const fix = fixture();
  const outside = path.join(fix.base, 'Outside');
  write(path.join(outside, 'Linked.cs'), 'public class Linked {}\n');
  const link = path.join(fix.root, 'apps/unity/trunk/Assets/Scripts/Linked');
  try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink creation unavailable in this environment.'); return; } throw error; }
  assert.equal(inventory(fix.context(), 'client').file_count, 1);
  addRecord(fix, 'client-main', { path: 'Assets/Scripts/Linked/Linked.cs' });
  assert.match(verify(fix.context()).failures[0], /symbolic link/);
  fix.manifest.modules.client.inventory_roots = ['Assets/Scripts/Linked'];
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(() => inventory(fix.context(), 'client'), /symbolic link/);
});

test('SVN adapter uses read-only commands and explicitly labels directory revision', () => {
  const calls = [];
  const runner = args => {
    calls.push(args);
    if (args[0] === 'info') return '<info><entry revision="42"><repository><uuid>uuid-example</uuid></repository><relative-url>^/apps/unity/trunk</relative-url></entry></info>';
    return '<status><target><entry><wc-status item="modified" props="none"/></entry></target></status>';
  };
  const result = inspectSvn('example-root', runner);
  assert.equal(result.dirty, true);
  assert.equal(result.root_directory_base_revision, 42);
  assert.equal(result.file_revisions, 'not-inspected');
  assert.deepEqual(calls.map(args => args.slice(0, 4)), [['info', '--xml', '--non-interactive', '--'], ['status', '--xml', '--non-interactive', '--']]);
  assert.equal(inspectSvn('example-root', () => null).dirty, null);
});

test('external roots require matching SVN binding and cannot use unavailable metadata', () => {
  const fix = fixture();
  const external = path.join(fix.base, 'Checkout');
  write(path.join(external, 'Assets/Scripts/Example.cs'), 'public class Example {}\n');
  write(path.join(fix.kb, 'workspace.local.json'), { roots: { 'client-main': external } });
  assert.throws(() => inventory(fix.context(), 'client'), /explicit SVN source binding/);
  fix.manifest.modules.client.sources['client-main'].svn = { repository_uuid: 'uuid-example', repository_relative_path: '^/apps/unity/trunk' };
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(() => inventory(fix.context(), 'client'), /metadata is unavailable/);
  const runner = args => args[0] === 'info' ? '<info><entry revision="2"><uuid>uuid-example</uuid><relative-url>^/apps/unity/trunk</relative-url></entry></info>' : '<status/>';
  const context = loadKnowledge({ kb: fix.kb }, { svnRunner: runner });
  assert.equal(inventory(context, 'client').file_count, 1);
  const shared = fs.readFileSync(path.join(fix.kb, 'code/client/client-main/file-inventory.json'), 'utf8');
  assert.equal(shared.includes(external), false);
  const wrong = loadKnowledge({ kb: fix.kb }, { svnRunner: args => args[0] === 'info' ? '<info><uuid>wrong</uuid><relative-url>^/apps/unity/trunk</relative-url></info>' : '<status/>' });
  assert.throws(() => inventory(wrong, 'client'), /identity differs/);
});

test('status reports planned and missing sources without inventing availability', () => {
  const fix = fixture();
  const result = status(fix.context());
  assert.equal(result.sources.find(item => item.source_id === 'server-main').available, false);
  fs.rmSync(path.join(fix.root, 'apps/unity/branches/example-feature'), { recursive: true });
  const missing = status(fix.context()).sources.find(item => item.source_id === 'client-feature-example');
  assert.equal(missing.available, false);
  assert.match(missing.reason, /does not exist/);
  assert.throws(() => inventory(fix.context(), 'server'), /planned/);
});

test('legacy manifest and records verify without migration', () => {
  const fix = fixture();
  const kb = path.join(fix.root, 'Docs/Knowledge');
  write(path.join(kb, 'manifest.json'), { schema_version: 1, project: 'TeamExample', local_mapping: 'workspace.local.json', code_index: 'code/index.json', modules: { client: { project_relative_root: 'apps/unity/trunk', code_status: 'available', inventory_roots: ['Assets/Scripts'] } }, ignored_project_paths: [] });
  write(path.join(kb, 'code/index.json'), { schema_version: 1, modules: { client: { records: ['code/client/entries.json'] } } });
  write(path.join(kb, 'code/client/entries.json'), { schema_version: 1, module: 'client', source_identity: 'apps/unity/trunk', symbols: [{ id: 'Example', status: 'verified', definition: { path: 'Assets/Scripts/Example.cs', line: 1, evidence: 'public class Example', file_sha256: sha('public class Example { }\n') } }] });
  const context = loadKnowledge({ kb }, { svnRunner: () => null });
  assert.equal(verify(context).exit_code, 0);
  const result = inventory(context, 'client');
  assert.equal(result.output, 'code/client/file-inventory.json');
  assert.equal(read(path.join(kb, result.output)).schema_version, 1);
  assert.equal(read(path.join(kb, 'manifest.json')).schema_version, 1);
});

test('CLI validates conflicting flags and preserves no-symbol exit2', () => {
  const fix = fixture();
  assert.throws(() => parseArgs(['inventory']), /requires --module/);
  assert.throws(() => parseArgs(['status', '--source', 'client-main']), /requires --module/);
  assert.throws(() => parseArgs(['verify', '--preset', 'generic']), /init-only/);
  assert.throws(() => parseArgs(['init', '--kb', 'example']), /accepts/);
  const result = run(['verify', '--kb', fix.kb], { svnRunner: () => null });
  assert.equal(result.exitCode, 2);
  const cli = spawnSync(process.execPath, [runtime, 'verify', '--kb', fix.kb], { encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stderr);
});
