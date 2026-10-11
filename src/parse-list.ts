import type { ListChoice, ParsedList, ParsedUnit } from './study-types.js';

export function normaliseName(value: string): string {
  let name = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bsoa\b\s*:?/g, 'scourge of aqshy ')
    .replace(/\bsog\b\s*:?/g, 'scourge of ghyran ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const variant = /\bscourge of (aqshy|ghyran)\b/.exec(name);
  if (variant) name = `${variant[0]} ${name.replace(variant[0], '').trim()}`;
  return name.replace(/ +/g, ' ');
}
function stripCost(value: string): { name: string; points?: number } {
  const cost =
    /\s*(?:-\s*)?\((\d+)\s*(?:pts?|points)?\)\s*(?:pts?|points)?\s*$/i.exec(value) ??
    /\s+--\s*(\d+)\s*$/.exec(value);
  return {
    name: (cost ? value.slice(0, cost.index) : value).trim(),
    points: cost ? Number(cost[1]) : undefined,
  };
}

export function parseList(raw: string, rosterFaction?: string): ParsedList {
  const result: ParsedList = {
    title: 'Army list',
    faction: rosterFaction,
    raw,
    regiments: [],
    units: [],
    choices: [],
    unparsed: [],
  };
  let regiment: ParsedList['regiments'][number] | undefined;
  let lastUnit: ParsedUnit | undefined;
  let terrainSection = false,
    afterSource = false,
    sawTitle = false,
    sawFaction = false;
  const choice = (
    name: string,
    kind: ListChoice['kind'],
    line: number,
    unit?: ParsedUnit,
  ): ListChoice => {
    const parsed = stripCost(name);
    const item: ListChoice = {
      id: `choice-${line}-${result.choices.length}`,
      ...parsed,
      kind,
      line,
      unitId: unit?.id,
    };
    result.choices.push(item);
    unit?.options.push(item);
    return item;
  };
  const modifier = (text: string, line: number): void => {
    const value = text
      .replace(/^(?:[•●▪*]|--?)\s*/, '')
      .replace(/^Options?:\s*/i, '')
      .trim();
    if (!lastUnit) {
      result.unparsed.push({ line, raw: text, reason: 'Option without an identified unit.' });
      return;
    }
    if (/^Reinforced$|^Renforc[ée]e?$/i.test(value)) lastUnit.reinforced = true;
    else if (/^General$|^G[ée]n[ée]ral$/i.test(value)) lastUnit.general = true;
    else if (value) choice(value, 'option', line, lastUnit);
  };
  const lines = raw.split(/\r\n|\r|\n/);
  for (const [index, original] of lines.entries()) {
    const line = index + 1,
      text = original.trim();
    if (
      !text ||
      /^[-=_]{3,}$/.test(text) ||
      /^```/.test(text) ||
      /^(?:undefined|null)$/i.test(text)
    )
      continue;
    if (
      /^(Created with|Cr[ée][ée] avec|App:|App Version:|Server Version:|Data Version:|War\s*Nexus)/i.test(
        text,
      )
    ) {
      afterSource = true;
      continue;
    }
    if (afterSource) {
      result.unparsed.push({
        line,
        raw: original,
        reason: 'Unrecognised text after the export footer.',
      });
      continue;
    }
    const heading = text
      .replace(/^[-=]+\s*/, '')
      .replace(/\s*[-=:]+$/, '')
      .trim();
    if (
      /^(?:General['’]s Regiment|Regiment\s*#?\s*\d+|R[ée]giment du G[ée]n[ée]ral|R[ée]giment\s*#?\s*\d+|Auxiliary Units|Unit[ée]s auxiliaires|Regiments of Renown)$/i.test(
        heading,
      )
    ) {
      const kind = /renown/i.test(heading)
        ? 'renown'
        : /auxili/i.test(heading)
          ? 'auxiliary'
          : 'regiment';
      regiment = { id: `regiment-${line}`, name: heading, kind };
      result.regiments.push(regiment);
      terrainSection = false;
      lastUnit = undefined;
      continue;
    }
    if (/^REGIMENTS$/i.test(heading)) continue;
    if (/^(?:Faction Terrain|Terrain de faction)\s*:?$/i.test(text)) {
      terrainSection = true;
      regiment = undefined;
      lastUnit = undefined;
      continue;
    }
    if (/^(?:[•●▪*]|--?)\s*\S/.test(text)) {
      modifier(text, line);
      continue;
    }
    const meta = /^([^:]+?)\s*:\s*(.+)$/.exec(text);
    const lore =
      /^(Spell Lore|Prayer Lore|Manifestation Lore|Domaine de sorts|Domaine de pri[èe]res|Domaine de manifestations)\s*[-:]\s*(.+)$/i.exec(
        text,
      );
    if (lore) {
      const key = normaliseName(lore[1]!);
      choice(
        lore[2]!,
        /manifest/.test(key)
          ? 'manifestation-lore'
          : /prayer|prieres/.test(key)
            ? 'prayer-lore'
            : 'spell-lore',
        line,
      );
      continue;
    }
    if (meta) {
      const key = normaliseName(meta[1]!);
      if (
        /^(?:battle tactic(?:s)?(?: cards)?|tactiques de bataille|cartes de tactiques)$/.test(key)
      ) {
        choice(meta[2]!, 'battle-tactics', line);
        continue;
      }
      if (/^(?:faction terrain|terrain de faction)$/.test(key)) {
        choice(meta[2]!, 'terrain', line);
        continue;
      }
      if (key === 'faction') {
        result.faction = meta[2]!.trim();
        sawFaction = true;
        continue;
      }
      if (/^(?:formation|battle formation|army of renown)$/.test(key)) {
        result.formation = stripCost(meta[2]!).name;
        choice(meta[2]!, 'formation', line);
        continue;
      }
      if (/^(?:drops|poses)$/.test(key)) {
        result.drops = Number(/\d+/.exec(meta[2]!)?.[0]);
        continue;
      }
      if (key === 'wounds') continue;
    }
    const total = /(\d+)\s*\/\s*(\d+)\s*(?:pts|points)?/i.exec(text);
    if (!regiment && total) {
      result.points = Number(total[1]);
      result.limit = Number(total[2]);
      const drops = /(\d+)\s+drops/i.exec(text);
      if (drops) result.drops = Number(drops[1]);
      if (!sawTitle && !/^(?:Points\s*:|\d)/i.test(text)) {
        result.title = text;
        sawTitle = true;
      }
      continue;
    }
    if (!regiment && /^(?:General['’]s Handbook|Manuel du G[ée]n[ée]ral)/i.test(text)) {
      result.battlepack = text;
      continue;
    }
    if (!regiment && /^\d+\s+drops$/i.test(text)) {
      result.drops = Number(/^\d+/.exec(text)![0]);
      continue;
    }
    if (terrainSection) {
      choice(text, 'terrain', line);
      continue;
    }
    if (regiment) {
      const parts = text
        .split(/[•●▪]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const main = parts[0]!;
      const unit =
        /^(.+?)\s+\((\d+)\s*(?:pts?|points)?\)\s*$/i.exec(main) ??
        /^(.+?)\s+(?:--\s*)?(\d{2,4})\s*$/.exec(main);
      if (unit) {
        let name = unit[1]!.trim();
        const count = /^(\d+)\s*[x×]\s*/i.exec(name);
        if (count) name = name.slice(count[0].length);
        lastUnit = {
          id: `unit-${line}`,
          name,
          raw: original,
          line,
          regimentId: regiment.id,
          explicitCount: count ? Number(count[1]) : undefined,
          points: Number(unit[2]),
          reinforced: false,
          general: false,
          options: [],
        };
        result.units.push(lastUnit);
        for (const part of parts.slice(1)) modifier(part, line);
      } else if (/^[A-Za-zÀ-ÿ][^:]*$/.test(main) && parts.length === 1 && !/[0-9]/.test(main)) {
        const parent = lastUnit?.componentOf ?? lastUnit?.id;
        lastUnit = {
          id: `unit-${line}`,
          name: main,
          raw: original,
          line,
          regimentId: regiment.id,
          reinforced: false,
          general: false,
          componentOf: parent,
          options: [],
        };
        result.units.push(lastUnit);
      } else {
        result.unparsed.push({
          line,
          raw: original,
          reason: 'Unrecognised unit or option syntax.',
        });
        lastUnit = undefined;
      }
      continue;
    }
    if (text.includes('|')) {
      const pieces = text
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean);
      const factionIndex =
        /^(?:Grand Alliance|Order$|Chaos$|Death$|Destruction$|Orruk Warclans$)/i.test(pieces[0]!) &&
        pieces.length >= 3
          ? 1
          : 0;
      result.faction = pieces[factionIndex];
      sawFaction = true;
      if (pieces[factionIndex + 1]) {
        result.formation = stripCost(pieces[factionIndex + 1]!).name;
        choice(pieces[factionIndex + 1]!, 'formation', line);
      }
      if (!sawTitle) {
        result.title = result.faction ?? 'Army list';
        sawTitle = true;
      }
      continue;
    }
    if (!sawTitle) {
      result.title = text;
      sawTitle = true;
      if (result.faction && normaliseName(text) === normaliseName(result.faction))
        sawFaction = true;
      continue;
    }
    if (!sawFaction && (!result.faction || normaliseName(text) === normaliseName(result.faction))) {
      result.faction = text;
      sawFaction = true;
      continue;
    }
    if (sawFaction && !result.formation) {
      result.formation = stripCost(text).name;
      choice(text, 'formation', line);
      continue;
    }
    result.unparsed.push({ line, raw: original, reason: 'Unrecognised army configuration.' });
  }
  return result;
}
