export type LineKind = 'blank' | 'title' | 'faction' | 'section' | 'unit-candidate' | 'terrain-candidate' |
  'reinforcement' | 'general' | 'option' | 'configuration' | 'metadata' | 'source' | 'separator' | 'placeholder' | 'unclassified';

export type ObservationKind = 'pipe-header' | 'decorated-regiment-heading' | 'inline-option' | 'dash-point-cost' |
  'bare-point-cost' | 'model-count-prefix' | 'inline-terrain' | 'battle-tactic-label-variant' | 'renown-section' | 'literal-placeholder';

export interface ObservedLine {
  number: number;
  raw: string;
  kind: LineKind;
  section?: string;
  parentLine?: number;
  pointValues?: number[];
}

export interface FormatAnalysis {
  source: 'official-app' | 'war-nexus' | 'octolith' | 'unknown';
  language: 'English' | 'French' | 'mixed' | 'unknown';
  languageEvidence: string[];
  lineEnding: 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none';
  signature: string;
  conventions: { sections: string[]; labels: string[]; bullets: string[]; unitSyntax: string[] };
  counts: Partial<Record<LineKind, number>>;
  lines: ObservedLine[];
  ambiguities: { line: number; reason: string }[];
  observations: { kind: ObservationKind; line: number; raw: string }[];
}

