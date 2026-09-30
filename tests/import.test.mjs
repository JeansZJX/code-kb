import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init, loadKnowledge, verify } from '../skills/code-kb/scripts/kb.mjs';
import { importSource } from '../skills/code-kb/scripts/import-code.mjs';

const fixtures = [];
const scriptDirectory = fileURLToPath(new URL('../skills/code-kb/scripts/', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};
const csSource = `using System;
namespace Team.Tools;
public class Example
{
  // public void Commented() {}
  private string note = "public void Quoted() {}";
  public Example() {}
  public int Add(int first, int second) { return first + second; }
  public int Add(int first) => first;
  public int Size { get; set; }
  public void Run() { Add(1); }
}
`;
function fixture(extensions = ['.cs', '.asmdef']) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'code-kb-import-'));
  fixtures.push(base);
  const root = path.join(base, 'TeamProject');
  fs.mkdirSync(root);
  init({ projectRoot: root, projectId: 'team-example', preset: 'unity-svn' });
  const kb = path.join(root, '.code-kb');
  const manifest = read(path.join(kb, 'manifest.json'));
  manifest.modules.client.extensions = extensions;
  manifest.modules.client.sources['client-main'].code_status = 'available';
  manifest.modules.client.sources['client-feature-example'].code_status = 'available';
  write(path.join(kb, 'manifest.json'), manifest);
  const sourceRoot = path.join(root, 'apps/unity/trunk/Assets/Scripts');
  write(path.join(sourceRoot, 'Example.cs'), csSource);
  write(path.join(root, 'apps/unity/branches/example-feature/Assets/Scripts/Future.cs'), 'public class Future {}\n');
  return { root, kb, base, sourceRoot, manifest, recordPath: path.join(kb, 'code/client/client-main/imported/Assets/Scripts/Example.cs.json'), context: () => loadKnowledge({ kb }, { svnRunner: () => null }) };
}
test.after(() => { for (const root of fixtures) fs.rmSync(root, { recursive: true, force: true }); });

test('C# AST imports real classes, constructor, overloaded methods, property and field as candidates', async () => {
  const fix = fixture();
  const report = await importSource(fix.context(), 'client');
  assert.equal(report.parsed_files, 1);
  assert.equal(report.parse_error_files.length, 0);
  const record = read(fix.recordPath);
  assert.equal(record.managed_by, 'code-kb-import');
  assert.equal(record.source_id, 'client-main');
  assert.equal(record.symbols.some(symbol => ['Commented', 'Quoted'].includes(symbol.name)), false);
  assert.equal(record.symbols.find(symbol => symbol.kind === 'constructor').name, 'Example');
  assert.equal(record.symbols.find(symbol => symbol.kind === 'property').name, 'Size');
  assert.equal(record.symbols.find(symbol => symbol.kind === 'field').name, 'note');
  const methods = record.symbols.filter(symbol => symbol.name === 'Add');
  assert.equal(methods.length, 2);
  assert.notEqual(methods[0].id, methods[1].id);
  assert.equal(methods[0].signature, 'public int Add(int first, int second)');
  assert.equal(methods[1].signature, 'public int Add(int first)');
  assert.equal(methods[0].qualified_name, 'Team.Tools.Example.Add');
  assert.equal(record.imports[0].text, 'using System;');
  assert.equal(record.symbols.every(symbol => symbol.status === 'candidate' && symbol.definition.file_sha256.length === 64), true);
  assert.equal(methods[0].references.every(reference => reference.status === 'candidate'), true);
  assert.equal(methods[0].references.length, 1);
  assert.equal(verify(fix.context()).exit_code, 2);
  assert.equal(JSON.stringify(record).includes(fix.root), false);
  assert.equal(JSON.stringify(report).includes(fix.root), false);
});

test('repeat import is deterministic and registers records once', async () => {
  const fix = fixture();
  const first = await importSource(fix.context(), 'client');
  const content = fs.readFileSync(fix.recordPath, 'utf8');
  const second = await importSource(fix.context(), 'client');
  assert.equal(first.changed_records, 1);
  assert.equal(second.changed_records, 0);
  assert.equal(second.unchanged_records, 1);
  assert.equal(second.index_changed, false);
  assert.equal(fs.readFileSync(fix.recordPath, 'utf8'), content);
  const index = read(path.join(fix.kb, 'code/index.json'));
  assert.deepEqual(index.modules.client.sources['client-main'].records, ['code/client/client-main/imported/Assets/Scripts/Example.cs.json']);
});

