// parseArgs 单元测试。零依赖：node:test + assert，Node ≥18 直接跑。
// 覆盖回归点：kebab-case 驼峰化（--no-browser 修复）、值/布尔 flag、位置参数。
import { test } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '../lib/args.js';

test('--no-browser 解析为 noBrowser（kebab-case 驼峰化，回归 --no-browser bug）', () => {
  const { opts } = parseArgs(['onboard', '--no-browser']);
  assert.strictEqual(opts.noBrowser, true);
  assert.strictEqual(opts['no-browser'], undefined);
});

test('带值选项解析为对应驼峰键', () => {
  const { opts, rest } = parseArgs(['run', '--org', 'my-org', '--repo', 'npc-task', '写个脚本']);
  assert.strictEqual(opts.org, 'my-org');
  assert.strictEqual(opts.repo, 'npc-task');
  assert.deepStrictEqual(rest, ['run', '写个脚本']);
});

test('布尔 flag（--merge）不带值时置 true', () => {
  const { opts } = parseArgs(['run', '任务', '--merge']);
  assert.strictEqual(opts.merge, true);
});

test('--help / -h 都能识别', () => {
  assert.strictEqual(parseArgs(['--help']).opts.help, true);
  assert.strictEqual(parseArgs(['-h']).opts.help, true);
});

test('选项值不会吞掉下一个选项', () => {
  const { opts } = parseArgs(['--timeout', '--merge']);
  assert.strictEqual(opts.timeout, true); // --timeout 后面是 --merge，按布尔处理
  assert.strictEqual(opts.merge, true);
});

test('空参数不报错', () => {
  const { opts, rest } = parseArgs([]);
  assert.deepStrictEqual(opts, {});
  assert.deepStrictEqual(rest, []);
});
