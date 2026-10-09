#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function usage() {
  console.log('Usage: node scripts/install.mjs --project-root <SVN-working-copy-root> [--replace]');
}
function fail(message) {
  console.error(`Install failed: ${message}`);
  process.exit(1);
}
if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
let requestedRoot;
let replace = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--project-root') {
    if (requestedRoot || !args[i + 1] || args[i + 1].startsWith('--')) fail('--project-root requires one path.');
    requestedRoot = args[++i];
  } else if (args[i] === '--replace') {
    replace = true;
  } else {
    fail(`Unknown argument: ${args[i]}`);
  }
}
if (!requestedRoot) { usage(); process.exit(1); }

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function checkNoLinks(root, candidate) {
  if (!isInside(root, candidate)) throw new Error('Destination leaves the selected project.');
  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      // lstat also detects dangling links, which existsSync reports as absent.
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic link at ${current}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic link at ${current}`);
    if (!isInside(root, fs.realpathSync(current))) throw new Error('Resolved destination leaves the selected project.');
  }
}
function collectFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const next = path.join(directory, entry.name);
    const nextRelative = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Packaged source contains a symbolic link: ${nextRelative}`);
    if (entry.isDirectory()) files.push(...collectFiles(next, nextRelative));
    else if (entry.isFile()) files.push(nextRelative);
    else throw new Error(`Unsupported packaged entry: ${nextRelative}`);
  }
  return files.sort();
}

try {
  const projectRoot = fs.realpathSync(path.resolve(requestedRoot));
  if (!fs.statSync(projectRoot).isDirectory()) throw new Error('Project root must be an existing directory.');
  const sourceRoot = path.join(packageRoot, 'skills', 'code-kb');
  if (!fs.existsSync(path.join(sourceRoot, 'SKILL.md'))) throw new Error('Packaged skills/code-kb/SKILL.md is missing.');
  const destination = path.join(projectRoot, '.agents', 'skills', 'code-kb');
  checkNoLinks(projectRoot, destination);
  if (fs.existsSync(destination) && !replace) throw new Error('Skill already exists. Review the update and rerun with --replace.');
  const files = collectFiles(sourceRoot);
  for (const relative of files) {
    const target = path.join(destination, relative);
    checkNoLinks(projectRoot, target);
    if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`Packaged file conflicts with a directory: ${relative}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of files) {
    const target = path.join(destination, relative);
    checkNoLinks(projectRoot, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, relative), target);
  }
  console.log(`Installed ${files.length} packaged files to ${destination}`);
  if (replace) console.log('Only packaged files were overwritten. Unrelated or obsolete files were retained; review them when upgrading.');
  if (fs.existsSync(path.join(projectRoot, 'code-kb.project.json')) || fs.existsSync(path.join(projectRoot, '.code-kb', 'manifest.json'))) {
    console.log('Existing project knowledge was preserved. Use the skill to read its source list and feature cards.');
  } else console.log('Use the skill to prepare a project knowledge folder and a relative code-kb.project.json entry.');
} catch (error) {
  fail(error.message);
}