test('candidate facts refresh after source change while stable IDs survive line shifts', async () => {
  const fix = fixture();
  await importSource(fix.context(), 'client');
  const original = read(fix.recordPath);
  write(path.join(fix.sourceRoot, 'Example.cs'), '\n' + csSource.replace('first + second', 'first * second'));
  const report = await importSource(fix.context(), 'client');
  const current = read(fix.recordPath);
  assert.equal(report.changed_records, 1);
  assert.equal(original.symbols.find(symbol => symbol.kind === 'class').id, current.symbols.find(symbol => symbol.kind === 'class').id);
  assert.equal(current.symbols.find(symbol => symbol.kind === 'class').definition.line, original.symbols.find(symbol => symbol.kind === 'class').definition.line + 1);
  assert.notEqual(current.file_sha256, original.file_sha256);
});

test('promoted or curated records and unrelated curated index entries are preserved', async () => {
  const fix = fixture();
  await importSource(fix.context(), 'client');
  const record = read(fix.recordPath);
  record.symbols[0].status = 'verified';
  record.symbols[0].human_note = 'Keep this decision';
  write(fix.recordPath, record);
  const original = fs.readFileSync(fix.recordPath, 'utf8');
  const curatedName = 'code/client/client-main/curated.json';
  const curated = { schema_version: 2, project_id: 'team-example', module: 'client', source_id: 'client-main', symbols: [] };
  write(path.join(fix.kb, curatedName), curated);
  const index = read(path.join(fix.kb, 'code/index.json'));
  index.modules.client.sources['client-main'].records.unshift(curatedName);
  write(path.join(fix.kb, 'code/index.json'), index);
  write(path.join(fix.sourceRoot, 'Example.cs'), csSource + '\npublic class NewType {}\n');
  const report = await importSource(fix.context(), 'client');
  assert.equal(report.preserved_records.length, 1);
  assert.equal(fs.readFileSync(fix.recordPath, 'utf8'), original);
  assert.deepEqual(read(path.join(fix.kb, curatedName)), curated);
  assert.equal(read(path.join(fix.kb, 'code/index.json')).modules.client.sources['client-main'].records[0], curatedName);
  assert.match(report.warnings[0], /Preserved/);
});

test('top-level deleted records with no symbols are preserved and orphaned files regain index registration', async () => {
  const fix = fixture();
  await importSource(fix.context(), 'client');
  const record = read(fix.recordPath);
  record.status = 'deleted';
  record.symbols = [];
  write(fix.recordPath, record);
  const original = fs.readFileSync(fix.recordPath, 'utf8');
  const index = read(path.join(fix.kb, 'code/index.json'));
  index.modules.client.sources['client-main'].records = [];
  write(path.join(fix.kb, 'code/index.json'), index);
  const result = await importSource(fix.context(), 'client');
  assert.equal(result.preserved_records.length, 1);
  assert.equal(fs.readFileSync(fix.recordPath, 'utf8'), original);
  assert.deepEqual(read(path.join(fix.kb, 'code/index.json')).modules.client.sources['client-main'].records, ['code/client/client-main/imported/Assets/Scripts/Example.cs.json']);
});

test('CLI import succeeds without circular module evaluation', () => {
  const fix = fixture();
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, 'kb.mjs'), 'import', '--kb', fix.kb, '--module', 'client'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).parsed_files, 1);
  assert.equal(read(fix.recordPath).managed_by, 'code-kb-import');
});

test('deleting the final source marks importer-managed candidates stale without dropping records', async () => {
  const fix = fixture();
  await importSource(fix.context(), 'client');
  fs.unlinkSync(path.join(fix.sourceRoot, 'Example.cs'));
  const report = await importSource(fix.context(), 'client');
  assert.deepEqual(report.deleted_sources_marked, ['Assets/Scripts/Example.cs']);
  const record = read(fix.recordPath);
  assert.equal(record.status, 'stale');
  assert.equal(record.symbols.every(symbol => symbol.status === 'stale'), true);
  assert.equal(read(path.join(fix.kb, 'code/index.json')).modules.client.sources['client-main'].records.length, 1);
  const second = await importSource(fix.context(), 'client');
  assert.equal(second.changed_records, 0);
  assert.equal(second.preserved_records.length, 1);
});

