const $ = window.jQuery;
const state = require('./state');
const { splitCsv } = require('./utils');
const { ALWAYS_SKIP } = require('./constants');

const getManualExcludes = () => splitCsv($('#excludeInput').val());
const getManualIncludes = () => splitCsv($('#includeInput').val());

/** Unify separators, lowercase, drop "./", duplicate and leading/trailing slashes. */
const normalizeTerm = (term) => String(term)
  .replace(/\\/g, '/')
  .toLowerCase()
  .replace(/^(?:\.\/+)+/, '')
  .replace(/\/+/g, '/')
  .replace(/^\/+|\/+$/g, '');

const termSegments = (term) => normalizeTerm(term).split('/').filter(Boolean);
const pathSegments = (p) => String(p).replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);

/** True if `seq` appears as a contiguous run of whole segments inside `parts`. */
function containsSequence(parts, seq) {
  if (!seq.length || seq.length > parts.length) return false;
  for (let i = 0; i <= parts.length - seq.length; i += 1) {
    let ok = true;
    for (let j = 0; j < seq.length; j += 1) {
      if (parts[i + j] !== seq[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Built once per scan.
 * excludes:     Set of single names (fast path, same as before)
 * pathExcludes: arrays of segments for terms that contain a separator
 * includes:     arrays of segments (single names or paths)
 */
function getFilterContext() {
  const excludes = new Set();
  const pathExcludes = [];
  for (const raw of [...state.smartExcludes, ...getManualExcludes(), ...ALWAYS_SKIP]) {
    const seg = termSegments(raw);
    if (seg.length === 1) excludes.add(seg[0]);
    else if (seg.length > 1) pathExcludes.push(seg);
  }
  const includes = getManualIncludes().map(termSegments).filter((seg) => seg.length);
  return { excludes, pathExcludes, includes };
}

/** Works for both files and directories (directories are pruned during the walk). */
function isExcluded(fullPath, name, ctx) {
  if (ctx.excludes.has(name.toLowerCase())) return true;
  if (!ctx.pathExcludes.length) return false;
  const parts = pathSegments(fullPath);
  return ctx.pathExcludes.some((seq) => containsSequence(parts, seq));
}

/** Empty includes = everything passes. Otherwise any term must match the file's path segments. */
function fileMatchesIncludes(filePath, includes) {
  if (!includes.length) return true;
  const parts = pathSegments(filePath);
  return includes.some((seq) => containsSequence(parts, seq));
}

/** Terms present in BOTH includes and excludes (separator/case-insensitive). */
function findConflicts() {
  const ex = new Set(getManualExcludes().map(normalizeTerm));
  return getManualIncludes().filter((i) => ex.has(normalizeTerm(i)));
}

module.exports = {
  getManualExcludes, getManualIncludes, getFilterContext,
  fileMatchesIncludes, findConflicts, isExcluded,
};