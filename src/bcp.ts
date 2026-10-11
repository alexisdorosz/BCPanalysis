import { isObject, safeId, stringValue, type EventSnapshot, type JsonObject, type Player } from './types.js';

export const BCP_SITE = 'https://www.bestcoastpairings.com';
export const BCP_API = 'https://newprod-api.bestcoastpairings.com/v1';

export function eventFromUrl(input: string): { id: string; url: string } {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Expected a BCP event URL.'); }
  const match = /^\/event\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || !['bestcoastpairings.com', 'www.bestcoastpairings.com'].includes(url.hostname) ||
      url.port || url.username || url.password || !match?.[1]) {
    throw new Error('Expected https://www.bestcoastpairings.com/event/<event-id>.');
  }
  const id = safeId(match[1]);
  return { id, url: `${BCP_SITE}/event/${id}?active_tab=roster` };
}

export type GetJson = (path: string, params?: Record<string, string>) => Promise<unknown>;

export function publicClient(timeoutMs: number, signal?: AbortSignal): GetJson {
  return async (path, params = {}) => {
    const url = new URL(`${BCP_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      headers: { 'client-id': 'web-app', Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`BCP public read failed (HTTP ${response.status}). ${
        response.status === 429 ? 'Rate limited; retry later.' : 'No credentials or alternative access were attempted.'
      }`);
    }
    return response.json();
  };
}

function playerFromPayload(value: unknown): Player {
  if (!isObject(value) || !stringValue(value.id)) throw new Error('BCP returned a player without an identifier.');
  const user = isObject(value.user) ? value.user : {};
  const faction = isObject(value.faction) ? value.faction : isObject(value.army) ? value.army : {};
  const name = [stringValue(value.firstName) ?? stringValue(user.firstName), stringValue(value.lastName) ?? stringValue(user.lastName)]
    .filter(Boolean).join(' ').trim() || `Player ${value.id}`;
  const listUrl = stringValue(value.listUrl);
  let listId = stringValue(value.listId) ?? stringValue(value.armyListObjectId) ?? stringValue(value.armyListId);
  if (!listId && listUrl) {
    try {
      const url = new URL(listUrl, BCP_SITE);
      if (['www.bestcoastpairings.com', 'bestcoastpairings.com'].includes(url.hostname)) {
        listId = /^\/(?:legacy\/)?list\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
      }
    } catch { /* An invalid link is retained and reported, not followed. */ }
  }
  return {
    id: safeId(value.id as string), name,
    faction: stringValue(faction.name) ?? stringValue(value.armyName),
    updatedAt: stringValue(value.updated_at), dropped: value.dropped === true,
    listId: listId ? safeId(listId) : undefined, listUrl,
  };
}

export async function fetchRoster(eventId: string, get: GetJson): Promise<Player[]> {
  const players = new Map<string, Player>();
  const cursors = new Set<string>();
  let nextKey: string | undefined;
  for (let page = 0; page < 500; page++) {
    const params: Record<string, string> = { eventId: safeId(eventId), limit: '100' };
    if (nextKey) params.nextKey = nextKey;
    const payload = await get('/players', params);
    if (!isObject(payload) || !Array.isArray(payload.data)) throw new Error('Unexpected BCP roster response; expected data[].');
    for (const entry of payload.data) {
      const player = playerFromPayload(entry);
      players.set(player.id, player);
    }
    nextKey = stringValue(payload.nextKey);
    if (!nextKey || payload.data.length === 0) return [...players.values()];
    if (cursors.has(nextKey)) throw new Error('BCP repeated a pagination cursor; refusing to archive an incomplete roster.');
    cursors.add(nextKey);
  }
  throw new Error('BCP roster pagination exceeded 500 pages; collection stopped.');
}

export async function fetchEvent(input: string, get: GetJson): Promise<EventSnapshot> {
  const { id, url } = eventFromUrl(input);
  const payload = await get(`/events/${id}`);
  if (!isObject(payload)) throw new Error('Unexpected BCP event response.');
  if (payload.id !== id) throw new Error('BCP returned a different event identifier.');
  if (payload.hideRoster === true || (isObject(payload.flags) && payload.flags.hideRoster === true)) {
    throw new Error('The event roster is hidden; collection stopped.');
  }
  const metadata: JsonObject = {};
  for (const key of ['eventDate', 'eventEndDate', 'description', 'gameSystemName', 'gameSystemId', 'hideLists', 'hideRoster', 'flags', 'listOptions', 'updated_at']) {
    if (key in payload) metadata[key] = payload[key];
  }
  return {
    schemaVersion: 1, id, url, name: stringValue(payload.name) ?? id,
    collectedAt: new Date().toISOString(), metadata, players: await fetchRoster(id, get),
  };
}

export function listsHidden(event: EventSnapshot): boolean {
  return event.metadata.hideLists === true || (isObject(event.metadata.flags) && event.metadata.flags.hideLists === true);
}

export function listPageUrl(player: Player): { kind: 'bcp' | 'external' | 'invalid'; url?: string } {
  if (player.listUrl) {
    try {
      const url = new URL(player.listUrl, BCP_SITE);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { kind: 'invalid' };
      if (!['www.bestcoastpairings.com', 'bestcoastpairings.com'].includes(url.hostname)) return { kind: 'external', url: url.href };
      const id = /^\/(?:legacy\/)?list\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
      if (!id || (player.listId && id !== player.listId)) return { kind: 'invalid' };
      return { kind: 'bcp', url: `${BCP_SITE}${url.pathname}` };
    } catch { return { kind: 'invalid' }; }
  }
  return player.listId ? { kind: 'bcp', url: `${BCP_SITE}/list/${safeId(player.listId)}` } : { kind: 'invalid' };
}