test('unsupported file extensions are reported without invented parse results', async () => {
  const fix = fixture(['.asmdef']);
  write(path.join(fix.sourceRoot, 'Example.asmdef'), '{"name":"Example"}\n');
  const report = await importSource(fix.context(), 'client', undefined, { parserEngine: () => { throw new Error('Should not load a parser'); } });
  assert.equal(report.parsed_files, 0);
  assert.equal(report.candidate_symbols, 0);
  assert.deepEqual(report.unsupported_files, ['Assets/Scripts/Example.asmdef']);
  assert.equal(fs.existsSync(fix.recordPath), false);
});

test('same-file candidate references are capped and truncation is explicit', async () => {
  const fix = fixture();
  write(path.join(fix.sourceRoot, 'Example.cs'), `public class Example { public void Run() {} public void Test(){${'Run();'.repeat(45)}} }`);
  await importSource(fix.context(), 'client');
  const run = read(fix.recordPath).symbols.find(symbol => symbol.name === 'Run');
  assert.equal(run.references.length, 30);
  assert.equal(run.reference_search.candidate_count, 45);
  assert.equal(run.reference_search.truncated, true);
});

test('branch namespaces remain isolated and rebinding a populated ID is refused', async () => {
  const fix = fixture();
  await importSource(fix.context(), 'client');
  const branch = await importSource(fix.context(), 'client', 'client-feature-example');
  assert.equal(branch.parsed_files, 1);
  assert.equal(fs.existsSync(path.join(fix.kb, 'code/client/client-feature-example/imported/Assets/Scripts/Future.cs.json')), true);
  fix.manifest.modules.client.sources['client-main'].project_relative_root = 'apps/unity/branches/example-feature';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  await assert.rejects(importSource(fix.context(), 'client'), /identity differs/);
});

test('TypeScript, Go and Python imports use their own grammar declarations', async () => {
  const fix = fixture(['.ts', '.go', '.py']);
  write(path.join(fix.sourceRoot, 'Example.ts'), `import { value } from './other'; export interface Example { run(x:number):void; } export function make():number {return 1;} const other = (x:number)=>x+1;`);
  write(path.join(fix.sourceRoot, 'Example.go'), 'package team\nimport "fmt"\ntype Example struct {Count int}\nfunc (e *Example) Run(x int) int {fmt.Println(x); return x}\n');
  write(path.join(fix.sourceRoot, 'Example.py'), 'import os\nclass Example:\n  def __init__(self):\n    self.size=1\n  def run(self):\n    return self.size\n');
  const report = await importSource(fix.context(), 'client');
  assert.equal(report.parsed_files, 3);
  const ts = read(path.join(fix.kb, 'code/client/client-main/imported/Assets/Scripts/Example.ts.json'));
  assert.equal(ts.symbols.some(symbol => symbol.kind === 'interface' && symbol.name === 'Example'), true);
  assert.equal(ts.symbols.some(symbol => symbol.kind === 'function' && symbol.name === 'other'), true);
  const go = read(path.join(fix.kb, 'code/client/client-main/imported/Assets/Scripts/Example.go.json'));
  assert.equal(go.symbols.find(symbol => symbol.name === 'Run').qualified_name, 'team.Example.Run');
  const python = read(path.join(fix.kb, 'code/client/client-main/imported/Assets/Scripts/Example.py.json'));
  assert.equal(python.symbols.find(symbol => symbol.name === '__init__').kind, 'constructor');
  assert.equal(report.parse_error_files.length, 0);
});

test('malformed source exposes parse errors while definitions remain candidates', async () => {
  const fix = fixture();
  write(path.join(fix.sourceRoot, 'Example.cs'), 'public class Example { public void Run( { }\n');
  const report = await importSource(fix.context(), 'client');
  assert.deepEqual(report.parse_error_files, ['Assets/Scripts/Example.cs']);
  assert.equal(read(fix.recordPath).has_parse_errors, true);
  assert.equal(read(fix.recordPath).symbols.every(symbol => symbol.status === 'candidate'), true);
});

