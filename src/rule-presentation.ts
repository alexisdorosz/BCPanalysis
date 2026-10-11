import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { RulePresentation, RuleTextNode } from './study-types.js';

const tags: Record<string, Extract<RuleTextNode, { type: 'element' }>['tag']> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  span: 'span',
  br: 'br',
  p: 'p',
  div: 'div',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  table: 'table',
  tbody: 'tbody',
  thead: 'thead',
  tr: 'tr',
  td: 'td',
  th: 'th',
  sup: 'sup',
  sub: 'sub',
  a: 'a',
};
const discarded = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'svg',
  'form',
  'input',
  'button',
]);

// Keep source typography and tables as data. React renders only these allowed elements;
// source HTML, CSS, handlers and tooltip scripts never enter the browser document.
export function ruleTextNodes($: CheerioAPI, nodes: AnyNode[], base: string): RuleTextNode[] {
  return nodes.flatMap((node): RuleTextNode[] => {
    if (node.type === 'text') return [{ type: 'text', text: node.data }];
    if (!('tagName' in node) || discarded.has(node.tagName)) return [];
    const children = ruleTextNodes($, node.children, base),
      tag = $(node).hasClass('legend4') ? 'em' : tags[node.tagName];
    if (!tag) return children;
    const item: Extract<RuleTextNode, { type: 'element' }> = { type: 'element', tag, children };
    item.keyword = $(node).hasClass('kwb') || undefined;
    item.spacer = $(node).hasClass('spc') || undefined;
    if (tag === 'a') {
      try {
        const url = new URL($(node).attr('href') ?? '', base);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'wahapedia.ru' ||
          !url.pathname.startsWith('/aos4/') ||
          url.username ||
          url.password ||
          url.port
        )
          throw new Error('Invalid rule link.');
        item.href = url.href;
      } catch {
        item.tag = 'span';
      }
    }
    if (tag === 'td' || tag === 'th') {
      for (const [attribute, key] of [
        ['colspan', 'colSpan'],
        ['rowspan', 'rowSpan'],
      ] as const) {
        const value = Number($(node).attr(attribute));
        if (Number.isInteger(value) && value > 1 && value <= 20) item[key] = value;
      }
    }
    return [item];
  });
}

export function extractPresentation(
  $: CheerioAPI,
  body: ReturnType<CheerioAPI>,
  base: string,
): RulePresentation {
  const wrapper = body.parent(),
    header = wrapper.find('.abHeader').not('.abKeywordsBody').first();
  const color = header.attr('bgcolor')?.toLowerCase();
  const icon =
    /\/ab(Special|Movement|Defensive|Offensive|Shooting|Rallying|Control|Damage)\.png$/.exec(
      header.find('.abLogo').attr('src') ?? '',
    )?.[1] as RulePresentation['icon'];
  let badge: RulePresentation['badge'];
  for (const [kind, selector] of [
    ['spell', '.abSpellPointsN'],
    ['prayer', '.abPrayerPointsN'],
    ['command', '.abCommandPointsN'],
  ] as const) {
    const value = wrapper.find(selector).first().text().trim();
    if (value) {
      badge = { kind, value };
      break;
    }
  }
  const contents = body.contents().toArray();
  const nodes = ruleTextNodes($, contents, base);
  const title = nodes.find((node) => node.type === 'element' && node.tag === 'strong');
  if (title?.type === 'element') title.tag = 'h4';
  const tail = body
    .nextUntil('.BreakInsideAvoid,.abBody,h2,h3,h4')
    .not('.abKeywords')
    .filter((_, element) => !!$(element).text().trim());
  nodes.push(...ruleTextNodes($, tail.toArray(), base));
  return {
    color: color && /^#[0-9a-f]{6}$/.test(color) ? color : undefined,
    reaction: body.hasClass('abIsReaction') || undefined,
    icon,
    badge,
    body: nodes,
  };
}
