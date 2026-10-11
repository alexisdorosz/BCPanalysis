export interface SourceRef {
  url: string;
  fetchedAt: string;
  hash: string;
}
export type RuleTextNode =
  | { type: 'text'; text: string }
  | {
      type: 'element';
      tag:
        | 'span'
        | 'strong'
        | 'em'
        | 'br'
        | 'p'
        | 'div'
        | 'ul'
        | 'ol'
        | 'li'
        | 'table'
        | 'tbody'
        | 'thead'
        | 'tr'
        | 'td'
        | 'th'
        | 'sup'
        | 'sub'
        | 'a'
        | 'h4';
      children: RuleTextNode[];
      keyword?: boolean;
      spacer?: boolean;
      href?: string;
      colSpan?: number;
      rowSpan?: number;
    };
export interface RulePresentation {
  color?: string;
  reaction?: boolean;
  icon?:
    | 'Special'
    | 'Movement'
    | 'Defensive'
    | 'Offensive'
    | 'Shooting'
    | 'Rallying'
    | 'Control'
    | 'Damage';
  badge?: { kind: 'spell' | 'prayer' | 'command'; value: string };
  body: RuleTextNode[];
}
export interface Rule {
  id: string;
  name: string;
  timing?: string;
  declare?: string;
  effect?: string;
  restrictions?: string;
  text: string;
  keywords: string[];
  category: string;
  context: string;
  source: SourceRef;
  anchor?: string;
  presentation?: RulePresentation;
  richText?: RuleTextNode[];
}
export interface Candidate {
  key: string;
  name: string;
  url: string;
  anchor?: string;
  context?: string;
}
export interface ListChoice {
  id: string;
  name: string;
  kind:
    | 'formation'
    | 'spell-lore'
    | 'prayer-lore'
    | 'manifestation-lore'
    | 'terrain'
    | 'battle-tactics'
    | 'option';
  points?: number;
  unitId?: string;
  line: number;
}
export interface ParsedUnit {
  id: string;
  name: string;
  raw: string;
  line: number;
  regimentId: string;
  explicitCount?: number;
  points?: number;
  reinforced: boolean;
  general: boolean;
  componentOf?: string;
  options: ListChoice[];
}
export interface ParsedList {
  title: string;
  faction?: string;
  formation?: string;
  battlepack?: string;
  points?: number;
  limit?: number;
  drops?: number;
  regiments: { id: string; name: string; kind: 'regiment' | 'auxiliary' | 'renown' }[];
  units: ParsedUnit[];
  choices: ListChoice[];
  unparsed: { line: number; raw: string; reason: string }[];
  raw: string;
}
export interface Warscroll {
  name: string;
  source: SourceRef;
  move?: string;
  health?: string;
  save?: string;
  control?: string;
  ward?: string;
  unitSize?: number;
  points?: number;
  keywords: string[];
  weapons: {
    name: string;
    kind: 'ranged' | 'melee';
    values: Record<string, string>;
    abilities: string[];
  }[];
  rules: Rule[];
  notes: string[];
}
export interface Resolution {
  entryId: string;
  label: string;
  kind: 'faction' | 'unit' | ListChoice['kind'];
  status: 'resolved' | 'missing' | 'ambiguous' | 'unavailable';
  candidates: Candidate[];
  selected?: Candidate;
  message?: string;
}
export interface UnitStudy {
  unitId: string;
  warscroll?: Warscroll;
  modelCount?: number;
  countSource?: 'declared' | 'inferred';
  roles: string[];
  optionRules: Rule[];
}
export interface Study {
  schemaVersion: 1;
  eventId: string;
  playerId: string;
  contentHash: string;
  generatedAt: string;
  status: 'ready' | 'partial';
  parsed: ParsedList;
  armyRules: Rule[];
  selectedRules: { choice: ListChoice; rules: Rule[]; warscrolls?: Warscroll[] }[];
  units: UnitStudy[];
  resolutions: Resolution[];
  sources: SourceRef[];
  warnings: string[];
}
export interface Job {
  id: string;
  kind: 'import' | 'generate';
  state: 'running' | 'waiting-for-login' | 'completed' | 'failed' | 'cancelled';
  message: string;
  completed: number;
  total: number;
  eventId?: string;
  playerId?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
