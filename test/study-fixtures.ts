import { createHash } from 'node:crypto';
import { Archive } from '../src/archive.js';
import { captureContent } from '../src/content.js';
import type { EventSnapshot } from '../src/types.js';
import type { PageLoader } from '../src/wahapedia.js';

export const BASE = 'https://wahapedia.ru/aos4/';
export const army = `Study army 1980/2000 pts
Skaven
Claw-horde
General's Handbook 2026-27
Drops: 2
Spell Lore - Lore of Ruin
Manifestation Lore - Morbid Conjuration
Battle Tactic Cards: Blazing Onslaught and Siege of Ashes
General's Regiment
Grey Seer (100)
• General
• Silver Wand
20x Ratling (300) • Reinforced
Regiment 1
3x Ratling Guns (160)
Faction Terrain
Gnawhole
Created with Warhammer Age of Sigmar: The App
App: 1.38.1 | Data: 483`;
export function ability(
  name: string,
  effect: string,
  timing = 'Passive',
  badge?: { kind: 'Spell' | 'Prayer' | 'Command'; value: string },
) {
  const color = timing === 'Your Hero Phase' ? '#76602b' : '#606362';
  return `<div class="BreakInsideAvoid"><table><tr><td class="abHeader" bgcolor="${color}"><img class="abLogo" src="/aos4/img/abOffensive.png">${timing}</td>${badge ? `<td><div class="ab${badge.kind}PointsN">${badge.value}</div></td>` : ''}</tr></table><div class="abBody"><b>${name}<span class="ShowFluff">:</span></b><span class="ShowFluff legend4">An invented narrative to exclude.</span><br><b>Declare:</b> Pick one friendly unit.<br><b>Effect:</b> ${effect}</div><div class="abKeywords"><span class="abKeywordsBodyText">SPELL</span></div></div>`;
}
export function scroll(name: string, effect = 'Apply this effect only in the stated conditions.') {
  return `<div id="wahMainContent"><div class="wsHeaderIn">${name}</div><div class="AoS_profile"><div class="wsMove">6&quot;</div><div class="wsWounds">3</div><div class="wsSave">6+</div><div class="wsBravery">1</div></div><div class="wsBody"><div class="wsKeywordLine1">INFANTRY, WIZARD (1), WARD (5+)</div><div class="wsKeywordLine2">CHAOS, SKAVEN</div><div class="PitchedBattleProfile">Unit Size: 3 Points: 160<br>Notes: Must use the stated weapon options.</div><table class="wTable"><tr class="wsHeaderRow"><td>RANGED WEAPONS</td>${['Rng', 'Atk', 'Hit', 'Wnd', 'Rnd', 'Dmg'].map((v) => `<td class="wsHeaderCell">${v}</td>`).join('')}</tr><tr class="wsDataRow wsDataRow_short"><td>Ratling Gun</td></tr><tr class="wsDataRow"><td class="wsDataCell_long">Ratling Gun<br><span class="wsWeaponAbility">Crit (2 Hits)</span></td>${['15&quot;', '3D6', '4+', '4+', '1', '1'].map((v) => `<td class="wsCell">${v}</td>`).join('')}</tr></table>${ability('HIDDEN WEAPON TEAM', effect)}</div><script>ad script</script><ins class="adsbygoogle">advertisement</ins><div class="tooltip_templates">${ability('DUPLICATED TOOLTIP', 'Bad duplicate')}</div></div>`;
}
export function fixtureSources() {
  const pages = new Map<string, string>();
  pages.set(
    BASE + 'nav.html',
    `<a href="/aos4/factions/skaven">Skaven</a><a href="/aos4/factions/lumineth-realm-lords">Lumineth Realm-lords</a><a href="/aos4/factions/endless-spells">Endless Spells</a><a href="/aos4/the-rules/general-s-handbook-2026-27">General’s Handbook 2026-27</a>`,
  );
  const faction = `<div id="siteNav" data-armylist-file="/aos4/factions/skaven/armylist.html"></div><div id="wahMainContent"><h2 id="Battle-Traits">Battle Traits</h2>${ability('THE LURKING VERMINTIDE', 'Set up the unit in reserve.')}<h2 id="Battle-Formations">Battle Formations</h2><h3 id="Claw-horde">Claw-horde</h3>Only applies to the selected formation.${ability('CLAW-PICKED', 'Add 1 to Rend for the rest of the turn.')}<h2 id="Artefacts-of-Power">Artefacts of Power</h2><h3 id="Relics">Relics of Ruin</h3>${ability('SILVER WAND', 'Add 1 to casting rolls under these conditions.')}<h2 id="Spell-Lore">Spell Lore</h2><h3 id="Lore-of-Ruin">Lore of Ruin</h3>${ability('WITHER', 'Apply the spell effect.', 'Your Hero Phase', { kind: 'Spell', value: '6' })}<h2 id="Different-Army">Different Army</h2><h3 id="Battle-Traits-1">Battle Traits</h3>${ability('OTHER ARMY', 'Must not be selected for ordinary armies.')}<h2 id="PATH-TO-GLORY">PATH TO GLORY</h2>${ability('PATH RULE', 'Exclude this.')}<h2 id="SPEARHEAD">SPEARHEAD</h2>${ability('SPEARHEAD RULE', 'Exclude this.')}</div>`;
  pages.set(BASE + 'factions/skaven', faction);
  pages.set(
    BASE + 'factions/lumineth-realm-lords',
    faction
      .replaceAll('skaven', 'lumineth-realm-lords')
      .replaceAll('THE LURKING VERMINTIDE', 'LUMINETH TRAIT'),
  );
  pages.set(
    BASE + 'factions/skaven/armylist.html',
    [
      'Grey Seer',
      'Ratling Guns',
      'Ratling Warpblaster',
      'Gnawhole',
      'Scourge of Aqshy Grey Seer',
      'Godmarked Ascendant',
    ]
      .map((name) => `<a href="/aos4/factions/skaven/${name.replaceAll(' ', '-')}">${name}</a>`)
      .join(''),
  );
  for (const name of [
    'Grey Seer',
    'Ratling Guns',
    'Ratling Warpblaster',
    'Gnawhole',
    'Scourge of Aqshy Grey Seer',
  ])
    pages.set(BASE + 'factions/skaven/' + name.replaceAll(' ', '-'), scroll(name));
  pages.set(
    BASE + 'factions/skaven/Godmarked-Ascendant',
    `<div id="wahMainContent"><div class="wsHeaderIn">Godmarked Ascendant</div><div class="wsBody">INCLUSION: Skaven<br>ORGANISATION: <a href="/aos4/factions/slaves-to-darkness/Daemon-Prince">Daemon Prince</a>${ability('GIFTS OF CHAOS', 'The included unit gains conditional benefits.')}</div></div>`,
  );
  pages.set(BASE + 'factions/slaves-to-darkness/Daemon-Prince', scroll('Daemon Prince'));
  pages.set(
    BASE + 'factions/endless-spells',
    `<div id="wahMainContent"><h2 id="Manifestation-Lore">Manifestation Lore</h2><h3 id="Morbid-Conjuration">Morbid Conjuration</h3>${ability('SUMMON MIST', 'Summon the named manifestation.', 'Your Hero Phase')}<a href="/aos4/factions/endless-spells/Mist">Mist</a></div>`,
  );
  pages.set(BASE + 'factions/endless-spells/Mist', scroll('Mist'));
  pages.set(
    BASE + 'the-rules/general-s-handbook-2026-27',
    `<div id="wahMainContent"><h2 id="Battle-Tactics">Battle Tactics 2026-27</h2><h3 id="Blazing-Onslaught">Blazing Onslaught</h3>At the start of battle, choose a hideout.<div>AFFRAY: MASTER OF ARMS<br>Meet the stated condition. 5 victory points.</div><h3 id="Siege-of-Ashes">Siege of Ashes</h3>STRIKE: OUTPOST RESUPPLY<br>Meet a different condition.</div>`,
  );
  let version = 1,
    offline = false;
  const requests: string[] = [];
  const loader: PageLoader = async (url, signal) => {
    signal?.throwIfAborted();
    requests.push(url);
    if (offline) throw new Error('Simulated source outage');
    const html = pages.get(url);
    if (!html) throw new Error('Fixture source missing: ' + url);
    return {
      html,
      source: {
        url,
        fetchedAt: `2026-10-09T10:00:0${version}Z`,
        hash: createHash('sha256')
          .update(html + version)
          .digest('hex'),
      },
    };
  };
  return {
    pages,
    loader,
    requests,
    bump: () => {
      version++;
    },
    offline: (value: boolean) => {
      offline = value;
    },
  };
}
export async function seedEvent(
  dataDir: string,
  id = 'event-one',
  text = army,
): Promise<EventSnapshot> {
  const event: EventSnapshot = {
    schemaVersion: 1,
    id,
    url: `https://www.bestcoastpairings.com/event/${id}`,
    name: id === 'event-one' ? 'Autumn tournament' : 'Second tournament',
    collectedAt: new Date().toISOString(),
    metadata: {},
    players: [
      {
        id: 'player-one',
        name: 'Alex Example',
        faction: 'Skaven',
        dropped: false,
        listId: 'list-one',
      },
    ],
  };
  const archive = new Archive(dataDir, id);
  await archive.initialise();
  await archive.writeEvent(event);
  await archive.saveContent(
    event.players[0]!,
    captureContent({ id: 'list-one', armyListText: text }, event.players[0]!, id),
  );
  return event;
}
