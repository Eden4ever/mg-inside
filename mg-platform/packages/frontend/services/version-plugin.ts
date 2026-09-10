import { createHash } from 'node:crypto';

/** 开发服务器与构建包共用版本格式，版本号为本次启动或构建的 UTC 时间。 */
export function applicationVersion(appId: string) {
  const version = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const metadata = { schemaVersion: 1, appId, version };
  return {
    name: 'application-version',
    configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/version.json') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(metadata));
      });
    },
    generateBundle(this: { emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void }, _options: unknown, bundle: Record<string, { type: string; source?: string | Uint8Array }>) {
      const index = bundle['index.html'];
      const indexSHA256 = index?.source ? createHash('sha256').update(index.source).digest('hex') : undefined;
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...metadata, indexSHA256 }) + '\n' });
    },
  };
}