// These are observations for parser design, not validated army/rules semantics.
export function analyseText(text: string, faction?: string): FormatAnalysis {
  const normalised = text.normalize('NFKC');
  const official = /Created with Warhammer Age of Sigmar|Cr[ée][ée] avec Warhammer Age of Sigmar/i.test(normalised);
  const nexus = /War\s*Nexus/i.test(normalised);
  const octolith = /[0O]ctolith/i.test(normalised);
  const source = nexus ? 'war-nexus' : official ? 'official-app' : octolith ? 'octolith' : 'unknown';
  const english = [...new Set(normalised.match(/General's Regiment|Spell Lore|Manifestation Lore|Faction Terrain|Reinforced|Battle Tactic Cards|Created with/gi) ?? [])];
  const french = [...new Set(normalised.match(/R[ée]giment du G[ée]n[ée]ral|Domaine de sorts|Domaine de manifestations|Terrain de faction|Renforc[ée]e?|Cr[ée][ée] avec/gi) ?? [])];
  const language = english.length && french.length ? 'mixed' : english.length ? 'English' : french.length ? 'French' : 'unknown';
  const endings = new Set((text.match(/\r\n|\r|\n/g) ?? []).map(ending => ending === '\r\n' ? 'CRLF' : ending === '\r' ? 'CR' : 'LF'));
  const lineEnding = endings.size > 1 ? 'mixed' : [...endings][0] ?? 'none';
  const sections = new Set<string>(), labels = new Set<string>(), bullets = new Set<string>(), unitSyntax = new Set<string>();
  const counts: FormatAnalysis['counts'] = {};
  const ambiguities: FormatAnalysis['ambiguities'] = [];
  const observations: FormatAnalysis['observations'] = [];
  const lines: ObservedLine[] = [];
  let section: string | undefined;
  let sectionType: 'regiment' | 'terrain' | undefined;
  let parentLine: number | undefined;
  let firstNonEmpty = true;
  for (const [index, raw] of text.split(/\r\n|\r|\n/).entries()) {
    const value = raw.trim();
    const n = index + 1;
    const observe = (kind: ObservationKind) => observations.push({ kind, line: n, raw });
    if (!section && value.includes('|') && !/^App:/i.test(value)) observe('pipe-header');
    if (/^(?:[- ]+)?(?:General['’]s Regiment|Regiment\s*#?\d+)(?:\s*[:–-]+)\s*$/i.test(value)) observe('decorated-regiment-heading');
    if (/\(\d[^)]*\)\s*[•●▪]/.test(value)) { observe('inline-option'); unitSyntax.add('Name (points) with inline options'); }
    if (/^[^-•].+?\s+--\s*\d+\s*$/.test(value)) { observe('dash-point-cost'); unitSyntax.add('Name -- points'); }
    if (/^[A-Za-zÀ-ÿ][^:|]*\s+\d{2,4}\s*$/.test(value) && !/^(?:Regiment|R[ée]giment|Drops|App|Points)/i.test(value)) { observe('bare-point-cost'); unitSyntax.add('Name points (candidate)'); }
    if (/^\d+\s*[x×]\s*\S/i.test(value)) observe('model-count-prefix');
    if (/^(?:Faction Terrain|Terrain de faction)\s*:\s*\S/i.test(value)) observe('inline-terrain');
    if (/^(?:Battle Tactics(?: Cards)?|Tactiques de bataille)\s*:/i.test(value)) observe('battle-tactic-label-variant');
    if (/^Regiments of Renown$/i.test(value)) observe('renown-section');
    const row: ObservedLine = { number: n, raw, kind: 'unclassified', section };
    const points = [...value.matchAll(/\((\d[\d, ]*)\s*(?:pts?|points)?\)/gi)].map(match => Number(match[1]!.replace(/[, ]/g, '')));
    if (points.length) row.pointValues = points;
    const bullet = /^([•●▪*+-])\s+(.+)$/.exec(value);
    const heading = /^(?:General['’]s Regiment|Regiment\s+\d+|Auxiliary Units|R[ée]giment du G[ée]n[ée]ral|R[ée]giment\s+\d+|Unit[ée]s auxiliaires)$/i.test(value);
    const terrain = /^(?:Faction Terrain|Terrain de faction)$/i.test(value);
    const label = /^(Drops|Spell Lore|Prayer Lore|Manifestation Lore|Battle Tactic Cards|Domaine de sorts|Domaine de pri[èe]res|Domaine de manifestations|Poses|Cartes de tactiques)(?:\s*[:–-])\s*(.*)$/i.exec(value);
    if (!value) row.kind = 'blank';
    else if (/^[-=_]{3,}$/.test(value)) row.kind = 'separator';
    else if (/^(?:undefined|null)$/i.test(value)) {
      row.kind = 'placeholder'; observe('literal-placeholder');
      ambiguities.push({ line: n, reason: 'Literal placeholder in the fetched text; retained unchanged, not interpreted as an army entry.' });
      parentLine = undefined;
    }
    else if (heading || terrain) {
      row.kind = 'section'; section = value; row.section = section;
      sections.add(value); sectionType = terrain ? 'terrain' : 'regiment'; parentLine = undefined;
    } else if (bullet) {
      bullets.add(bullet[1]!);
      row.kind = /^Reinforced$|^Renforc[ée]e?$/i.test(bullet[2]!) ? 'reinforcement' : /^General$|^G[ée]n[ée]ral$/i.test(bullet[2]!) ? 'general' : 'option';
      row.parentLine = parentLine;
      if (!parentLine) ambiguities.push({ line: n, reason: 'A modifier has no preceding unit/terrain candidate in this section.' });
    } else if (label) {
      labels.add(label[1]!); row.kind = /^Drops|^Poses/i.test(label[1]!) ? 'metadata' : 'configuration';
    } else if (/^(?:Created with|Cr[ée][ée] avec|App:|War\s*Nexus\b)/i.test(value)) {
      row.kind = 'source'; sectionType = undefined; parentLine = undefined;
    }
    else if (/^(?:General['’]s Handbook|Manuel du G[ée]n[ée]ral)/i.test(value)) row.kind = 'metadata';
    else if (faction && value.toLowerCase() === faction.trim().toLowerCase()) row.kind = 'faction';
    else if (sectionType === 'regiment' && /^.+?\s+\(\d[\d, ]*\s*(?:pts?|points)?\)\s*$/i.test(value)) {
      row.kind = 'unit-candidate'; parentLine = n; unitSyntax.add('Name (points)');
    } else if (sectionType === 'terrain') {
      row.kind = 'terrain-candidate'; parentLine = n;
      ambiguities.push({ line: n, reason: 'Terrain-section content requires confirmation against actual faction terrain names.' });
    } else if (firstNonEmpty) row.kind = 'title';
    else if (!section && points.length) {
      row.kind = 'configuration';
      ambiguities.push({ line: n, reason: 'A cost before the first regiment may describe a formation or another army choice.' });
    } else {
      // An unknown line breaks the candidate association rather than attaching later modifiers to an older unit.
      if (sectionType === 'regiment') parentLine = undefined;
      ambiguities.push({ line: n, reason: 'Unrecognised line; retained verbatim for parser design.' });
    }
    if (['source', 'separator', 'placeholder', 'metadata'].includes(row.kind)) delete row.pointValues;
    else if (points.length && row.kind !== 'unit-candidate') ambiguities.push({ line: n, reason: 'Separate point values are observed; inclusion in the listed total is not inferred.' });
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    lines.push(row);
    if (value) firstNonEmpty = false;
  }
  const conventions = { sections: [...sections], labels: [...labels], bullets: [...bullets], unitSyntax: [...unitSyntax] };
  return {
    source, language, languageEvidence: [...english, ...french], lineEnding: lineEnding as FormatAnalysis['lineEnding'],
    signature: JSON.stringify({ source, language, labels: [...labels].sort(), bullets: [...bullets].sort(), unitSyntax: [...unitSyntax].sort(), variants: [...new Set(observations.map(item => item.kind).filter(kind => kind !== 'literal-placeholder'))].sort() }),
    conventions, counts, lines, ambiguities, observations,
  };
}
