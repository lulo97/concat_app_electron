// Shared mutable app state
module.exports = {
  folders: [],              // [{ path, enabled }]
  smartExcludes: new Set(), // active auto-exclude names
  seenNoise: new Set(),     // noise names already offered (so unchecked ones stay unchecked)
  excludedTypes: new Set(), // extensions the user excluded, e.g. ".css"
  detectedExts: [],
  abort: null,              // AbortController of the running task
};
