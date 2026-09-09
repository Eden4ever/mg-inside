import fs from 'node:fs';

fs.writeFileSync(new URL('../packages/contracts/dist/package.json', import.meta.url), '{"type":"commonjs"}\n', 'utf8');
