// test/gdscript-parser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGDScript } = require('../src/gdscript-parser');
const { summarizeGDScript } = require('../src/summarizer');

// ---------- Parser (unit) ----------

test('detects class_name and top-level extends', () => {
  const source = 'class_name Game\nextends Node\n';
  const { items } = parseGDScript(source);
  assert.deepEqual(items.map(([, t]) => t), [
    'C Game (global)',
    'I extends Node',
  ]);
});

test('detects a simple function with parameters and return type', () => {
  const source = 'func greet(name: String) -> void:\n    print(name)\n';
  const { items } = parseGDScript(source);
  assert.equal(items.length, 1);
  assert.equal(items[0][0], 1);
  assert.match(items[0][1], /^F greet\(name: String\)->void \(2L\)/);
});

test('detects static function with F* prefix', () => {
  const source = 'static func create() -> Customer:\n    return Customer.new()\n';
  const { items } = parseGDScript(source);
  assert.match(items[0][1], /^F\* create\(\)->Customer/);
});

test('detects signals, with and without parameter list', () => {
  const source = 'signal customer_arrived(customer: Dictionary)\nsignal customer_left\n';
  const { items } = parseGDScript(source);
  assert.deepEqual(items.map(([, t]) => t), [
    'S customer_arrived(customer: Dictionary)',
    'S customer_left',
  ]);
});

test('detects consts and vars, marking @export as E', () => {
  const source = [
    'const MAX_ORDERS = 10',
    'const DEFAULT_NAME: String = "guest"',
    '@export var speed: int = 5',
    '@export_range(0, 100) var capacity',
    'var health: float = 100.0',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  const types = items.map(([, t]) => t);
  assert.ok(types.includes('K MAX_ORDERS'));
  assert.ok(types.includes('K DEFAULT_NAME:String'));
  assert.ok(types.includes('E speed:int'));
  assert.ok(types.includes('E capacity'));
  assert.ok(types.includes('G health:float'));
});

test('tracks inner-class scope in method names', () => {
  const source = [
    'class InnerData:',
    '    var counter: int = 0',
    '    func increment() -> void:',
    '        counter += 1',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  const types = items.map(([, t]) => t);
  assert.ok(types.some((t) => /^C InnerData \(\d+L\)/.test(t)));
  assert.ok(types.some((t) => /^F InnerData\.increment\(\)->void/.test(t)));
});

test('local variables inside functions are excluded', () => {
  const source = [
    'var global_var: int = 1',
    'func do_something() -> void:',
    '    var local_var: int = 2',
    '    var another_local = 3',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  const types = items.map(([, t]) => t);
  assert.ok(types.includes('G global_var:int'));
  assert.ok(!types.some((t) => /local_var/.test(t)));
});

test('extracts ## doc comments immediately above a function', () => {
  const source = [
    '## Called when a new customer arrives.',
    '## Triggers the arrival animation.',
    'func on_customer_arrived():',
    '    pass',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  assert.match(items[0][1],
    /"Called when a new customer arrives\. Triggers the arrival animation\."/);
});

test('reports accurate line counts for functions', () => {
  const source = [
    'func short():',
    '    pass',
    '',
    'func long():',
    '    pass',
    '    pass',
    '    pass',
    '    pass',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  assert.match(items[0][1], /\(2L\)/); // lines 1-2
  assert.match(items[1][1], /\(5L\)/); // lines 4-8
});

test('detects enums with T prefix', () => {
  const source = 'enum State { IDLE, COOKING, SERVED }\n';
  const { items } = parseGDScript(source);
  assert.ok(items.some(([, t]) => t === 'T State'));
});

test('produces items sorted by source line number', () => {
  const source = [
    'signal first',
    'var x: int',
    'func a() -> void:',
    '    pass',
    'signal last',
    '',
  ].join('\n');
  const { items } = parseGDScript(source);
  const lines = items.map(([l]) => l);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

// ---------- Summarizer integration ----------

test('summarizeGDScript end-to-end produces expected block', () => {
  const source = [
    'class_name Player',
    'extends CharacterBody2D',
    '',
    'signal died',
    '',
    '@export var speed: int = 100',
    'const GRAVITY = 980',
    '',
    'func _physics_process(delta: float) -> void:',
    '    pass',
    '',
  ].join('\n');

  const out = summarizeGDScript(source, 'player.gd');

  // Header line of the block
  assert.match(out, /^@player\.gd \(\d+L\)$/m);
  // Each declaration
  assert.match(out, /C Player \(global\)/);
  assert.match(out, /I extends CharacterBody2D/);
  assert.match(out, /S died/);
  assert.match(out, /E speed:int/);
  assert.match(out, /K GRAVITY/);
  assert.match(out, /F _physics_process\(delta: float\)->void/);
});