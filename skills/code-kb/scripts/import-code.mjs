import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { inventory, sourceRoot, safePath, writeChanged, inside } from './kb.mjs';

const require = createRequire(import.meta.url);
const LANGUAGES = { '.cs': 'c_sharp', '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.go': 'go', '.py': 'python' };
const TYPE_NODES = new Set(['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration', 'class_definition', 'type_spec']);
const IDENTIFIERS = new Set(['identifier', 'property_identifier', 'type_identifier', 'field_identifier']);
const IMPORTS = new Set(['using_directive', 'import_statement', 'import_from_statement', 'import_declaration']);
const GENERATED_KINDS = new Set(['class', 'interface', 'struct', 'enum', 'record', 'delegate', 'type', 'type-alias', 'enum-member']);
const CS_KINDS = { class_declaration: 'class', interface_declaration: 'interface', struct_declaration: 'struct', enum_declaration: 'enum', record_declaration: 'record', method_declaration: 'method', constructor_declaration: 'constructor', destructor_declaration: 'destructor', property_declaration: 'property', event_declaration: 'event', delegate_declaration: 'delegate', enum_member_declaration: 'enum-member', local_function_statement: 'local-function' };
const JS_KINDS = { class_declaration: 'class', class: 'class', interface_declaration: 'interface', type_alias_declaration: 'type-alias', enum_declaration: 'enum', function_declaration: 'function', generator_function_declaration: 'function', method_definition: 'method', method_signature: 'method', abstract_method_signature: 'method', property_signature: 'property', public_field_definition: 'field' };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = body => crypto.createHash('sha256').update(body).digest('hex');
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

let enginePromise;
async function parserEngine() {
  enginePromise ||= (async () => {
    let bindings, grammarDirectory;
    try {
      bindings = await import('web-tree-sitter');
      grammarDirectory = path.join(path.dirname(require.resolve('@repomix/tree-sitter-wasms/package.json')), 'out');
    } catch {
      throw new Error('AST import dependencies are missing. Install web-tree-sitter@0.27.0 and @repomix/tree-sitter-wasms@0.1.17 in the installed code-kb skill directory (npm install --ignore-scripts). No packages were downloaded automatically.');
    }
    await bindings.Parser.init();
    const languages = new Map();
    return {
      async parse(language, source) {
        if (!languages.has(language)) languages.set(language, await bindings.Language.load(path.join(grammarDirectory, `tree-sitter-${language}.wasm`)));
        const parser = new bindings.Parser();
        parser.setLanguage(languages.get(language));
        try {
          const tree = parser.parse(source);
          if (!tree) throw new Error('Tree-sitter returned no syntax tree.');
          return { tree, parser };
        } catch (error) { parser.delete(); throw error; }
      }
    };
  })();
  return enginePromise;
}

function header(node, source) {
  const body = node.childForFieldName('body') || node.childForFieldName('accessors') || node.namedChildren.find(child => ['class_body', 'interface_body', 'declaration_list', 'enum_body', 'field_declaration_list', 'block'].includes(child.type));
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/;$/, '').trim();
}

function goReceiver(node) {
  const receiver = node.childForFieldName('receiver');
  if (!receiver) return null;
  const identifiers = [];
  const walk = child => {
    if (child.type === 'type_identifier') identifiers.push(child.text);
    for (const named of child.namedChildren) walk(named);
  };
  walk(receiver);
  return identifiers[0] || receiver.text;
}

