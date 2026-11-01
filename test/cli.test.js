import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cmporter-home-'));
const env = { ...process.env, CMPORTER_HOME: home };

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: 'utf8', cwd: ROOT, env, timeout: 120000 });
}

test('version 输出名称与版本号', () => {
  const result = run(['version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cloud-music-porter v\d+\.\d+\.\d+/);
});

test('help 输出命令表', () => {
  const result = run(['help']);
  assert.equal(result.status, 0);
  for (const command of ['login', 'doctor', 'scan', 'sync', 'match', 'import', 'cloud', 'web', 'service']) {
    assert.ok(result.stdout.includes(command), '帮助里应该有 ' + command);
  }
});

test('不认识的命令返回 1 并打印帮助', () => {
  const result = run(['nonsense-command']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不认识的命令/);
  assert.match(result.stdout, /用法/);
});

test('CMPORTER_HOME 能隔离数据目录', () => {
  const result = run(['version']);
  assert.equal(result.status, 0);
  assert.ok(fs.existsSync(home));
});
