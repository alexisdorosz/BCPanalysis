export type JsonObject = Record<string, unknown>;

export interface Player {
  id: string;
  name: string;
  faction?: string;
  updatedAt?: string;
  dropped: boolean;
  listId?: string;
  listUrl?: string;
}

export interface EventSnapshot {
  schemaVersion: 1;
  id: string;
  url: string;
  name: string;
  collectedAt: string;
  metadata: JsonObject;
  players: Player[];
}

export type Status = 'pending' | 'collected' | 'absent' | 'inaccessible' | 'unsupported' | 'error';
export type Support = 'text' | 'image' | 'file' | 'external-link' | 'structured' | 'unknown';

export interface Attachment {
  kind: 'image' | 'file' | 'external-link';
  field: string;
  url: string;
}

export interface CapturedContent {
  listId?: string;
  original: JsonObject;
  text?: string;
  textField?: string;
  textVariants: { field: string; text: string }[];
  supports: Support[];
  attachments: Attachment[];
  payloadShape: Record<string, string>;
  notices: string[];
}

export interface ArchiveContent extends CapturedContent {
  schemaVersion: 1;
  eventId: string;
  playerId: string;
  collectedAt: string;
}

export interface CollectionRecord {
  schemaVersion: 1;
  eventId: string;
  player: Player;
  status: Status;
  attemptedAt: string;
  reason?: string;
  httpStatus?: number;
  supports?: Support[];
  archivePath?: string;
  textPath?: string;
  contentHash?: string;
}

export interface ReadResult {
  status: 'ok' | 'denied' | 'error';
  httpStatus?: number;
  payload?: unknown;
  reason?: string;
  loginRequired?: boolean;
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid BCP identifier.');
  return value;
}
