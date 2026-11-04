const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let contentSearch = '';
let andMode = false;
let wholeWord = false;
global.window = {
  jQuery: (selector) => ({
    val: () => selector === '#contentFilterInput' ? contentSearch : '',
    prop: () => selector === '#searchModeToggle' ? andMode : wholeWord,
  }),
};

const { readSearchSpec, fileMatches } = require('../src/matchers');
const tempDirPromise = fs.mkdtemp(path.join(os.tmpdir(), 'folder-concat-test-'));

async function createFile(name, content) {
  const dir = await tempDirPromise;
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

test('OR mode matches a keyword split across stream chunks', async () => {
  contentSearch = 'player';
  andMode = false;
  wholeWord = false;
  const file = await createFile('split.txt', `${'x'.repeat(64 * 1024 - 3)}player`);
  assert.equal(await fileMatches(file, readSearchSpec()), true);
});

test('AND mode requires every keyword, even across different chunks', async () => {
  contentSearch = 'player, score';
  andMode = true;
  wholeWord = false;
  const file = await createFile('and.txt', `${'x'.repeat(64 * 1024)}PLAYER${'y'.repeat(64 * 1024)}score`);
  assert.equal(await fileMatches(file, readSearchSpec()), true);

  const missing = await createFile('missing.txt', `${'x'.repeat(64 * 1024)}player`);
  assert.equal(await fileMatches(missing, readSearchSpec()), false);
});

test('whole-word mode rejects substrings but accepts a boundary-spanning word', async () => {
  contentSearch = 'player';
  andMode = false;
  wholeWord = true;
  const substring = await createFile('substring.txt', 'subplayer playerx players');
  assert.equal(await fileMatches(substring, readSearchSpec()), false);

  const boundary = await createFile('boundary.txt', `${'x'.repeat(64 * 1024 - 2)} player `);
  assert.equal(await fileMatches(boundary, readSearchSpec()), true);

  const falseBoundary = await createFile('false-boundary.txt', `${'x'.repeat(64 * 1024)}player `);
  assert.equal(await fileMatches(falseBoundary, readSearchSpec()), false);
});

test('an aborted search returns false', async () => {
  contentSearch = 'player';
  andMode = false;
  wholeWord = false;
  const file = await createFile('abort.txt', `${'x'.repeat(128 * 1024)}player`);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await fileMatches(file, readSearchSpec(), controller.signal), false);
});

test.after(async () => {
  const dir = await tempDirPromise;
  await fs.rm(dir, { recursive: true, force: true });
});

test('an empty search specification matches every file', async () => {
  contentSearch = ' ,  '; 
  andMode = false;
  wholeWord = false;
  const file = await createFile('empty-search.txt', 'no special keyword here');
  const spec = readSearchSpec();
  assert.equal(spec.matchers.length, 0);
  assert.equal(await fileMatches(file, spec), true);
});

test('stream search supports files larger than 50 MB', async () => {
  contentSearch = 'player';
  andMode = false;
  wholeWord = false;
  const file = await createFile('large-sparse.txt', '');
  const handle = await fs.open(file, 'w');
  try {
    const size = 50 * 1024 * 1024 + 32;
    await handle.truncate(size);
    await handle.write('player', 0, 'utf8', size - 6);
  } finally {
    await handle.close();
  }
  assert.equal(await fileMatches(file, readSearchSpec()), true);
});
