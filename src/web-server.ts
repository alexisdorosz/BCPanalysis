import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

export function serveWeb(api: FastifyInstance, directory = resolve('dist')): void {
  const root = resolve(directory);
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
  };
  api.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/'))
      return reply.code(404).send({ error: 'API endpoint not found.' });
    const path = resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]!));
    if (!path.startsWith(root + sep) && path !== root) return reply.code(404).send();
    try {
      return reply
        .type(mime[extname(path)] ?? 'application/octet-stream')
        .send(await readFile(path));
    } catch {
      if (extname(path)) return reply.code(404).send();
      return reply.type(mime['.html']!).send(await readFile(resolve(root, 'index.html')));
    }
  });
  api.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
}
