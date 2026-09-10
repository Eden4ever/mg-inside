import {build} from 'esbuild';
if (!process.argv.includes('--compatibility')) throw new Error('旧 Node 后端已退出常规构建；对照测试请显式传入 --compatibility，运行服务使用 Java 内核');
const options={bundle:true,platform:'node',format:'esm',external:['pg-native'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}};
await build({...options,entryPoints:['apps/server/src/main.ts'],outfile:'dist/server/main.mjs'});
await build({...options,entryPoints:['scripts/service-storage-admin.ts'],outfile:'dist/server/service-storage-admin.mjs'});
