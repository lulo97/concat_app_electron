const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const controls = {
  '#excludeInput': '',
  '#includeInput': '',
  '#contentFilterInput': 'player',
  '#searchModeToggle': false,
  '#wholeWordToggle': false,
};
global.window = {
  jQuery: (selector) => ({
    val: function (value) {
      if (arguments.length) controls[selector] = value;
      return controls[selector] ?? '';
    },
    prop: () => controls[selector] ?? false,
  }),
};

const state = require('../src/state');
const { getFiles, scanExtensions } = require('../src/scanner');
const fixturePromise = fs.mkdtemp(path.join(os.tmpdir(), 'folder-concat-scan-'));

async function writeFixture(relativePath, content) {
  const root = await fixturePromise;
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  return fullPath;
}

test('file scan applies content, noise, include, and binary-extension filters', async () => {
  const root = await fixturePromise;
  const matching = await writeFixture('src/game.py', 'class Game:\n    player = True\n');
  await writeFixture('src/notes.py', 'class Notes:\n    score = 5\n');
  await writeFixture('node_modules/pkg/index.js', 'const player = true;');
  await writeFixture('assets/image.png', 'not really an image');
  await writeFixture('src/.concatignore', '{"contentSearch":"x"}');

  state.folders = [{ path: root, enabled: true }];
  state.smartExcludes = new Set(['node_modules']);
  state.excludedTypes = new Set();
  controls['#contentFilterInput'] = 'player';
  controls['#includeInput'] = '';
  controls['#excludeInput'] = '';

  const files = await getFiles(new AbortController().signal);
  assert.deepEqual(files, [matching]);
});

test('detected extensions reflect content search and manual includes', async () => {
  const root = await fixturePromise;
  await writeFixture('src/player.py', 'player.update()');
  await writeFixture('src/score.js', 'score += 1;');
  await writeFixture('docs/player.md', 'player guide');

  state.folders = [{ path: root, enabled: true }];
  state.smartExcludes = new Set(['node_modules']);
  controls['#contentFilterInput'] = 'player';
  controls['#includeInput'] = 'src';
  controls['#excludeInput'] = '';

  const extensions = await scanExtensions([root], new AbortController().signal);
  assert.deepEqual([...extensions].sort(), ['.py']);
});

test('aborted scans return no files', async () => {
  const root = await fixturePromise;
  state.folders = [{ path: root, enabled: true }];
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await getFiles(controller.signal), []);
});

test.after(async () => {
  const root = await fixturePromise;
  await fs.rm(root, { recursive: true, force: true });
});
