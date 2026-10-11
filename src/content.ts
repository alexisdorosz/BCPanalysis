import { isObject, stringValue, type Attachment, type CapturedContent, type JsonObject, type Player, type Support } from './types.js';

// Session credentials are never part of the corpus. Content fields remain unchanged.
const credentialKey = /(?:token|password|authorization|cookie|secret|credential)|^(?:pin|email)$/i;

function sanitise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitise);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !credentialKey.test(key))
    .map(([key, child]) => [key, sanitise(child)]));
}

export function describeShape(value: unknown, path = '', output: Record<string, string> = {}): Record<string, string> {
  if (path.split('.').length > 12) { output[path] = 'depth-limit'; return output; }
  if (Array.isArray(value)) {
    output[path || '$'] = 'array';
    for (const item of value.slice(0, 5)) describeShape(item, `${path}[]`, output);
  } else if (isObject(value)) {
    output[path || '$'] = 'object';
    for (const [key, child] of Object.entries(value)) {
      if (!credentialKey.test(key)) describeShape(child, path ? `${path}.${key}` : key, output);
    }
  } else {
    const type = value === null ? 'null' : typeof value;
    output[path || '$'] = output[path || '$'] && output[path || '$'] !== type ? 'mixed' : type;
  }
  return output;
}

export function captureContent(payload: unknown, player: Player, eventId: string): CapturedContent {
  if (!isObject(payload)) throw new Error('List response was not a JSON object.');
  const returnedId = stringValue(payload.id) ?? stringValue(payload.listId) ?? stringValue(payload.armyListObjectId);
  if (returnedId && player.listId && returnedId !== player.listId) throw new Error('The list identifier does not match the roster.');
  const returnedEvent = stringValue(payload.eventId) ?? (isObject(payload.event) ? stringValue(payload.event.id) : undefined);
  const returnedPlayer = stringValue(payload.playerId) ?? (isObject(payload.player) ? stringValue(payload.player.id) : undefined);
  if (returnedEvent && returnedEvent !== eventId) throw new Error('The list belongs to a different event.');
  if (returnedPlayer && returnedPlayer !== player.id) throw new Error('The list belongs to a different player.');

  // Preserve the original content, not expanded account/event information.
  const expansions = new Set(['event', 'user', 'player', 'army', 'faction', 'gameSystem', 'character', 'subFaction', 'analytics']);
  // Unknown top-level fields are retained so a newly encountered format can be investigated.
  const contentFields = Object.fromEntries(Object.entries(payload).filter(([key]) => !expansions.has(key)));
  const original = sanitise(contentFields) as JsonObject;
  const textVariants: CapturedContent['textVariants'] = [];
  const textCandidates: [string, unknown][] = [
    ['armyListText', payload.armyListText], ['listText', payload.listText],
    ['listInfo.listText', isObject(payload.listInfo) ? payload.listInfo.listText : undefined],
    ['text', payload.text], ['content', payload.content],
  ];
  for (const [field, value] of textCandidates) {
    if (typeof value === 'string') textVariants.push({ field, text: value });
  }
  const selected = textVariants.find(item => item.text.trim().length > 0);
  const attachments: Attachment[] = [];
  const seen = new Set<string>();
  const observedSupports = new Set<Support>();
  const nonEmpty = (value: unknown): boolean => value !== null && value !== undefined && value !== '' &&
    (!Array.isArray(value) || value.length > 0) && (!isObject(value) || Object.keys(value).length > 0);
  function findAttachments(value: unknown, field: string, inheritedKind?: Attachment['kind']): void {
    const kind = /image/i.test(field) ? 'image' : /file|attachment|document/i.test(field) ? 'file' : inheritedKind;
    if (kind && nonEmpty(value)) observedSupports.add(kind);
    if (typeof value === 'string' && kind) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
        const key = `${kind}:${value}`;
        if (!seen.has(key)) { seen.add(key); attachments.push({ kind, field, url: value }); }
      } catch { /* Other attachment properties are retained in original. */ }
    } else if (Array.isArray(value)) {
      value.forEach((child, index) => findAttachments(child, `${field}[${index}]`, kind));
    } else if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) findAttachments(child, field ? `${field}.${key}` : key, kind);
    }
  }
  findAttachments(original, '');
  if (typeof payload.listUrl === 'string') {
    try {
      const url = new URL(payload.listUrl);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
          !['www.bestcoastpairings.com', 'bestcoastpairings.com'].includes(url.hostname)) {
        attachments.push({ kind: 'external-link', field: 'listUrl', url: payload.listUrl });
      }
    } catch { /* Relative BCP links are identifiers, not external documents. */ }
  }
  const supports = new Set<Support>(observedSupports);
  if (selected) supports.add('text');
  for (const attachment of attachments) supports.add(attachment.kind);
  for (const [key, value] of Object.entries(original)) {
    if (/content|fusedDeck/i.test(key) && nonEmpty(value) && (isObject(value) || Array.isArray(value))) supports.add('structured');
  }
  if (!supports.size) supports.add('unknown');
  const notices: string[] = [];
  if (new Set(textVariants.map(item => item.text).filter(text => text.trim())).size > 1) {
    notices.push('Multiple different text fields were returned; all are retained. The first non-empty known field is inventoried.');
  }
  if (!selected) notices.push('No non-empty known text field was found. Review the archived original and payload shape.');
  if ([...supports].some(support => support !== 'text')) notices.push('Non-text content is archived by reference/structure only; it has not been interpreted.');
  return {
    listId: returnedId ?? player.listId, original, text: selected?.text, textField: selected?.field,
    textVariants, supports: [...supports], attachments, payloadShape: describeShape(original), notices,
  };
}
