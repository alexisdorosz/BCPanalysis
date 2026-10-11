import { normaliseName } from './parse-list.js';
import type { Candidate, ListChoice, Resolution, Rule, Study, UnitStudy } from './study-types.js';
import { StudyStore } from './study-store.js';
import {
  NAV,
  SourceSession,
  armyListUnits,
  extractRules,
  extractWarscroll,
  navigation,
  rulesFor,
  sectionContent,
  unique,
  type PageLoader,
  type RulePage,
  type SourcePage,
} from './wahapedia.js';

function variant(name: string): string {
  return /scourge of (?:aqshy|ghyran)/.exec(normaliseName(name))?.[0] ?? '';
}
export function resolveEntry(
  entryId: string,
  label: string,
  kind: Resolution['kind'],
  catalog: Candidate[],
  mappings: Record<string, string>,
): Resolution {
  const name = normaliseName(label),
    candidates = unique(catalog).filter((item) => variant(item.name) === variant(label));
  const exact = candidates.filter((item) => normaliseName(item.name) === name);
  const saved = mappings[kind + ':' + label];
  const confirmed = saved ? candidates.find((item) => item.key === saved) : undefined;
  if (confirmed)
    return {
      entryId,
      label,
      kind,
      status: 'resolved',
      candidates: [confirmed],
      selected: confirmed,
    };
  // Never silently replace a confirmed source that disappeared.
  if (!saved && exact.length === 1)
    return { entryId, label, kind, status: 'resolved', candidates: exact, selected: exact[0] };
  const stopwords = new Set(['the', 'and', 'with', 'for', 'from']);
  const significant = (value: string) =>
    normaliseName(value)
      .split(' ')
      .filter((token) => token.length > 2 && !stopwords.has(token));
  const tokens = significant(name);
  const ranked = candidates
    .map((item) => {
      const words = significant(item.name);
      const shared = tokens.filter((token) => words.includes(token)).length;
      return { item, score: shared / Math.max(tokens.length, words.length, 1) };
    })
    .filter((item) => item.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.item);
  const choices = exact.length ? exact : ranked;
  return {
    entryId,
    label,
    kind,
    status: choices.length ? 'ambiguous' : 'missing',
    candidates: choices,
    message: saved
      ? 'The confirmed source is no longer available. Please confirm a current candidate.'
      : choices.length
        ? 'Confirm which source describes this entry.'
        : 'No matching source was discovered. The original entry is preserved.',
  };
}
function allowed(entry: Candidate, formation?: Candidate, factionUrl?: string): boolean {
  const context = entry.context ?? '';
  if (/PATH TO GLORY|SPEARHEAD/i.test(context)) return false;
  const root = context.split(' / ')[0]!;
  if (
    formation &&
    factionUrl === entry.url &&
    !/^Battle Formations(?: \/|$)/.test(formation.context ?? '')
  )
    return root === formation.name;
  const normalSection =
    /^(?:Faction Rules|Battle Traits|Battle Formations|Heroic Traits|Artefacts of Power|Spell Lore|Prayer Lore|Manifestation Lore|Battle Tactics(?: \d{4}-\d{2})?|Regiments of Renown|[\w ’'-]+ Mutations|[\w ’'-]+ Upgrades)$/i.test(
      root,
    );
  return (
    normalSection ||
    /Battle Tactics/i.test(root) ||
    !context ||
    (!!formation && (root === formation.name || context.startsWith(formation.context + ' /')))
  );
}
function dedupRules(rules: Rule[]): Rule[] {
  return [...new Map(rules.map((rule) => [rule.id, rule])).values()];
}
export async function generateStudy(
  store: StudyStore,
  eventId: string,
  playerId: string,
  options: { signal?: AbortSignal; loader?: PageLoader; progress?: (message: string) => void } = {},
): Promise<Study> {
  const detail = await store.player(eventId, playerId);
  if (!detail.parsed || !detail.contentHash)
    throw new Error('A text list must be collected before generating a study sheet.');
  const parsed = detail.parsed,
    mappings = await store.mappings(eventId, playerId);
  const session = new SourceSession(options.loader, options.signal, (url) =>
    options.progress?.(`Checking ${url.split('/').at(-1) || 'faction rules'}…`),
  );
  const nav = navigation(await session.get(NAV));
  const faction = resolveEntry(
    'faction',
    parsed.faction ?? '',
    'faction',
    nav.factions.filter((item) => !/endless.spells/i.test(item.url)),
    mappings,
  );
  const study: Study = {
    schemaVersion: 1,
    eventId,
    playerId,
    contentHash: detail.contentHash,
    generatedAt: new Date().toISOString(),
    status: 'partial',
    parsed,
    armyRules: [],
    selectedRules: [],
    units: [],
    resolutions: [faction],
    sources: [],
    warnings: [
      'Rules reflect Wahapedia AoS 4 at generation time, not the tournament’s historical rules. Declared points and choices are not a legality check.',
    ],
  };
  if (detail.content?.supports.some((support) => support !== 'text'))
    study.warnings.push(
      'Additional BCP attachments or non-text content have not been interpreted. Consult the original list.',
    );
  if (!faction.selected) {
    study.sources = session.sources;
    await store.save(study);
    return study;
  }
  const pages = new Map<string, { page: SourcePage; rules: RulePage }>();
  const getRules = async (url: string) => {
    if (!pages.has(url)) {
      const page = await session.get(url);
      pages.set(url, { page, rules: extractRules(page) });
    }
    return pages.get(url)!;
  };
  const main = await getRules(faction.selected.url);
  let units = [...main.rules.units];
  if (main.rules.armyList) {
    try {
      units.push(...armyListUnits(await session.get(main.rules.armyList)));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      study.warnings.push(`Unit navigation unavailable: ${(error as Error).message}`);
    }
  }
  const common = nav.factions.find((item) => /endless.spells/i.test(item.url));
  if (parsed.choices.some((choice) => choice.kind === 'manifestation-lore') && common) {
    try {
      const extra = await getRules(common.url);
      units.push(...extra.rules.units);
      if (extra.rules.armyList)
        units.push(...armyListUnits(await session.get(extra.rules.armyList)));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      study.warnings.push(`Common manifestations unavailable: ${(error as Error).message}`);
    }
  }
  if (
    parsed.choices.some((choice) => choice.kind === 'battle-tactics') ||
    parsed.regiments.some((regiment) => regiment.kind === 'renown')
  ) {
    const handbooks = nav.other
      .filter((item) => /handbook/i.test(item.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    const declaredYear = parsed.battlepack?.match(/20\d{2}-\d{2}/)?.[0];
    const handbook = parsed.battlepack
      ? handbooks.find(
          (item) =>
            normaliseName(item.name) === normaliseName(parsed.battlepack!) ||
            (declaredYear && item.name.includes(declaredYear)),
        )
      : handbooks[0];
    if (handbook) {
      try {
        const book = await getRules(handbook.url);
        units.push(...book.rules.units);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        study.warnings.push(`Battlepack source unavailable: ${(error as Error).message}`);
      }
    } else if (parsed.battlepack)
      study.warnings.push(
        `The declared battlepack was not found in navigation: ${parsed.battlepack}.`,
      );
  }
  const formationChoice = parsed.choices.find((choice) => choice.kind === 'formation');
  let formation: Candidate | undefined;
  if (formationChoice) {
    const catalog = main.rules.entries.filter(
      (item) =>
        /Battle Formations/i.test(item.context ?? '') ||
        (item.context?.split(' / ').length === 1 &&
          !/^(?:Faction Rules|Battle Traits|Books|Designers|Battletome|Spell Lore|Prayer Lore|Manifestation Lore|Heroic Traits|Artefacts)/i.test(
            item.name,
          )),
    );
    const match = resolveEntry(
      formationChoice.id,
      formationChoice.name,
      formationChoice.kind,
      catalog,
      mappings,
    );
    study.resolutions.push(match);
    formation = match.selected;
    if (formation)
      study.selectedRules.push({
        choice: formationChoice,
        rules: rulesFor(formation, main.rules, main.page.source),
      });
  }
  const renownArmy = formation && !/^Battle Formations(?: \/|$)/.test(formation.context ?? '');
  const traitsContext = renownArmy ? formation!.name + ' / Battle Traits' : 'Battle Traits';
  const traits = main.rules.entries.find(
    (entry) => entry.name === 'Battle Traits' && entry.context === traitsContext,
  );
  study.armyRules = traits
    ? rulesFor(traits, main.rules, main.page.source)
    : main.rules.rules.filter(
        (rule) =>
          rule.context === traitsContext ||
          rule.context.startsWith(traitsContext + ' /') ||
          (!renownArmy && rule.context.startsWith('Faction Rules')),
      );
  const loadUnit = async (
    entryId: string,
    name: string,
    kind: 'unit' | 'terrain',
    unitId?: string,
  ) => {
    const resolution = resolveEntry(entryId, name, kind, units, mappings);
    study.resolutions.push(resolution);
    if (!resolution.selected) return undefined;
    try {
      const page = await session.get(resolution.selected.url);
      const warscroll = extractWarscroll(page);
      return warscroll;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      resolution.status = 'unavailable';
      resolution.message = (error as Error).message;
      return undefined;
    }
  };
  for (const unit of parsed.units) {
    options.signal?.throwIfAborted();
    const warscroll = await loadUnit(unit.id, unit.name, 'unit', unit.id);
    const item: UnitStudy = {
      unitId: unit.id,
      warscroll,
      modelCount:
        unit.explicitCount ??
        (warscroll?.unitSize ? warscroll.unitSize * (unit.reinforced ? 2 : 1) : undefined),
      countSource: unit.explicitCount ? 'declared' : warscroll?.unitSize ? 'inferred' : undefined,
      roles: [],
      optionRules: [],
    };
    if (warscroll) {
      if (warscroll.weapons.some((weapon) => weapon.kind === 'ranged'))
        item.roles.push('Ranged weapons');
      if (warscroll.weapons.some((weapon) => weapon.kind === 'melee'))
        item.roles.push('Melee weapons');
      item.roles.push(
        ...warscroll.keywords.filter((keyword) =>
          /WIZARD|PRIEST|HERO|INFANTRY|CAVALRY|MONSTER|WAR MACHINE|BEAST|MANIFESTATION|TERRAIN/i.test(
            keyword,
          ),
        ),
      );
      // Warscroll-specific enhancement lists are discovered only in their own scope.
      const extracted = extractRules(await session.get(resolutionSource(study, unit.id)!));
      pages.set(warscroll.source.url, {
        page: await session.get(warscroll.source.url),
        rules: extracted,
      });
      units.push(...extracted.units);
    }
    study.units.push(item);
  }
  for (const choice of parsed.choices.filter((choice) => choice.kind !== 'formation')) {
    options.signal?.throwIfAborted();
    if (choice.kind === 'terrain') {
      const warscroll = await loadUnit(choice.id, choice.name, 'terrain');
      study.selectedRules.push({ choice, rules: [], warscrolls: warscroll ? [warscroll] : [] });
      continue;
    }
    if (choice.kind === 'option' && choice.unitId) {
      const owner = study.units.find((item) => item.unitId === choice.unitId),
        weapons = owner?.warscroll?.weapons ?? [];
      const requested = choice.name.replace(/^\d+\s*(?:x\s*)?/i, '').split(/\s+and\s+/i);
      const matched = requested.map((name) =>
        weapons.find((weapon) => normaliseName(weapon.name) === normaliseName(name)),
      );
      if (owner?.warscroll && matched.length && matched.every(Boolean)) {
        const source = owner.warscroll.source,
          selected: Candidate = {
            key: source.url + '#weapon:' + normaliseName(choice.name),
            name: choice.name,
            url: source.url,
            context: 'Declared weapon option',
          };
        const rule: Rule = {
          id: selected.key,
          name: choice.name,
          text: `Declared option: ${choice.name}.\nMatches source weapon profiles: ${matched.map((weapon) => weapon!.name).join(', ')}.\nWeapon characteristics and any loadout restrictions are shown on the warscroll.`,
          keywords: [],
          category: 'Weapon option',
          context: 'Declared weapon option',
          source,
        };
        study.resolutions.push({
          entryId: choice.id,
          label: choice.name,
          kind: choice.kind,
          status: 'resolved',
          selected,
          candidates: [selected],
        });
        study.selectedRules.push({ choice, rules: [rule] });
        owner.optionRules.push(rule);
        continue;
      }
    }
    let catalog = [...pages.values()]
      .flatMap((item) => item.rules.entries)
      .filter((item) => allowed(item, formation, faction.selected!.url));
    const contextFilter: Partial<Record<ListChoice['kind'], RegExp>> = {
      'spell-lore': /Spell Lore/i,
      'prayer-lore': /Prayer Lore/i,
      'manifestation-lore': /Manifestation Lore/i,
      'battle-tactics': /Battle Tactics/i,
    };
    if (contextFilter[choice.kind])
      catalog = catalog.filter((item) => contextFilter[choice.kind]!.test(item.context ?? ''));
    if (choice.unitId) {
      const owner = study.units.find((unit) => unit.unitId === choice.unitId)?.warscroll?.source
        .url;
      catalog = catalog.filter((item) => item.url === faction.selected!.url || item.url === owner);
    }
    const names =
      choice.kind === 'battle-tactics'
        ? choice.name.split(/\s*[,/&]\s*|\s+(?:and|et)\s+/i).filter(Boolean)
        : [choice.name];
    const collected: Rule[] = [],
      manifests: NonNullable<Study['selectedRules'][number]['warscrolls']> = [];
    for (const [index, name] of names.entries()) {
      const match = resolveEntry(
        names.length > 1 ? `${choice.id}-${index}` : choice.id,
        name,
        choice.kind,
        catalog,
        mappings,
      );
      study.resolutions.push(match);
      if (!match.selected) continue;
      const source = await getRules(match.selected.url);
      collected.push(...rulesFor(match.selected, source.rules, source.page.source));
      if (choice.kind === 'manifestation-lore') {
        // Only manifestations linked from the selected lore, not the entire faction.
        const raw = source.page.html;
        const { load } = await import('cheerio');
        const $ = load(raw);
        const heading = $('[id]').filter((_, el) => $(el).attr('id') === match.selected!.anchor);
        const section = sectionContent($, heading);
        const urls = new Set(
          section
            .find('a[href]')
            .map((_, e) => $(e).attr('href')!)
            .get()
            .map((href) => {
              try {
                return new URL(href, match.selected!.url).href.split('#')[0]!;
              } catch {
                return '';
              }
            }),
        );
        for (const target of unique(units.filter((unit) => urls.has(unit.url)))) {
          try {
            manifests.push(extractWarscroll(await session.get(target.url)));
          } catch (error) {
            if (options.signal?.aborted) throw error;
            study.warnings.push(
              `Manifestation unavailable: ${target.name}. ${(error as Error).message}`,
            );
          }
        }
      }
    }
    const rules = dedupRules(collected);
    study.selectedRules.push({
      choice,
      rules,
      warscrolls: manifests.length ? manifests : undefined,
    });
    if (choice.unitId)
      study.units.find((unit) => unit.unitId === choice.unitId)?.optionRules.push(...rules);
  }
  study.armyRules = dedupRules(study.armyRules);
  study.sources = session.sources;
  study.status =
    study.resolutions.every((item) => item.status === 'resolved') &&
    !parsed.unparsed.length &&
    study.warnings.length === 1
      ? 'ready'
      : 'partial';
  // On source outage preserve a previous sheet for exactly the same content.
  if (
    detail.study &&
    (study.resolutions.some((item) => item.status === 'unavailable') ||
      study.warnings.some((warning) => /unavailable|not found in navigation/i.test(warning)))
  )
    throw new Error('One or more sources are unavailable. The previous sheet has been retained.');
  await store.save(study);
  return study;
}
function resolutionSource(study: Study, id: string): string | undefined {
  return study.resolutions.find((item) => item.entryId === id)?.selected?.url;
}