test('generated code defaults to type and enum-member records without wrapper methods or reference expansion', async () => {
  const fix = fixture();
  const generated = `// <auto-generated>\n// Generated by the protocol buffer compiler. DO NOT EDIT!\n// source: synthetic.proto\nnamespace Team.Generated;\npublic class Message { public Message() {} public int Count { get; set; } public void Read(){ Read(); } public class Nested {} }\npublic enum Kind { None = 0, First = 1 }\n`;
  write(path.join(fix.sourceRoot, 'Generated.cs'), generated);
  const report = await importSource(fix.context(), 'client');
  assert.equal(report.generated_file_count, 1);
  assert.equal(report.generated_files[0].mode, 'types-only');
  const record = read(path.join(fix.kb, 'code/client/client-main/imported/Assets/Scripts/Generated.cs.json'));
  assert.equal(record.generated_code.detected, true);
  assert.match(record.generated_code.producer_header, /synthetic.proto/);
  assert.deepEqual(record.symbols.map(symbol => symbol.name), ['Message', 'Nested', 'Kind', 'None', 'First']);
  assert.equal(record.symbols.every(symbol => symbol.references.length === 0 && symbol.reference_search.status === 'not-inspected'), true);
  assert.equal(record.coverage.references, 'not-inspected-generated-types-only');
  assert.equal(read(fix.recordPath).symbols.some(symbol => symbol.kind === 'method'), true);
});

test('generated full mode is configurable and managed candidate output refreshes back to types-only', async () => {
  const fix = fixture();
  write(path.join(fix.sourceRoot, 'Generated.cs'), '// Code generated by an example tool. DO NOT EDIT.\npublic class Generated { public void Read(){} public void Call(){Read();} }\n');
  fix.manifest.modules.client.import_generated = 'full';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  await importSource(fix.context(), 'client');
  const recordPath = path.join(fix.kb, 'code/client/client-main/imported/Assets/Scripts/Generated.cs.json');
  const expanded = read(recordPath);
  assert.equal(expanded.symbols.some(symbol => symbol.name === 'Read' && symbol.references.length), true);
  delete fix.manifest.modules.client.import_generated;
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  const report = await importSource(fix.context(), 'client');
  const compact = read(recordPath);
  assert.equal(report.generated_file_count, 1);
  assert.equal(compact.generated_code.mode, 'types-only');
  assert.deepEqual(compact.symbols.map(symbol => symbol.kind), ['class']);
  assert.equal(compact.symbols.every(symbol => symbol.status === 'candidate'), true);
  fix.manifest.modules.client.import_generated = 'skip';
  write(path.join(fix.kb, 'manifest.json'), fix.manifest);
  assert.throws(fix.context, /import_generated/);
});

test('CLI import reports missing opt-in parser dependencies without downloading', () => {
  const fix = fixture();
  const isolated = path.join(fix.base, 'IsolatedSkill/scripts');
  fs.mkdirSync(isolated, { recursive: true });
  for (const name of ['kb.mjs', 'import-code.mjs']) fs.copyFileSync(path.join(scriptDirectory, name), path.join(isolated, name));
  const result = spawnSync(process.execPath, [path.join(isolated, 'kb.mjs'), 'import', '--kb', fix.kb, '--module', 'client'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependencies are missing/);
  assert.match(result.stderr, /npm install --ignore-scripts/);
  assert.equal(result.stderr.includes(fix.base), false);
  assert.equal(fs.existsSync(fix.recordPath), false);
});

test('schema1 bootstrap keeps legacy identities and existing curated records', async () => {
  const fix = fixture();
  const kb = path.join(fix.root, 'Docs/Knowledge');
  write(path.join(kb, 'manifest.json'), { schema_version: 1, project: 'TeamExample', code_index: 'code/index.json', modules: { client: { project_relative_root: 'apps/unity/trunk', code_status: 'available', inventory_roots: ['Assets/Scripts'] } } });
  write(path.join(kb, 'code/index.json'), { schema_version: 1, modules: { client: { source_identity: 'apps/unity/trunk', records: [] } } });
  const context = loadKnowledge({ kb }, { svnRunner: () => null });
  const report = await importSource(context, 'client');
  assert.equal(report.parsed_files, 1);
  const record = read(path.join(kb, 'code/client/imported/Assets/Scripts/Example.cs.json'));
  assert.equal(record.schema_version, 1);
  assert.equal(record.source_identity, 'apps/unity/trunk');
  assert.equal(record.source_id, undefined);
  assert.equal(read(path.join(kb, 'manifest.json')).schema_version, 1);
});
