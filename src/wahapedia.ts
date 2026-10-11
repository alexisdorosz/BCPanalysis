import { createHash } from 'node:crypto';
import { load, type CheerioAPI } from 'cheerio';
import type { Candidate, Rule, SourceRef, Warscroll } from './study-types.js';
import { normaliseName } from './parse-list.js';
import { extractPresentation, ruleTextNodes } from './rule-presentation.js';

export const NAV = 'https://wahapedia.ru/aos4/nav.html';
export interface SourcePage {
  html: string;
  source: SourceRef;
}
export type PageLoader = (url: string, signal?: AbortSignal) => Promise<SourcePage>;
export function sourceUrl(value: string, base = NAV): string {
  const url = new URL(value, base);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'wahapedia.ru' ||
    !url.pathname.startsWith('/aos4/') ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Only Wahapedia AoS 4 sources are accepted.');
  url.hash = '';
  return url.href;
}
export const fetchSource: PageLoader = async (url, signal) => {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]);
  let target = sourceUrl(url),
    response: Response;
  for (let hop = 0; ; hop++) {
    response = await fetch(target, { signal: requestSignal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (hop === 3 || !response.headers.get('location')) throw new Error('Invalid source redirect.');
    target = sourceUrl(response.headers.get('location')!, target);
  }
  if (!response.ok) throw new Error(`Wahapedia returned ${response.status}: ${url}`);
  const html = await response.text();
  if (html.length > 12_000_000) throw new Error('Source page is too large.');
  return {
    html,
    source: {
      url,
      fetchedAt: new Date().toISOString(),
      hash: createHash('sha256').update(html).digest('hex'),
    },
  };
};
export class SourceSession {
  private pages = new Map<string, Promise<SourcePage>>();
  readonly sources: SourceRef[] = [];
  constructor(
    private loader: PageLoader = fetchSource,
    private signal?: AbortSignal,
    private progress?: (url: string) => void,
  ) {}
  get(url: string): Promise<SourcePage> {
    url = sourceUrl(url);
    if (!this.pages.has(url))
      this.pages.set(
        url,
        (async () => {
          this.signal?.throwIfAborted();
          this.progress?.(url);
          const page = await this.loader(url, this.signal);
          this.sources.push(page.source);
          return page;
        })(),
      );
    return this.pages.get(url)!;
  }
}
function clean(html: string): CheerioAPI {
  const $ = load(html);
  $(
    'script,style,noscript,iframe,.tooltip_templates,[id^="tooltip_content"],.aos-integration-header,.aos-integration-panel,ins,.adsbygoogle,[class*="advert"],#siteNav,.NavColumns',
  ).remove();
  return $;
}
function text($: CheerioAPI, node: Parameters<CheerioAPI>[0]): string {
  const clone = $(node).clone();
  clone.find('.ShowFluff').remove();
  clone.find('br').replaceWith('\n');
  clone.find('li').prepend('• ');
  clone.find('div,p,li,tr').append('\n');
  return clone
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function candidate(name: string, url: string, anchor?: string, context?: string): Candidate {
  return {
    key: `${url}${anchor ? '#' + anchor + ':' + normaliseName(name) : ''}`,
    name,
    url,
    anchor,
    context,
  };
}
function unitCandidate(name: string, url: string): Candidate {
  const pathVariant = /\/Scourge-of-(Aqshy|Ghyran)-/i.exec(new URL(url).pathname);
  if (pathVariant && !/scourge of (aqshy|ghyran)/.test(normaliseName(name)))
    name = `Scourge of ${pathVariant[1]} ${name}`;
  return candidate(name, url);
}
export function navigation(page: SourcePage): { factions: Candidate[]; other: Candidate[] } {
  const $ = load(page.html),
    factions: Candidate[] = [],
    other: Candidate[] = [];
  $('a[href]').each((_, e) => {
    const href = $(e).attr('href')!;
    let url: string;
    try {
      url = sourceUrl(href, page.source.url);
    } catch {
      return;
    }
    const name = $(e).text().trim();
    if (!name) return;
    if (/\/aos4\/factions\/[^/]+\/?$/.test(new URL(url).pathname))
      factions.push(candidate(name, url));
    else if (/handbook|regiments-of-renown/i.test(href)) other.push(candidate(name, url));
  });
  return { factions: unique(factions), other: unique(other) };
}
export function unique(items: Candidate[]): Candidate[] {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}
export function sectionContent($: CheerioAPI, heading: ReturnType<CheerioAPI>) {
  const wrapper = $('<div></div>');
  let next = heading[0]?.nextSibling;
  while (next) {
    const item = $(next);
    if (item.is('h2,h3,h4') || item.find('h2,h3,h4').length) break;
    wrapper.append(item.clone());
    next = next.nextSibling;
  }
  return wrapper;
}
export interface RulePage {
  rules: Rule[];
  entries: Candidate[];
  units: Candidate[];
  armyList?: string;
  sectionText: Record<string, string>;
  sectionRichText: Record<string, ReturnType<typeof ruleTextNodes>>;
}
const categoryNames =
  /^(?:Faction Rules|Battle Traits|Battle Formations|Heroic Traits|Artefacts of Power|Spell Lore|Prayer Lore|Manifestation Lore|Battle Tactics|Regiments of Renown)$/i;
export function extractRules(page: SourcePage): RulePage {
  const original = load(page.html),
    armyList = original('#siteNav').attr('data-armylist-file');
  const $ = clean(page.html),
    main = $('#wahMainContent').length ? $('#wahMainContent') : $('body');
  const result: RulePage = {
    rules: [],
    entries: [],
    units: [],
    sectionText: {},
    sectionRichText: {},
    armyList: armyList ? sourceUrl(armyList, page.source.url) : undefined,
  };
  let path: string[] = [],
    anchors: string[] = [],
    excluded = false;
  main.find('h2,h3,h4,.abBody,a[href]').each((_, element) => {
    const node = $(element),
      tag = element.tagName;
    if (/^h[234]$/.test(tag)) {
      const name = text($, element),
        level = Number(tag.slice(1)) - 2;
      if (/^(?:PATH TO GLORY|SPEARHEAD|Spearhead Rules|The Anvil of Apotheosis)$/i.test(name))
        excluded = true;
      if (excluded) return;
      path = [...path.slice(0, level), name];
      anchors = [...anchors.slice(0, level), node.attr('id') ?? ''];
      const anchor = node.attr('id');
      if (anchor) {
        result.entries.push(candidate(name, page.source.url, anchor, path.join(' / ')));
        // Include prerequisite prose, tables and restrictions alongside ability cards.
        const section = sectionContent($, node);
        section.find('.abBody').each((_, el) => {
          $(el).parent().remove();
        });
        const prose = text($, section);
        if (prose) {
          result.sectionText[anchor] = prose;
          result.sectionRichText[anchor] = ruleTextNodes(
            $,
            section.contents().toArray(),
            page.source.url,
          );
        }
      }
      return;
    }
    if (excluded || node.parents('.tooltip_templates').length) return;
    if (node.is('a')) {
      let url: string;
      try {
        url = sourceUrl(node.attr('href')!, page.source.url);
      } catch {
        return;
      }
      if (
        /\/aos4\/factions\/[^/]+\/[^/.]+$/.test(new URL(url).pathname) &&
        !/Spearhead/i.test(url)
      ) {
        const name = node.text().trim();
        if (name) result.units.push(unitCandidate(name, url));
      }
      return;
    }
    const tail = node
      .nextUntil('.BreakInsideAvoid,.abBody,h2,h3,h4')
      .not('.abKeywords')
      .map((_, el) => text($, el))
      .get()
      .filter(Boolean)
      .join('\n');
    const full = [text($, element), tail].filter(Boolean).join('\n'),
      title = text($, node.find('b').first()).replace(/:\s*$/, '');
    if (!title || !full) return;
    const name = title;
    const wrapper = node.parent();
    const timing = text($, wrapper.find('.abHeader').not('.abKeywordsBody').first());
    const afterName = full.slice(full.indexOf(title) + title.length).trim();
    const field = (label: string) =>
      new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n?(?:Declare|Effect|Keywords):|$)`, 'i')
        .exec(afterName)?.[1]
        ?.trim();
    const keywords = text($, wrapper.find('.abKeywordsBodyText'))
      .split(/\s*,\s*/)
      .filter(Boolean);
    const category =
      [...path].reverse().find((part) => categoryNames.test(part)) ?? path[0] ?? 'Warscroll';
    const anchor = anchors.at(-1);
    const rule: Rule = {
      id: `${page.source.url}#rule-${result.rules.length}`,
      name,
      timing: timing || undefined,
      declare: field('Declare'),
      effect: field('Effect'),
      text: afterName || full,
      keywords,
      category,
      context: path.join(' / ') || 'Warscroll',
      source: page.source,
      anchor,
      presentation: extractPresentation($, node, page.source.url),
    };
    result.rules.push(rule);
    // Ability names can be equipment/traits not represented by a heading.
    result.entries.push(candidate(name, page.source.url, anchor, rule.context));
  });
  result.entries = unique(result.entries);
  result.units = unique(result.units);
  return result;
}
export function armyListUnits(page: SourcePage): Candidate[] {
  const $ = load(page.html),
    items: Candidate[] = [];
  $('a[href]').each((_, e) => {
    let url: string;
    try {
      url = sourceUrl($(e).attr('href')!, page.source.url);
    } catch {
      return;
    }
    if (/\/aos4\/factions\/[^/]+\/[^/.]+$/.test(new URL(url).pathname) && !/Spearhead/i.test(url)) {
      const name = $(e).text().trim();
      if (name) items.push(unitCandidate(name, url));
    }
  });
  return unique(items);
}
export function extractWarscroll(page: SourcePage): Warscroll {
  const $ = clean(page.html),
    main = $('#wahMainContent').length ? $('#wahMainContent') : $('body'),
    profile = main.find('.AoS_profile').first();
  if (!main.find('.wsBody').length) throw new Error('This source does not contain a warscroll.');
  const body = main.find('.wsBody').first();
  const value = (selector: string) => text($, profile.find(selector).first()) || undefined;
  const keywords = body
    .find('.wsKeywordLine1,.wsKeywordLine2')
    .map((_, e) => text($, e))
    .get()
    .join(', ')
    .split(/,\s*/)
    .filter(Boolean);
  const battle = text($, body.find('.PitchedBattleProfile').first());
  const notes = battle;
  const weapons: Warscroll['weapons'] = [];
  let kind: 'ranged' | 'melee' = 'melee',
    headers: string[] = [];
  body.find('.wTable tr').each((_, row) => {
    if ($(row).is('.wsHeaderRow')) {
      kind = /RANGED/i.test($(row).text()) ? 'ranged' : 'melee';
      headers = $(row)
        .find('.wsHeaderCell')
        .map((_, cell) => text($, cell))
        .get();
      return;
    }
    if (!$(row).is('.wsDataRow') || $(row).is('.wsDataRow_short')) return;
    const cell = $(row)
      .find('.wsDataCell_long')
      .filter((_, e) => !!$(e).text().trim())
      .first();
    const abilities = cell
      .find('.wsWeaponAbility')
      .map((_, e) => text($, e))
      .get();
    const clone = cell.clone();
    clone.find('.wsWeaponAbility').remove();
    const name = text($, clone);
    if (!name) return;
    const values: Record<string, string> = {};
    $(row)
      .find('.wsCell')
      .each((i, e) => {
        if (headers[i]) values[headers[i]!] = text($, e);
      });
    weapons.push({ name, kind, values, abilities });
  });
  const rules = extractRules(page).rules;
  const context = body.clone();
  context.find('.abBody').each((_, el) => {
    $(el).parent().remove();
  });
  context
    .find(
      '.wsTable,.wTable,.PitchedBattleProfile,.wsBodyBottom,.wsKeywordLine1,.wsKeywordLine2,.wsKeywordHeader',
    )
    .remove();
  const inclusion = text($, context);
  return {
    name: text($, main.find('.wsHeaderIn').first()) || text($, main.find('h1').first()),
    source: page.source,
    move: value('.wsMove'),
    health: value('.wsWounds'),
    save: value('.wsSave'),
    control: value('.wsBravery'),
    ward: value('.wsWard') ?? /WARD\s*\(([^)]+)\)/i.exec(keywords.join(' '))?.[1],
    unitSize: /Unit Size\s*:\s*(\d+)/i.exec(battle)?.[1]
      ? Number(/Unit Size\s*:\s*(\d+)/i.exec(battle)![1])
      : undefined,
    points: /Points\s*:\s*(\d+)/i.exec(battle)?.[1]
      ? Number(/Points\s*:\s*(\d+)/i.exec(battle)![1])
      : undefined,
    keywords,
    weapons,
    rules,
    notes: [inclusion, notes].filter((note): note is string => !!note),
  };
}
export function rulesFor(entry: Candidate, page: RulePage, source: SourceRef): Rule[] {
  const exact = page.rules.filter(
    (rule) =>
      normaliseName(rule.name) === normaliseName(entry.name) && rule.context === entry.context,
  );
  const grouped = exact.length
    ? exact
    : page.rules.filter(
        (rule) => rule.context === entry.context || rule.context.startsWith(entry.context + ' /'),
      );
  const seen = new Set<string>();
  const contexts = page.entries
    .filter((section) => {
      if (!section.anchor || !page.sectionText[section.anchor] || seen.has(section.anchor))
        return false;
      const relevant =
        section.anchor === entry.anchor ||
        (!!section.context &&
          !!entry.context &&
          (entry.context.startsWith(section.context + ' /') ||
            (!exact.length && section.context.startsWith(entry.context + ' /'))));
      if (relevant) seen.add(section.anchor);
      return relevant;
    })
    .map(
      (section) =>
        ({
          id: `${section.url}#${section.anchor}:context`,
          name: section.name + ' — context & restrictions',
          text: page.sectionText[section.anchor!]!,
          richText: page.sectionRichText[section.anchor!],
          keywords: [],
          category: 'Context',
          context: section.context ?? '',
          source,
          anchor: section.anchor,
        }) satisfies Rule,
    );
  return [...contexts, ...grouped];
}
