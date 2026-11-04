const fs = require('fs').promises;
const path = require('path');
const state = require('./state');
const { BINARY_EXTS, NOISE_MAP } = require('./constants');
const { getFilterContext, fileMatchesIncludes } = require('./filters');
const { readSearchSpec, fileMatches } = require('./matchers');
const { tick } = require('./utils');

async function readDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Recursive walk. Symlinks are skipped to prevent cycles and directory escapes. */
async function walkFiles(dir, ctx, signal, onFile, depth = 0, maxDepth = Infinity) {
  if (signal?.aborted || depth > maxDepth) return;
  for (const entry of await readDir(dir)) {
    if (signal?.aborted) return;
    if (entry.isSymbolicLink() || ctx.excludes.has(entry.name.toLowerCase())) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, ctx, signal, onFile, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      await onFile(fullPath, entry.name);
    }
  }
}

/** Find common generated/noisy names near the top of each selected folder. */
async function scanNoise(dirs, signal) {
  const found = new Set();
  const visit = async (dir, depth) => {
    if (signal?.aborted || depth > 3) return;
    for (const entry of await readDir(dir)) {
      if (signal?.aborted) return;
      const canonical = NOISE_MAP.get(entry.name.toLowerCase());
      if (canonical) {
        found.add(canonical);
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(path.join(dir, entry.name), depth + 1);
      }
    }
  };
  for (const dir of dirs) {
    if (signal?.aborted) break;
    await visit(dir, 0);
  }
  return found;
}

/**
 * Detect extensions that remain after folder/name filters AND content search.
 * Excluded extensions are still listed so users can re-enable them.
 */
async function scanExtensions(dirs, signal) {
  const ctx = getFilterContext();
  const spec = readSearchSpec();
  const extensions = new Set();
  let examined = 0;

  for (const dir of dirs) {
    if (signal?.aborted) break;
    await walkFiles(dir, ctx, signal, async (fullPath, name) => {
      if (signal?.aborted) return;
      const ext = path.extname(name).toLowerCase();
      if (!ext || BINARY_EXTS.has(ext) || !fileMatchesIncludes(fullPath, ctx.includes)) return;
      examined += 1;
      if (examined % 30 === 0) await tick();
      if (!spec.matchers.length || await fileMatches(fullPath, spec, signal)) extensions.add(ext);
    });
  }
  return extensions;
}

/** All files passing excludes, includes, file-type, and content filters. */
async function getFiles(signal, onStatus) {
  const ctx = getFilterContext();
  const seen = new Set();
  const files = [];

  for (const folder of state.folders.filter((item) => item.enabled)) {
    if (signal?.aborted) return [];
    await walkFiles(folder.path, ctx, signal, (fullPath, name) => {
      const ext = path.extname(name).toLowerCase();
      if (BINARY_EXTS.has(ext) || state.excludedTypes.has(ext)) return;
      if (!fileMatchesIncludes(fullPath, ctx.includes)) return;
      const normalized = path.resolve(fullPath).toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      files.push(fullPath);
    });
  }

  if (signal?.aborted) return [];
  const spec = readSearchSpec();
  if (!spec.matchers.length) return files;

  const matchingFiles = [];
  for (let i = 0; i < files.length; i += 1) {
    if (signal?.aborted) return [];
    if (i % 15 === 0) {
      onStatus?.(`Searching contents... ${i + 1}/${files.length}`);
      await tick();
    }
    if (await fileMatches(files[i], spec, signal)) matchingFiles.push(files[i]);
  }
  return matchingFiles;
}

module.exports = { walkFiles, scanNoise, scanExtensions, getFiles };