function definitionNodes(node, language, source, scope) {
  let kind;
  let name = node.childForFieldName('name');
  let signatureNode = node;
  if (language === 'c_sharp') {
    kind = CS_KINDS[node.type];
    if (node.type === 'variable_declarator' && node.parent?.type === 'variable_declaration' && ['field_declaration', 'event_field_declaration'].includes(node.parent.parent?.type)) {
      kind = node.parent.parent.type === 'event_field_declaration' ? 'event' : 'field';
      signatureNode = node.parent.parent;
    }
  } else if (['typescript', 'tsx', 'javascript'].includes(language)) {
    kind = JS_KINDS[node.type];
    if (node.type === 'variable_declarator' && ['arrow_function', 'function_expression', 'generator_function'].includes(node.childForFieldName('value')?.type)) {
      kind = 'function';
      signatureNode = node;
    }
    if (kind === 'method' && name?.text === 'constructor') kind = 'constructor';
  } else if (language === 'python') {
    kind = node.type === 'class_definition' ? 'class' : node.type === 'function_definition' ? (scope.types.length ? 'method' : 'function') : undefined;
    if (name?.text === '__init__' && kind === 'method') kind = 'constructor';
  } else if (language === 'go') {
    if (node.type === 'type_spec') kind = node.childForFieldName('type')?.type === 'struct_type' ? 'struct' : node.childForFieldName('type')?.type === 'interface_type' ? 'interface' : 'type';
    else if (node.type === 'function_declaration') kind = 'function';
    else if (node.type === 'method_declaration') kind = 'method';
    else if (node.type === 'field_declaration') kind = 'field';
  }
  if (!kind || !name || !IDENTIFIERS.has(name.type)) return null;
  let signature = header(signatureNode, source);
  if (node.type === 'variable_declarator' && language !== 'c_sharp') {
    const value = node.childForFieldName('value');
    const body = value?.childForFieldName('body');
    if (body) signature = source.slice(node.startIndex, body.startIndex).trim();
  }
  const declaringType = language === 'go' && kind === 'method' ? goReceiver(node) : scope.types.join('.') || null;
  const namespace = scope.namespaces.join('.') || null;
  const fullName = [namespace, declaringType, ...scope.functions, name.text].filter(Boolean).join('.');
  return { kind, name: name.text, nameStart: name.startIndex, node, signature, namespace, declaring_type: declaringType, qualified_name: fullName };
}

function collect(tree, source, file, moduleId, sourceId, language, fileHash, options = {}) {
  const lines = source.split('\n');
  const imported = [];
  const symbols = [];
  const identifiers = [];
  const definitionStarts = new Set();
  const errors = [];
  const generatedTypesOnly = options.generated && options.generatedMode === 'types-only';
  const fileNamespace = tree.rootNode.namedChildren.find(node => node.type === 'file_scoped_namespace_declaration')?.childForFieldName('name')?.text;
  const packageName = language === 'go' ? tree.rootNode.namedChildren.find(node => node.type === 'package_clause')?.namedChildren[0]?.text : null;
  const location = node => ({ path: file, line: node.startPosition.row + 1, column: node.startPosition.column + 1, file_sha256: fileHash, evidence: lines[node.startPosition.row]?.replace(/\r+$/, '') || node.text.split('\n')[0] });
  const walk = (node, scope) => {
    if (node.isError || node.isMissing) {
      errors.push({ line: node.startPosition.row + 1, node_type: node.type, kind: node.isMissing ? 'missing-token' : 'parse-error', evidence: lines[node.startPosition.row]?.replace(/\r+$/, '') || '' });
      if (node.isError) return;
    }
    if (IMPORTS.has(node.type)) imported.push({ kind: node.type, text: node.text, status: 'candidate', ...location(node) });
    const definition = definitionNodes(node, language, source, scope);
    if (definition && (!generatedTypesOnly || GENERATED_KINDS.has(definition.kind))) {
      definitionStarts.add(definition.nameStart);
      const normalizedSignature = definition.signature.replace(/\s+/g, ' ');
      symbols.push({
        id: `${moduleId}/${sourceId}:${file}:${definition.kind}:${definition.qualified_name}:${digest(normalizedSignature).slice(0, 16)}`,
        kind: definition.kind, name: definition.name, namespace: definition.namespace, declaring_type: definition.declaring_type,
        qualified_name: definition.qualified_name, signature: definition.signature, status: 'candidate',
        definition: location(node), source_revision: null, retrieval_method: 'tree-sitter-ast',
        references: [], reference_search: generatedTypesOnly
          ? { method: 'not-inspected-generated-types-only', status: 'not-inspected', maximum_locations: 0, candidate_count: 0, truncated: false }
          : { method: 'same-file-ast-identifiers', status: 'candidate', maximum_locations: 30, candidate_count: 0, truncated: false },
        parse_quality: node.hasError ? 'contains-parse-errors' : 'syntactically-parsed-not-semantically-verified'
      });
    }
    if (!generatedTypesOnly && IDENTIFIERS.has(node.type)) identifiers.push({ text: node.text, start: node.startIndex, ...location(node) });
    let childScope = scope;
    if (node.type === 'namespace_declaration') childScope = { ...scope, namespaces: [...scope.namespaces, node.childForFieldName('name')?.text].filter(Boolean) };
    else if (definition && (TYPE_NODES.has(node.type) || node.type === 'class')) childScope = { ...scope, types: [...scope.types, definition.name] };
    else if (definition && ['function', 'local-function'].includes(definition.kind)) childScope = { ...scope, functions: [...scope.functions, definition.name] };
    for (const child of node.namedChildren) walk(child, childScope);
  };
  walk(tree.rootNode, { namespaces: [fileNamespace || packageName].filter(Boolean), types: [], functions: [] });
  const referencesByName = new Map();
  for (const item of identifiers) {
    if (definitionStarts.has(item.start)) continue;
    const { text, start, ...rest } = item;
    const list = referencesByName.get(text) || [];
    list.push({ status: 'candidate', ...rest });
    referencesByName.set(text, list);
  }
  for (const symbol of symbols) {
    const matches = referencesByName.get(symbol.name) || [];
    symbol.references = matches.slice(0, 30);
    symbol.reference_search.candidate_count = matches.length;
    symbol.reference_search.truncated = matches.length > 30;
  }
  // Duplicate IDs can occur in partially parsed input; retain deterministic unique source locations.
  const seen = new Set();
  for (const symbol of symbols) {
    if (seen.has(symbol.id)) symbol.id += `:line-${symbol.definition.line}-column-${symbol.definition.column}`;
    seen.add(symbol.id);
  }
  return { symbols, imports: imported, parse_errors: errors, has_parse_errors: tree.rootNode.hasError };
}

