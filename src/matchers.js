const fs = require('fs');
const { StringDecoder } = require('string_decoder');
const $ = window.jQuery;
const { escapeRegex } = require('./utils');

/** Read the current content-search controls into a reusable search specification. */
function readSearchSpec() {
  const keywords = String($('#contentFilterInput').val() || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const wholeWord = $('#wholeWordToggle').prop('checked');
  const matchAll = $('#searchModeToggle').prop('checked');
  const matchers = keywords.map((keyword) => {
    const source = escapeRegex(keyword);
    return new RegExp(
      wholeWord ? `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])` : source,
      wholeWord ? 'iu' : 'i',
    );
  });
  return { keywords, matchers, matchAll, wholeWord };
}

/**
 * Stream-search a file without loading the entire file into memory.
 * The rolling overlap catches keywords split across read chunks, including
 * whole-word boundary characters. Files larger than 50 MB are supported.
 */
function fileMatches(filePath, spec, signal) {
  if (!spec.matchers.length) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let pending = '';
    const found = new Array(spec.matchers.length).fill(false);
    const overlap = Math.max(4, ...spec.keywords.map((keyword) => keyword.length + 2));
    const decoder = new StringDecoder('utf8');
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (result !== undefined) stream.destroy();
      resolve(Boolean(result));
    };

    const isResolved = () => spec.matchAll
      ? found.every(Boolean)
      : found.some(Boolean);

    const inspect = (final = false) => {
      const safeStartLimit = final ? pending.length : Math.max(0, pending.length - overlap);
      for (let i = 0; i < spec.matchers.length; i += 1) {
        if (found[i]) continue;
        const matcher = spec.matchers[i];
        matcher.lastIndex = 0;
        let match;
        while ((match = matcher.exec(pending)) !== null) {
          if (final || match.index < safeStartLimit) {
            found[i] = true;
            break;
          }
          break;
        }
      }

      if (isResolved()) {
        finish(true);
        return;
      }
      if (final) {
        finish(false);
        return;
      }
      if (safeStartLimit > 0) pending = pending.slice(Math.max(0, safeStartLimit - 1));
    };

    const onAbort = () => finish(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      if (settled) return;
      pending += decoder.write(chunk);
      inspect(false);
    });
    stream.on('end', () => {
      if (settled) return;
      pending += decoder.end();
      inspect(true);
    });
    stream.on('error', () => finish(false));
    if (signal?.aborted) onAbort();
  });
}

module.exports = { readSearchSpec, fileMatches };
