import { resolve } from 'node:path';
import { FilesStore } from './store.ts';
import { createFilesServer } from './http.ts';
function limit(key: string, fallback: number) { const number = Number(process.env[key] || fallback); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${key} 必须为正整数`); return number; }
const store = new FilesStore(resolve(process.env.FILES_STORAGE_DIR || '.runtime/files'), limit('FILES_MAX_FILE_BYTES', 50 * 1024 ** 2), limit('FILES_USER_QUOTA_BYTES', 1024 ** 3));
await store.initialize();
const port = limit('FILES_PORT', 14350);
createFilesServer(store).listen(port, process.env.FILES_HOST || '127.0.0.1', () => console.log(`文件服务已启动 http://127.0.0.1:${port}`));

