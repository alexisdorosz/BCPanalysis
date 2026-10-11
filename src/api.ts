import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { eventFromUrl } from './bcp.js';
import { importEvent, type ImportOptions } from './collection-service.js';
import { generateStudy } from './generate-study.js';
import { StudyStore } from './study-store.js';
import type { Job } from './study-types.js';
import type { PageLoader } from './wahapedia.js';
import { safeId } from './types.js';

export interface ApiOptions {
  dataDir: string;
  profileDir: string;
  loader?: PageLoader;
  importer?: typeof importEvent;
}
export function createApi(options: ApiOptions) {
  const api = Fastify({ logger: false, bodyLimit: 64 * 1024 }),
    store = new StudyStore(options.dataDir);
  const jobs = new Map<string, { job: Job; abort: AbortController; promise?: Promise<void> }>();
  api.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0];
    if (!host || !['127.0.0.1', 'localhost'].includes(host))
      return reply.code(403).send({ error: 'This application accepts only local requests.' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`)
      return reply.code(403).send({ error: 'Cross-origin requests are not accepted.' });
    if (request.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Cross-site requests are not accepted.' });
  });
  api.setErrorHandler((error, _request, reply) => {
    reply
      .code(
        (error as { statusCode?: number }).statusCode ??
          ((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400),
      )
      .send({ error: (error as Error).message });
  });
  const start = (
    kind: Job['kind'],
    work: (job: Job, abort: AbortController) => Promise<unknown>,
    ids?: { eventId: string; playerId?: string },
  ) => {
    if (
      [...jobs.values()].some(
        (item) =>
          ['running', 'waiting-for-login'].includes(item.job.state) &&
          (kind === 'import'
            ? item.job.kind === 'import'
            : item.job.eventId === ids?.eventId && item.job.playerId === ids?.playerId),
      )
    )
      throw new Error('An operation for this import or list is already running.');
    const job: Job = {
      id: randomUUID(),
      kind,
      state: 'running',
      message: 'Starting…',
      completed: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      ...ids,
    };
    const abort = new AbortController(),
      item = { job, abort, promise: undefined as Promise<void> | undefined };
    jobs.set(job.id, item);
    item.promise = Promise.resolve()
      .then(() => work(job, abort))
      .then(() => {
        job.state = abort.signal.aborted ? 'cancelled' : 'completed';
        job.message = abort.signal.aborted
          ? 'Stopped. Saved work remains available.'
          : 'Completed.';
      })
      .catch((error) => {
        job.state = abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = (error as Error).message;
        job.message = abort.signal.aborted ? 'Stopped. Saved work remains available.' : job.error;
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });
    // Bounded in-memory history; checkpoints and sheets are stored on disk.
    if (jobs.size > 100)
      for (const [id, item] of jobs) {
        if (item.job.finishedAt) {
          jobs.delete(id);
          break;
        }
      }
    return job;
  };
  const generate = (eventId: string, playerId: string) =>
    start(
      'generate',
      (job, abort) =>
        generateStudy(store, eventId, playerId, {
          loader: options.loader,
          signal: abort.signal,
          progress: (message) => {
            job.message = message;
            job.completed++;
          },
        }),
      { eventId, playerId },
    );
  api.get('/api/events', () => store.events());
  api.get<{ Params: { eventId: string } }>('/api/events/:eventId', (request) =>
    store.roster(safeId(request.params.eventId)),
  );
  api.get<{ Params: { eventId: string; playerId: string } }>(
    '/api/events/:eventId/players/:playerId',
    (request) => store.player(safeId(request.params.eventId), safeId(request.params.playerId)),
  );
  api.post<{ Body: { url: string; refresh?: boolean; rosterOnly?: boolean } }>(
    '/api/imports',
    async (request, reply) => {
      const body = request.body;
      if (
        !body ||
        typeof body.url !== 'string' ||
        (body.refresh !== undefined && typeof body.refresh !== 'boolean') ||
        (body.rosterOnly !== undefined && typeof body.rosterOnly !== 'boolean')
      )
        throw new Error('Provide a BCP URL and optional boolean refresh / rosterOnly fields.');
      const eventId = eventFromUrl(body.url).id;
      const job = start(
        'import',
        (job, abort) =>
          (options.importer ?? importEvent)(body.url, {
            dataDir: options.dataDir,
            profileDir: options.profileDir,
            refresh: body.refresh,
            rosterOnly: body.rosterOnly,
            abort,
            progress: (message, completed, total, event, login) => {
              Object.assign(job, {
                message,
                completed,
                total,
                state: login ? 'waiting-for-login' : 'running',
                eventId: event?.id ?? eventId,
              });
            },
          } satisfies ImportOptions),
        { eventId },
      );
      return reply.code(202).send(job);
    },
  );
  api.post<{ Params: { eventId: string; playerId: string } }>(
    '/api/events/:eventId/players/:playerId/generate',
    async (request, reply) => {
      const { eventId, playerId } = request.params;
      const detail = await store.player(eventId, playerId);
      if (!detail.parsed) throw new Error('Collect a text list first.');
      return reply.code(202).send(generate(safeId(eventId), safeId(playerId)));
    },
  );
  api.post<{
    Params: { eventId: string; playerId: string };
    Body: { entryId: string; candidateKey: string };
  }>('/api/events/:eventId/players/:playerId/resolutions', async (request, reply) => {
    const { eventId, playerId } = request.params;
    if (
      !request.body ||
      typeof request.body.entryId !== 'string' ||
      typeof request.body.candidateKey !== 'string'
    )
      throw new Error('Provide an entry and candidate.');
    if (
      [...jobs.values()].some(
        (item) =>
          item.job.eventId === eventId && item.job.playerId === playerId && !item.job.finishedAt,
      )
    )
      throw new Error('Wait for the current generation to finish.');
    await store.confirm(
      safeId(eventId),
      safeId(playerId),
      request.body.entryId,
      request.body.candidateKey,
    );
    return reply.code(202).send(generate(eventId, playerId));
  });
  api.get('/api/jobs', () => [...jobs.values()].map((item) => item.job));
  api.post<{ Params: { jobId: string } }>('/api/jobs/:jobId/cancel', (request) => {
    const item = jobs.get(request.params.jobId);
    if (!item) throw new Error('Operation not found.');
    item.abort.abort();
    return item.job;
  });
  api.addHook('onClose', async () => {
    for (const item of jobs.values()) item.abort.abort();
    await Promise.allSettled([...jobs.values()].map((item) => item.promise));
  });
  return api;
}
