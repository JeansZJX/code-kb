#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_SKIPS = ['.svn', '.git', 'node_modules', 'Library', 'Temp', 'obj', 'bin'];
const DEFAULT_EXTENSIONS = ['.cs', '.asmdef', '.go', '.ts', '.tsx', '.js', '.mjs', '.py', '.rs', '.cpp', '.h', '.hpp', '.c', '.java', '.proto'];
const slash = value => value.split(path.sep).join('/');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isAbsolute = value => path.isAbsolute(value) || path.win32.isAbsolute(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const comparePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
const samePath = (a, b) => comparePath(path.resolve(a)) === comparePath(path.resolve(b));
const sortPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function relativePath(value, label, allowParent = false) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0')) {
    throw new Error(`${label} must be a portable relative path using forward slashes.`);
  }
  if (!allowParent && value.split('/').includes('..')) throw new Error(`${label} cannot contain parent traversal.`);
  return value;
}

export function safePath(root, relative, label = 'Path', mustExist = true) {
  relativePath(relative, label);
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw new Error(`${label} escapes its root.`);
  // Check every existing component, including junctions on Windows; links are not indexed.
  let cursor = root;
  for (const part of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let entry;
    try { entry = fs.lstatSync(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!entry) {
      if (mustExist) throw new Error(`${label} does not exist: ${relative}`);
      break;
    }
    if (entry.isSymbolicLink() || !inside(fs.realpathSync(root), fs.realpathSync(cursor))) {
      throw new Error(`${label} traverses a symbolic link: ${relative}`);
    }
  }
  return candidate;
}

export function writeChanged(file, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
  return true;
}

function discover(start) {
  let cursor = path.resolve(start);
  while (true) {
    const pointer = path.join(cursor, 'code-kb.project.json');
    if (fs.existsSync(pointer)) {
      const config = readJson(pointer);
      if (!object(config)) throw new Error('Invalid code-kb.project.json.');
      return { kbRoot: safePath(cursor, config.knowledge_base, 'Knowledge-base pointer'), projectRoot: cursor };
    }
    if (fs.existsSync(path.join(cursor, '.code-kb', 'manifest.json'))) {
      return { kbRoot: safePath(cursor, '.code-kb', 'Knowledge-base root'), projectRoot: cursor };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('No code-kb.project.json or .code-kb/manifest.json found; provide --kb or --project-root.');
    cursor = parent;
  }
}

export function loadKnowledge(options = {}, dependencies = {}) {
  const cwd = options.cwd || process.cwd();
  const location = options.kb
    ? { kbRoot: path.resolve(cwd, options.kb), projectRoot: options.projectRoot && path.resolve(cwd, options.projectRoot) }
    : discover(options.projectRoot ? path.resolve(cwd, options.projectRoot) : cwd);
  if (!fs.existsSync(location.kbRoot) || fs.lstatSync(location.kbRoot).isSymbolicLink() || !samePath(fs.realpathSync(location.kbRoot), location.kbRoot)) throw new Error('Knowledge-base root is missing or traverses a symbolic link.');
  const manifest = readJson(safePath(location.kbRoot, 'manifest.json', 'Manifest'));
  if (!object(manifest) || ![1, 2].includes(manifest.schema_version) || !object(manifest.modules)) throw new Error('Unsupported or invalid manifest schema.');
  const legacy = manifest.schema_version === 1;
  if (!legacy) {
    identifier(manifest.project_id, 'project_id');
    relativePath(manifest.project_root_relative, 'project_root_relative', true);
  }
  const inferredRoot = path.resolve(location.kbRoot, legacy ? '../..' : manifest.project_root_relative);
  if (location.projectRoot && !samePath(location.projectRoot, inferredRoot)) throw new Error('Project root differs from manifest project_root_relative.');
  const projectRoot = inferredRoot;
  if (!fs.existsSync(projectRoot)) throw new Error('Project root does not exist.');
  const normalized = {};
  const sourceIds = new Set();
  for (const [id, mod] of Object.entries(manifest.modules)) {
    identifier(id, 'module identifier');
    if (!object(mod)) throw new Error(`Invalid module: ${id}`);
    const sources = legacy ? { legacy: { ...mod, code_status: mod.code_status === 'available' ? 'available' : 'planned' } } : mod.sources;
    if (!object(sources) || !Object.keys(sources).length) throw new Error(`Module ${id} requires sources.`);
    const active = legacy ? 'legacy' : identifier(mod.active_source, 'active_source');
    if (!sources[active]) throw new Error(`Module ${id} active_source is undeclared.`);
    const cleanSources = {};
    for (const [sourceId, source] of Object.entries(sources)) {
      identifier(sourceId, 'source identifier');
      if (!legacy && sourceIds.has(sourceId)) throw new Error('Source identifiers must be unique across modules for local mapping.');
      sourceIds.add(sourceId);
      if (!object(source) || !['available', 'planned'].includes(source.code_status)) throw new Error(`Invalid code_status for ${id}/${sourceId}.`);
      relativePath(source.project_relative_root, 'project_relative_root');
      if (!inside(projectRoot, path.resolve(projectRoot, source.project_relative_root))) throw new Error('Source root escapes project.');
      if (source.svn && (!object(source.svn) || typeof source.svn.repository_uuid !== 'string' || !source.svn.repository_uuid || typeof source.svn.repository_relative_path !== 'string' || !source.svn.repository_relative_path.startsWith('^/'))) throw new Error('SVN binding requires repository_uuid and repository_relative_path starting ^/.');
      cleanSources[sourceId] = source;
    }
    const roots = mod.inventory_roots || ['.'];
    const extensions = mod.extensions || (legacy ? ['.cs', '.asmdef'] : DEFAULT_EXTENSIONS);
    const excludes = mod.exclude_dirs || [];
    if (!Array.isArray(roots) || !Array.isArray(extensions) || !extensions.length || !Array.isArray(excludes)) throw new Error(`Invalid inventory configuration for ${id}.`);
    if (mod.import_generated !== undefined && !['types-only', 'full'].includes(mod.import_generated)) throw new Error('import_generated must be types-only or full.');
    roots.forEach(value => relativePath(value, 'inventory_roots'));
    extensions.forEach(value => { if (typeof value !== 'string' || !/^\.[a-zA-Z0-9]+$/.test(value)) throw new Error('extensions must contain extensions beginning with a dot.'); });
    excludes.forEach(value => relativePath(value, 'exclude_dirs'));
    normalized[id] = { ...mod, active_source: active, sources: cleanSources, inventory_roots: roots, extensions, exclude_dirs: excludes };
  }
  const localName = manifest.local_mapping || 'workspace.local.json';
  const localPath = safePath(location.kbRoot, localName, 'Local mapping', false);
  const local = fs.existsSync(localPath) ? readJson(localPath) : {};
  if (!object(local) || (local.roots && !object(local.roots))) throw new Error('Invalid local mapping.');
  for (const item of manifest.ignored_project_paths || []) relativePath(item, 'ignored_project_paths');
  return { kbRoot: location.kbRoot, projectRoot, manifest, legacy, modules: normalized, local, svnRunner: dependencies.svnRunner || defaultSvnRunner };
}

function defaultSvnRunner(args) {
  const result = spawnSync('svn', args, { encoding: 'utf8', shell: false, timeout: 10000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function xmlText(xml, name) {
  const value = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1];
  return value === undefined ? null : value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function inspectSvn(root, runner = defaultSvnRunner) {
  const unknown = { status: 'unknown', repository_uuid: null, repository_relative_path: null, root_directory_base_revision: null, file_revisions: 'not-inspected', dirty: null };
  let info;
  try { info = runner(['info', '--xml', '--non-interactive', '--', root]); } catch { return unknown; }
  if (typeof info !== 'string') return unknown;
  const uuid = xmlText(info, 'uuid');
  const relative = xmlText(info, 'relative-url');
  const revision = info.match(/<entry\b[^>]*\brevision="(\d+)"/)?.[1];
  if (!uuid || !relative || !relative.startsWith('^/')) return unknown;
  let status;
  try { status = runner(['status', '--xml', '--non-interactive', '--', root]); } catch { status = null; }
  const entries = typeof status === 'string' && /<status[\/\s>]/.test(status) ? [...status.matchAll(/<wc-status\b([^>]*)>/g)] : null;
  const dirty = entries === null ? null : entries.some(([, attrs]) => {
    const item = attrs.match(/\bitem="([^"]+)"/)?.[1];
    const props = attrs.match(/\bprops="([^"]+)"/)?.[1];
    return (item && !['normal', 'none', 'ignored', 'external'].includes(item)) || (props && !['normal', 'none'].includes(props)) || /\btree-conflicted="true"/.test(attrs);
  });
  return { status: 'inspected', repository_uuid: uuid, repository_relative_path: relative, root_directory_base_revision: revision ? Number(revision) : null, file_revisions: 'not-inspected', dirty };
}

export function select(context, moduleId, sourceId) {
  const mod = context.modules[moduleId];
  if (!mod) throw new Error(`Unknown module: ${moduleId}`);
  const selected = sourceId || mod.active_source;
  const source = mod.sources[selected];
  if (!source) throw new Error(`Unknown source: ${moduleId}/${selected}`);
  return { mod, source, sourceId: selected };
}

function excluded(relative, excludes) {
  const segments = relative.split('/');
  return excludes.some(value => value.includes('/') ? relative === value || relative.startsWith(value + '/') : segments.includes(value));
}

export function sourceRoot(context, moduleId, sourceId) {
  const selection = select(context, moduleId, sourceId);
  if (selection.source.code_status !== 'available') throw new Error(`Source ${moduleId}/${selection.sourceId} is planned, not available.`);
  const configured = path.resolve(context.projectRoot, selection.source.project_relative_root);
  const mapped = context.local.roots?.[context.legacy ? moduleId : selection.sourceId];
  if (mapped !== undefined && mapped !== null && (typeof mapped !== 'string' || !mapped)) throw new Error('Local source mapping must be a nonempty path or null.');
  const root = mapped ? path.resolve(context.projectRoot, mapped) : configured;
  const override = !samePath(configured, root);
  if (override && !selection.source.svn) throw new Error('Alternative local root requires an explicit SVN source binding.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Source directory does not exist for ${moduleId}/${selection.sourceId}.`);
  if (fs.lstatSync(root).isSymbolicLink() || !samePath(fs.realpathSync(root), root)) throw new Error('Source root traverses a symbolic link.');
  if (!override) safePath(context.projectRoot, selection.source.project_relative_root, 'Source root');
  if (inside(context.projectRoot, root) && excluded(slash(path.relative(context.projectRoot, root)), context.manifest.ignored_project_paths || [])) throw new Error('Source root is in an ignored project path.');
  const svn = inspectSvn(root, context.svnRunner);
  if (selection.source.svn) {
    const binding = selection.source.svn;
    if (svn.status === 'unknown' && override) throw new Error('Alternative local root cannot be verified: SVN metadata is unavailable.');
    if (svn.status !== 'unknown' && (svn.repository_uuid !== binding.repository_uuid || svn.repository_relative_path !== binding.repository_relative_path)) throw new Error('SVN source identity differs from the configured binding.');
  }
  return { ...selection, root, svn };
}

export function status(context, options = {}) {
  const results = [];
  if (options.module) select(context, options.module, options.source);
  for (const [moduleId, mod] of Object.entries(context.modules)) {
    if (options.module && moduleId !== options.module) continue;
    for (const [sourceId, source] of Object.entries(mod.sources)) {
      if (options.source && sourceId !== options.source) continue;
      const item = { module: moduleId, source_id: sourceId, active: sourceId === mod.active_source, code_status: source.code_status, project_relative_root: source.project_relative_root };
      if (source.code_status === 'available') {
        try { item.svn = sourceRoot(context, moduleId, sourceId).svn; item.available = true; }
        catch (error) { item.available = false; item.reason = error.message; }
      } else item.available = false;
      results.push(item);
    }
  }
  return { schema_version: context.legacy ? 1 : 2, project_id: context.manifest.project_id || context.manifest.project, sources: results };
}

export function inventory(context, moduleId, requestedSource, options = {}) {
  const { mod, source, sourceId, root, svn } = sourceRoot(context, moduleId, requestedSource);
  const extensions = new Set(mod.extensions.map(value => value.toLowerCase()));
  const skips = [...DEFAULT_SKIPS, ...mod.exclude_dirs];
  const files = [];
  const visited = new Set();
  const walk = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name);
      const relative = slash(path.relative(root, full));
      if (excluded(relative, skips)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !visited.has(relative)) {
        visited.add(relative);
        files.push({ path: relative, sha256: hash(full) });
      }
    }
  };
  for (const relative of mod.inventory_roots) {
    if (relative !== '.' && excluded(relative, skips)) continue;
    const folder = safePath(root, relative, 'Inventory root');
    if (!fs.statSync(folder).isDirectory()) throw new Error('Inventory root is not a directory.');
    walk(folder);
  }
  if (!files.length && !options.allowEmpty) throw new Error('Inventory found no source files.');
  files.sort(sortPath);
  const relativeOutput = context.legacy ? `code/${moduleId}/file-inventory.json` : `code/${moduleId}/${sourceId}/file-inventory.json`;
  const output = safePath(context.kbRoot, relativeOutput, 'Inventory output', false);
  if (fs.existsSync(output)) {
    const existing = readJson(output);
    if (context.legacy ? existing.module !== moduleId || existing.source_identity !== source.project_relative_root : existing.project_id !== context.manifest.project_id || existing.module !== moduleId || existing.source_id !== sourceId || existing.source_identity !== source.project_relative_root) throw new Error('Existing inventory identity differs; use a new source_id for a different branch.');
  }
  const result = context.legacy ? {
    schema_version: 1, module: moduleId, source_identity: source.project_relative_root, source_revision: null,
    working_copy_state: svn.status === 'unknown' ? 'revision-and-dirty-state-not-inspected' : 'root-revision-inspected-file-revisions-not-inspected',
    coverage: 'file-fingerprints-only-no-symbol-or-reference-analysis', files
  } : {
    schema_version: 2, project_id: context.manifest.project_id, module: moduleId, source_id: sourceId,
    source_identity: source.project_relative_root, svn, coverage: 'file-fingerprints-only-no-symbol-or-reference-analysis', files
  };
  const changed = writeChanged(output, result);
  return { module: moduleId, source_id: sourceId, file_count: files.length, output: relativeOutput, changed, svn };
}

export function verify(context, options = {}) {
  const indexName = context.manifest.code_index || 'code/index.json';
  const index = readJson(safePath(context.kbRoot, indexName, 'Code index'));
  if (!object(index) || index.schema_version !== (context.legacy ? 1 : 2) || !object(index.modules) || (!context.legacy && index.project_id !== context.manifest.project_id)) throw new Error('Invalid code index schema or project identity.');
  if (options.module) select(context, options.module, options.source);
  const failures = [];
  let checked = 0;
  for (const [moduleId, moduleIndex] of Object.entries(index.modules)) {
    if (options.module && moduleId !== options.module) continue;
    try {
      if (!object(moduleIndex)) throw new Error('Invalid module index.');
      const mod = context.modules[moduleId];
      if (!mod) throw new Error('Module index names an undeclared module.');
      const sources = context.legacy ? { legacy: moduleIndex } : moduleIndex.sources;
      if (!object(sources)) throw new Error('Module index requires sources.');
      for (const [sourceId, sourceIndex] of Object.entries(sources)) {
        if (options.source && sourceId !== options.source) continue;
        try {
          select(context, moduleId, sourceId);
          if (!object(sourceIndex) || !Array.isArray(sourceIndex.records)) throw new Error('Invalid records list.');
          const seenRecords = new Set();
          for (const name of sourceIndex.records) {
            try {
              if (seenRecords.has(name)) throw new Error('Record is registered more than once.');
              seenRecords.add(name);
              const recordPath = safePath(context.kbRoot, name, 'Record');
              const recordFolder = path.join(context.kbRoot, 'code', moduleId, ...(context.legacy ? [] : [sourceId]));
              if (!inside(recordFolder, recordPath)) throw new Error('Record path is outside its module/source directory.');
              const record = readJson(recordPath);
              if (!object(record) || record.schema_version !== (context.legacy ? 1 : 2) || !Array.isArray(record.symbols)) throw new Error('Invalid symbol record schema.');
              if (record.module !== moduleId || (context.legacy ? record.source_identity !== mod.sources.legacy.project_relative_root : record.project_id !== context.manifest.project_id || record.source_id !== sourceId)) throw new Error('Record source identity differs from its configured module/source.');
              const symbolIds = new Set();
              let selectedRoot;
              for (const symbol of record.symbols) {
                if (!object(symbol) || typeof symbol.id !== 'string' || !symbol.id || symbolIds.has(symbol.id)) throw new Error('Symbol ID is missing or duplicated.');
                symbolIds.add(symbol.id);
                if (symbol.status !== 'verified') continue;
                selectedRoot ||= sourceRoot(context, moduleId, sourceId);
                if (!object(symbol.definition) || (symbol.references && !Array.isArray(symbol.references))) throw new Error('Verified symbol requires a definition and a reference list.');
                const locations = [symbol.definition, ...(symbol.references || []).filter(value => value.status === 'confirmed')];
                for (const location of locations) {
                  const file = safePath(selectedRoot.root, location.path, 'Source location');
                  if (!fs.statSync(file).isFile()) throw new Error(`Source location is not a file: ${location.path}`);
                  if (typeof location.file_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(location.file_sha256) || hash(file) !== location.file_sha256) throw new Error(`Stale source: ${location.path}`);
                  const lines = fs.readFileSync(file, 'utf8').split(/\n/);
                  if (!Number.isInteger(location.line) || location.line < 1 || location.line > lines.length) throw new Error(`Invalid source line: ${location.path}`);
                  if (typeof location.evidence !== 'string' || !location.evidence || !lines[location.line - 1].includes(location.evidence)) throw new Error(`Source evidence differs: ${location.path}:${location.line}`);
                  checked++;
                }
              }
            } catch (error) { failures.push(`${moduleId}/${sourceId}/${name}: ${error.message}`); }
          }
        } catch (error) { failures.push(`${moduleId}/${sourceId}: ${error.message}`); }
      }
    } catch (error) { failures.push(`${moduleId}: ${error.message}`); }
  }
  return { checked_locations: checked, failures, exit_code: failures.length ? 1 : checked ? 0 : 2, coverage: 'recorded-source-locations-only-not-compilation-or-complete-reference-analysis' };
}

export function init(options = {}) {
  const projectRoot = path.resolve(options.cwd || process.cwd(), options.projectRoot || '.');
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory() || fs.lstatSync(projectRoot).isSymbolicLink()) throw new Error('Project root must be an existing ordinary directory.');
  const preset = options.preset || 'generic';
  if (!['generic', 'unity-svn'].includes(preset)) throw new Error('Unknown preset; use generic or unity-svn.');
  const projectId = options.projectId || path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '') || 'project';
  identifier(projectId, 'project_id');
  const unity = preset === 'unity-svn';
  const modules = unity ? {
    client: { active_source: 'client-main', inventory_roots: ['Assets/Scripts'], extensions: ['.cs', '.asmdef'], exclude_dirs: [], rules: ['rules/shared.md', 'rules/client.md'], sources: {
      'client-main': { project_relative_root: 'apps/unity/trunk', code_status: 'planned', role: 'mainline' },
      'client-feature-example': { project_relative_root: 'apps/unity/branches/example-feature', code_status: 'planned', role: 'feature-branch' }
    } },
    server: { active_source: 'server-main', inventory_roots: ['.'], extensions: DEFAULT_EXTENSIONS, exclude_dirs: [], rules: ['rules/shared.md', 'rules/server.md'], sources: {
      'server-main': { project_relative_root: 'services/game/trunk', code_status: 'planned', role: 'server-confirm-before-activation' }
    } }
  } : { app: { active_source: 'main', inventory_roots: ['src'], extensions: DEFAULT_EXTENSIONS, exclude_dirs: [], rules: ['rules/shared.md', 'rules/app.md'], sources: {
    main: { project_relative_root: '.', code_status: 'planned', role: 'confirm-source-before-activation' }
  } } };
  const manifest = {
    schema_version: 2, project_id: projectId, project_root_relative: '..', version_control: 'svn', local_mapping: 'workspace.local.json',
    modules, ignored_project_paths: [], catalog: 'catalog/index.json', code_index: 'code/index.json', rule_proposals: 'proposals/',
    rule_statuses: ['documented', 'proposed', 'accepted', 'superseded']
  };
  const codeIndex = { schema_version: 2, project_id: projectId, modules: Object.fromEntries(Object.entries(modules).map(([id, mod]) => [id, { sources: Object.fromEntries(Object.keys(mod.sources).map(sourceId => [sourceId, { records: [], inventory: `code/${id}/${sourceId}/file-inventory.json` }])) }])) };
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const files = new Map([
    ['code-kb.project.json', json({ knowledge_base: '.code-kb' })],
    ['.code-kb/manifest.json', json(manifest)],
    ['.code-kb/workspace.local.example.json', json({ roots: Object.fromEntries(Object.values(modules).flatMap(mod => Object.keys(mod.sources)).map(id => [id, null])) })],
    ['.code-kb/catalog/index.json', json({ schema_version: 2, project_id: projectId, capabilities: [] })],
    ['.code-kb/code/index.json', json(codeIndex)],
    ['.code-kb/rules/shared.md', '# 团队共享规则\n\n状态：proposed。请记录团队确认的目录、命名、依赖和复用约定，并为每条 accepted 规则保留决策依据。初始化没有设定任何已接受规则。\n'],
    ['.code-kb/proposals/README.md', '# 规则提案\n\n新规范及推荐入口先登记为 proposed，记录范围、理由、影响和决策依据。代码事实可在核验后更新；新实现不会自动成为 accepted 规范。\n'],
    ['.code-kb/README.md', '# 项目代码知识库\n\n先确认 manifest 中的代码源，再把 code_status 改为 available。按模块登记规则、公共能力和源码记录；使用 $code-kb 读取并更新受影响的记录。workspace.local.json 仅保留在本机，不提交到 SVN。索引只记录项目或模块相对路径。\n']
  ]);
  for (const id of Object.keys(modules)) files.set(`.code-kb/rules/${id}.md`, `# ${id} 代码规则\n\n状态：proposed。待团队登记目录、类和函数的存放规则、依赖方向及特殊约定。\n`);
  // All destinations are preflighted before any write; existing knowledge is never merged implicitly.
  if (fs.existsSync(path.join(projectRoot, '.code-kb')) || fs.existsSync(path.join(projectRoot, 'code-kb.project.json'))) throw new Error('Initialization refused: a knowledge base or project pointer already exists.');
  for (const name of files.keys()) safePath(projectRoot, name, 'Initialization destination', false);
  for (const [name, body] of files) {
    const file = path.join(projectRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' });
  }
  return { project_id: projectId, knowledge_base: '.code-kb', files_created: files.size, preset, source_activation: 'confirmation-required' };
}

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['init', 'status', 'inventory', 'verify', 'import'].includes(command)) throw new Error('Usage: kb.mjs init|status|inventory|verify|import [--kb PATH] [--project-root PATH] [--module ID] [--source ID] [--preset generic|unity-svn] [--project-id ID]');
  const names = { '--kb': 'kb', '--project-root': 'projectRoot', '--module': 'module', '--source': 'source', '--preset': 'preset', '--project-id': 'projectId' };
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = names[rest[index]];
    const value = rest[index + 1];
    if (!name || !value || value.startsWith('--') || options[name] !== undefined) throw new Error(`Invalid or repeated argument: ${rest[index]}`);
    options[name] = value;
  }
  if (['inventory', 'import'].includes(command) && !options.module) throw new Error(`${command} requires --module.`);
  if (options.source && !options.module) throw new Error('--source requires --module.');
  if (command !== 'init' && (options.preset || options.projectId)) throw new Error('--preset and --project-id are init-only.');
  if (command === 'init' && (options.kb || options.module || options.source)) throw new Error('init accepts --project-root, --preset and --project-id only.');
  return { command, options };
}

export function run(args, dependencies = {}) {
  const { command, options } = parseArgs(args);
  if (command === 'import') throw new Error('Import is asynchronous; call importSource or use the CLI.');
  if (dependencies.cwd) options.cwd = dependencies.cwd;
  if (command === 'init') return { result: init(options), exitCode: 0 };
  const context = loadKnowledge(options, dependencies);
  if (command === 'status') return { result: status(context, options), exitCode: 0 };
  if (command === 'inventory') return { result: inventory(context, options.module, options.source), exitCode: 0 };
  const result = verify(context, options);
  return { result, exitCode: result.exit_code };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let outcome;
    if (args[0] === 'import') {
      const { options } = parseArgs(args);
      const { importSource } = await import('./import-code.mjs');
      outcome = { result: await importSource(loadKnowledge(options), options.module, options.source), exitCode: 0 };
    } else outcome = run(args);
    console.log(JSON.stringify(outcome.result, null, 2));
    process.exitCode = outcome.exitCode;
  } catch (error) {
    // Avoid printing absolute local paths or repository URLs from underlying OS/parser errors.
    const message = error.message.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s'"<>]+/g, '[local-path]').replace(/https?:\/\/\S+/g, '[repository-url]');
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) main();
