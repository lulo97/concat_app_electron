const $ = window.jQuery;
const state = require('./state');
const { splitCsv } = require('./utils');
const { ALWAYS_SKIP } = require('./constants');

const getManualExcludes = () => splitCsv($('#excludeInput').val());
const getManualIncludes = () => splitCsv($('#includeInput').val());

/** Lowercased exclude set + include list, built once per scan. */
function getFilterContext() {
  const excludes = new Set(
    [...state.smartExcludes, ...getManualExcludes(), ...ALWAYS_SKIP].map((s) => s.toLowerCase()),
  );
  const includes = getManualIncludes().map((s) => s.toLowerCase());
  return { excludes, includes };
}

/** Empty includes = everything passes. Otherwise the file name or any parent folder name must match. */
function fileMatchesIncludes(filePath, includes) {
  if (!includes.length) return true;
  const parts = filePath.replace(/\\/g, '/').toLowerCase().split('/');
  return includes.some((inc) => parts.includes(inc));
}

/** Names present in BOTH includes and excludes (case-insensitive). */
function findConflicts() {
  const ex = new Set(getManualExcludes().map((s) => s.toLowerCase()));
  return getManualIncludes().filter((i) => ex.has(i.toLowerCase()));
}

module.exports = { getManualExcludes, getManualIncludes, getFilterContext, fileMatchesIncludes, findConflicts };
