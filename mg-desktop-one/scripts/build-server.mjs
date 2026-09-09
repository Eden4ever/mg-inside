import {build} from 'esbuild';
const options={bundle:true,platform:'node',format:'esm',external:['pg-native'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}};
await build({...options,entryPoints:['apps/server/src/main.ts'],outfile:'dist/server/main.mjs'});
await build({...options,entryPoints:['scripts/service-storage-admin.ts'],outfile:'dist/server/service-storage-admin.mjs'});
