// 隔离验证切换后故障处理；所有服务及文件操作均替换为桩函数。
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const source = readFileSync(resolve(__dirname, 'remote-deploy-stage1.sh'), 'utf8').replace(/\r/g, '');
const start = source.indexOf('rollback() {');
const end = source.indexOf('\ntrap rollback ERR', start);
assert(start >= 0 && end > start);
const script = `
release_switched=1
backup_root=/test-only-backup
systemctl() { printf 'SERVICE %s\\n' "$*"; }
mv() { echo UNSAFE_MOVE; return 99; }
ln() { echo UNSAFE_LINK; return 99; }
install() { echo UNSAFE_INSTALL; return 99; }
rm() { echo UNSAFE_REMOVE; return 99; }
${source.slice(start, end)}
(exit 7)
rollback
`;
const result = spawnSync('docker', ['exec', '-i', 'mg-expert-database-postgres-1', 'bash', '--noprofile', '--norc'], { input: script, encoding: 'utf8', timeout: 10_000 });
assert.ifError(result.error);
assert.equal(result.status, 7, result.stderr);
assert.match(result.stdout, /SERVICE stop mg-expert-database-api/);
assert.doesNotMatch(result.stdout, /UNSAFE_/);
assert.match(result.stderr, /authentication-compatible release/);
console.log('认证切换故障保护通过：停止 API、不恢复旧代码、不改动文件。');
