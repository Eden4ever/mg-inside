import {describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

describe('旧实现退出运行来源',()=>{
  it('生产环境不能启动测试目录中的 Node 后端',()=>{
    const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--eval',"import './apps/server/src/config.ts'"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production'},encoding:'utf8',windowsHide:true});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('旧 Node 目录仅供隔离测试');
  });
  it('默认构建不会生成旧后端，显式兼容构建才允许执行',()=>{
    const result=spawnSync(process.execPath,['scripts/build-server.mjs'],{encoding:'utf8',windowsHide:true});
    expect(result.status).not.toBe(0);expect(result.stderr).toContain('--compatibility');
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    expect(pkg.scripts.build).not.toContain('build-server');
    expect(readFileSync(resolve('../mg-platform/packages/frontend/services/client.ts'),'utf8')).not.toContain('catalog.json');
  });
});
