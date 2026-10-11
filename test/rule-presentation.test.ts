import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { extractPresentation } from '../src/rule-presentation.js';
import { extractRules } from '../src/wahapedia.js';
import { ability, BASE } from './study-fixtures.js';

test('Wahapedia casting, chanting and command values stay distinct from phase text', () => {
  for (const [kind, value] of [
    ['Spell', '6'],
    ['Prayer', '4'],
    ['Command', '1'],
  ] as const) {
    const [rule] = extractRules({
      html: ability('TEST ABILITY', 'Do the stated thing.', 'Your Hero Phase', { kind, value }),
      source: { url: BASE + 'factions/skaven', fetchedAt: '2026-10-09', hash: 'test' },
    }).rules;
    assert(rule);
    assert.equal(rule.timing, 'Your Hero Phase');
    assert.deepEqual(rule.presentation?.badge, { kind: kind.toLowerCase(), value });
    assert.equal(rule.presentation?.color, '#76602b');
    assert.equal(rule.presentation?.icon, 'Offensive');
    assert(!rule.text.includes('invented narrative'));
    assert(JSON.stringify(rule.presentation?.body).includes('invented narrative'));
    assert.equal(rule.presentation?.body.find((node) => node.type === 'element')?.tag, 'h4');
  }
});

test('rich rules retain keyword typography, spacing and tables without source scripts or attributes', () => {
  const $ = load(
    `<div><table><tr><td class="abHeader" bgcolor="#802022">Any Combat Phase</td></tr></table><div class="abBody" onclick="steal()"><b>TEST</b><div class="spc"></div><b>Effect:</b> <span class="kwb" style="color:red">INFANTRY</span><script>steal()</script><iframe src="https://example.com"></iframe><a href="javascript:steal()">bad</a><a href="/aos4/the-rules/core-rules/">good</a><table><tr><td colspan="2">result</td></tr></table></div><div><br></div></div>`,
  );
  const presentation = extractPresentation($, $('.abBody'), BASE);
  const serialized = JSON.stringify(presentation);
  assert(!serialized.includes('steal'));
  assert(!serialized.includes('iframe'));
  assert(!serialized.includes('color:red'));
  assert(serialized.includes('"keyword":true'));
  assert(serialized.includes('"spacer":true'));
  assert(serialized.includes('"colSpan":2'));
  assert(serialized.includes('https://wahapedia.ru/aos4/the-rules/core-rules/'));
  assert.equal(presentation.badge, undefined);
  assert.equal(presentation.color, '#802022');
  const last = presentation.body.at(-1);
  assert.equal(last?.type === 'element' && last.tag, 'table');
  assert.equal(presentation.reaction, undefined);
  $('.abBody').addClass('abIsReaction');
  assert.equal(extractPresentation($, $('.abBody'), BASE).reaction, true);
});
