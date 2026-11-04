const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRelevant } = require('../src/extractor');

const matchers = [/player/i];
const baseOptions = {
  mode: 'context',
  context: 2,
  smallFile: 0,
  keepHead: 0,
  lineNumbers: true,
};

test('context mode keeps matching lines and surrounding context with original line numbers', () => {
  const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  content[9] = 'player.update()';
  const result = extractRelevant(content.join('\n'), 'game.py', matchers, baseOptions);

  assert.equal(result.total, 20);
  assert.equal(result.shown, 5);
  assert.match(result.text, /\.\.\. \[lines 1-7 omitted\] \.\.\./);
  assert.match(result.text, /10: player\.update\(\)/);
  assert.match(result.text, /\.\.\. \[lines 13-20 omitted\] \.\.\./);
});

test('block mode extracts the enclosing Python function and stops before the next function', () => {
  const lines = [
    'import math',
    '',
    'class Game:',
    '    def update(self, dt):',
    '        self.player.move(dt)',
    '        self.score += 1',
    '',
    '    def reset(self):',
    '        self.player = None',
    '',
    'def unrelated():',
    '    return 1',
  ];
  const result = extractRelevant(lines.join('\n'), 'game.py', matchers, {
    ...baseOptions,
    mode: 'block',
    smallFile: 0,
    context: 1,
  });

  assert.match(result.text, /4:     def update\(self, dt\):/);
  assert.match(result.text, /5:         self\.player\.move\(dt\)/);
  assert.doesNotMatch(result.text, /def unrelated/);
});

test('block mode extracts a JS method with nested control blocks, not the control block alone', () => {
  const lines = [
    'class Game {',
    '  update(dt) {',
    '    if (dt > 0) {',
    '      this.player.move(dt);',
    '    }',
    '    this.score += 1;',
    '  }',
    '  reset() {',
    '    this.player = null;',
    '  }',
    '}',
    'function outside() {',
    '  return 2;',
    '}',
  ];
  const result = extractRelevant(lines.join('\n'), 'game.js', matchers, {
    ...baseOptions,
    mode: 'block',
    smallFile: 0,
  });

  assert.match(result.text, /2:   update\(dt\) \{/);
  assert.match(result.text, /4:       this\.player\.move\(dt\);/);
  assert.match(result.text, /6:     this\.score \+= 1;/);
  assert.doesNotMatch(result.text, /function outside/);
});

test('block mode captures multiline Allman-style method signatures', () => {
  const lines = [
    'class Game',
    '{',
    '  update(',
    '    dt,',
    '    player',
    '  )',
    '  {',
    '    player.move(dt);',
    '  }',
    '}',
    ...Array.from({ length: 170 }, (_, index) => `const unused${index} = ${index};`),
  ];
  const result = extractRelevant(lines.join('\n'), 'game.js', matchers, {
    ...baseOptions,
    mode: 'block',
    smallFile: 0,
  });

  assert.match(result.text, /3:   update\(/);
  assert.match(result.text, /8:     player\.move\(dt\);/);
});

test('unknown file types fall back to context mode', () => {
  const content = Array.from({ length: 12 }, (_, index) => `row ${index + 1}`);
  content[5] = 'player = "ready"';
  const result = extractRelevant(content.join('\n'), 'notes.txt', matchers, {
    ...baseOptions,
    mode: 'block',
  });
  assert.equal(result.shown, 5);
  assert.match(result.text, /6: player = "ready"/);
});

test('small files remain whole and full mode never trims', () => {
  const content = 'first\nplayer\nlast';
  const small = extractRelevant(content, 'small.py', matchers, {
    ...baseOptions,
    mode: 'block',
    smallFile: 3,
  });
  const full = extractRelevant(content, 'small.py', matchers, {
    ...baseOptions,
    mode: 'full',
    smallFile: 0,
  });

  assert.equal(small.text, content);
  assert.equal(small.trimmed, false);
  assert.equal(full.text, content);
});

test('keep-head lines are merged into the selected regions', () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  lines[20] = 'player.update()';
  const result = extractRelevant(lines.join('\n'), 'game.py', matchers, {
    ...baseOptions,
    keepHead: 3,
  });
  assert.match(result.text, /1: line 1/);
  assert.match(result.text, /3: line 3/);
  assert.match(result.text, /21: player\.update\(\)/);
});

test('AND-mode extraction includes regions for each matching keyword', () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  lines[5] = 'player.update()';
  lines[30] = 'score += points';
  const result = extractRelevant(lines.join('\n'), 'game.py', [/player/i, /score/i], {
    ...baseOptions,
    context: 1,
  });

  assert.match(result.text, /6: player\.update\(\)/);
  assert.match(result.text, /31: score \+= points/);
  assert.match(result.text, /\.\.\. \[lines 8-29 omitted\] \.\.\./);
});
