import { resolve } from 'node:path';
import { build } from 'vite';
import { createApi } from './api.js';
import { assertSeparateDirectories } from './archive.js';
import { serveWeb } from './web-server.js';

const dataDir = resolve(process.env.BCP_DATA_DIR ?? 'data'),
  profileDir = resolve(process.env.BCP_PROFILE_DIR ?? '.local/bcp-profile');
assertSeparateDirectories(dataDir, profileDir);
await build({ configFile: resolve('vite.config.ts'), logLevel: 'warn' });
const api = createApi({ dataDir, profileDir });
serveWeb(api);
const port = Number(process.env.BCP_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('BCP_PORT must be between 1024 and 65535.');
await api.listen({ host: '127.0.0.1', port });
console.log(`Roster study is ready at http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void api.close().then(() => process.exit(0));
  });