function generatedCode(source, configuredMode) {
  const beginning = source.slice(0, 4096);
  const lines = beginning.split(/\n/);
  const evidence = lines.find(line => /<auto-generated>|Code generated[^\n]*DO NOT EDIT/i.test(line));
  if (!evidence) return { detected: false };
  return {
    detected: true, mode: configuredMode || 'types-only', evidence: evidence.replace(/\r+$/, ''),
    producer_header: lines.slice(0, 8).map(line => line.replace(/\r+$/, '')).join('\n')
  };
}

function recordIdentity(record, context, moduleId, sourceId, source) {
  return record && record.schema_version === (context.legacy ? 1 : 2) && record.module === moduleId
    && (context.legacy ? record.source_identity === source.project_relative_root : record.project_id === context.manifest.project_id && record.source_id === sourceId && (!record.source_identity || record.source_identity === source.project_relative_root));
}

function preserve(record) {
  return record.managed_by !== 'code-kb-import' || !Array.isArray(record.symbols) || record.symbols.some(symbol => symbol.status !== 'candidate') || (record.status !== undefined && record.status !== 'candidate');
}

export async function importSource(context, moduleId, requestedSource, options = {}) {
  const { mod, source, sourceId, root, svn } = sourceRoot(context, moduleId, requestedSource);
  const indexed = inventory(context, moduleId, sourceId, { allowEmpty: true });
  const files = readJson(safePath(context.kbRoot, indexed.output, 'File inventory')).files;
  const supported = files.filter(file => LANGUAGES[path.extname(file.path).toLowerCase()]);
  const engine = supported.length ? await (options.parserEngine || parserEngine)() : null;
  const indexPath = safePath(context.kbRoot, context.manifest.code_index || 'code/index.json', 'Code index');
  const index = readJson(indexPath);
  if (!index || index.schema_version !== (context.legacy ? 1 : 2) || typeof index.modules !== 'object' || !index.modules || (!context.legacy && index.project_id !== context.manifest.project_id)) throw new Error('Invalid code index schema or project identity.');
  let sourceIndex;
  if (context.legacy) {
    index.modules[moduleId] ||= { source_identity: source.project_relative_root, records: [] };
    sourceIndex = index.modules[moduleId];
    if (sourceIndex.source_identity && sourceIndex.source_identity !== source.project_relative_root) throw new Error('Code index source identity differs.');
  } else {
    index.modules[moduleId] ||= { sources: {} };
    index.modules[moduleId].sources ||= {};
    sourceIndex = index.modules[moduleId].sources[sourceId] ||= { records: [] };
  }
  if (!Array.isArray(sourceIndex.records)) throw new Error('Code index records must be an array.');
  const existingRecords = new Set(sourceIndex.records);
  const recordRoot = context.legacy ? `code/${moduleId}` : `code/${moduleId}/${sourceId}`;
  const report = {
    module: moduleId, source_id: sourceId, parsed_files: 0, candidate_symbols: 0, candidate_references: 0,
    changed_records: 0, unchanged_records: 0, preserved_records: [], deleted_sources_marked: [],
    unsupported_files: files.filter(file => !LANGUAGES[path.extname(file.path).toLowerCase()]).map(file => file.path),
    parse_error_files: [], generated_file_count: 0, generated_files: [], warnings: [], index_changed: false, coverage: 'ast-candidate-definitions-and-same-file-identifier-references-not-semantic-analysis', svn
  };
  // Preflight all referenced records so malformed paths cannot cause a partially written import.
  for (const name of existingRecords) {
    const file = safePath(context.kbRoot, name, 'Registered record');
    if (!inside(path.join(context.kbRoot, recordRoot), file)) throw new Error('Registered record escapes its module/source directory.');
    const record = readJson(file);
    if (!recordIdentity(record, context, moduleId, sourceId, source)) throw new Error('Registered record source identity differs.');
  }
  for (const file of supported) {
    const relativeRecord = `${recordRoot}/imported/${file.path}.json`;
    const recordPath = safePath(context.kbRoot, relativeRecord, 'Imported record', false);
    if (fs.existsSync(recordPath)) {
      const previous = readJson(recordPath);
      if (!recordIdentity(previous, context, moduleId, sourceId, source)) throw new Error('Imported record source identity differs.');
      if (preserve(previous)) {
        existingRecords.add(relativeRecord);
        report.preserved_records.push(relativeRecord);
        report.warnings.push(`Preserved curated or stale record: ${relativeRecord}; refresh it explicitly after reviewing its source.`);
        continue;
      }
    }
    const sourceFile = safePath(root, file.path, 'Import source');
    const raw = fs.readFileSync(sourceFile);
    if (digest(raw) !== file.sha256) throw new Error(`Source changed during import: ${file.path}; rerun from a consistent working copy.`);
    const text = raw.toString('utf8');
    const generated = generatedCode(text, mod.import_generated);
    if (generated.detected) {
      report.generated_file_count++;
      report.generated_files.push({ path: file.path, mode: generated.mode, evidence: generated.evidence });
    }
    const language = LANGUAGES[path.extname(file.path).toLowerCase()];
    const parsed = await engine.parse(language, text);
    let extracted;
    try { extracted = collect(parsed.tree, text, file.path, moduleId, sourceId, language, file.sha256, { generated: generated.detected, generatedMode: generated.mode }); }
    finally { parsed.tree.delete(); parsed.parser.delete(); }
    const record = {
      schema_version: context.legacy ? 1 : 2,
      ...(context.legacy ? {} : { project_id: context.manifest.project_id, source_id: sourceId }),
      module: moduleId, source_identity: source.project_relative_root, managed_by: 'code-kb-import', source_file: file.path,
      file_sha256: file.sha256, source_revision: null, svn, status: 'candidate',
      parser: { engine: 'tree-sitter', runtime_package: 'web-tree-sitter@0.27.0', grammar_package: '@repomix/tree-sitter-wasms@0.1.17', language },
      generated_code: generated,
      coverage: { definitions: generated.detected && generated.mode === 'types-only' ? 'generated-type-and-enum-member-declarations-only' : 'syntax-tree-named-declarations-candidates', references: generated.detected && generated.mode === 'types-only' ? 'not-inspected-generated-types-only' : 'same-file-identifier-candidates-only', semantic_resolution: 'not-performed', dynamic_references: 'not-inspected' },
      ...extracted
    };
    report.parsed_files++;
    report.candidate_symbols += record.symbols.length;
    report.candidate_references += record.symbols.reduce((count, symbol) => count + symbol.references.length, 0);
    if (record.has_parse_errors) report.parse_error_files.push(file.path);
    if (writeChanged(recordPath, record)) report.changed_records++; else report.unchanged_records++;
    existingRecords.add(relativeRecord);
  }
  // Only importer-managed candidates are marked stale on deletion. Curated records are left intact.
  for (const name of [...existingRecords].sort(sortText)) {
    const recordPath = safePath(context.kbRoot, name, 'Record');
    const record = readJson(recordPath);
    if (record.managed_by !== 'code-kb-import' || typeof record.source_file !== 'string') continue;
    const actual = safePath(root, record.source_file, 'Recorded source', false);
    if (fs.existsSync(actual)) continue;
    if (preserve(record)) {
      if (!report.preserved_records.includes(name)) report.preserved_records.push(name);
      report.warnings.push(`Deleted source has a preserved curated or stale record: ${name}; review it explicitly.`);
      continue;
    }
    record.status = 'stale';
    record.stale_reason = 'source-file-deleted';
    record.symbols = record.symbols.map(symbol => ({ ...symbol, status: 'stale' }));
    if (writeChanged(recordPath, record)) report.changed_records++;
    report.deleted_sources_marked.push(record.source_file);
  }
  const additions = [...existingRecords].filter(name => !sourceIndex.records.includes(name)).sort(sortText);
  sourceIndex.records.push(...additions);
  sourceIndex.inventory = indexed.output;
  report.index_changed = writeChanged(indexPath, index);
  return report;
}
