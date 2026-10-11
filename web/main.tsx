import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Job, Study, UnitStudy, Warscroll } from '../src/study-types.js';
import type { StudyStore } from '../src/study-store.js';
import './style.css';
import './abilities.css';
import { Rules, SourceLink } from './rules.js';

type EventSummary = Awaited<ReturnType<StudyStore['events']>>[number];
type Roster = Awaited<ReturnType<StudyStore['roster']>>;
type Detail = Awaited<ReturnType<StudyStore['player']>>;
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The operation failed.');
  return data;
}
function Profile({ scroll }: { scroll: Warscroll }) {
  return (
    <div className="profile">
      <div className="profile-heading">
        <h4>{scroll.name}</h4>
        <SourceLink url={scroll.source.url} />
      </div>
      <p className="muted">
        Base characteristics · Conditional changes remain in the abilities below.
      </p>
      <dl className="characteristics">
        {[
          ['Move', scroll.move],
          ['Health', scroll.health],
          ['Save', scroll.save],
          ['Control', scroll.control],
          ['Ward', scroll.ward],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {!!scroll.keywords.length && <p className="keywords">{scroll.keywords.join(' · ')}</p>}
      {!!scroll.weapons.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Weapon / abilities</th>
                <th>Range</th>
                <th>Attacks</th>
                <th>Hit</th>
                <th>Wound</th>
                <th>Rend</th>
                <th>Damage</th>
              </tr>
            </thead>
            <tbody>
              {scroll.weapons.map((weapon, index) => (
                <tr key={index}>
                  <td>
                    <strong>{weapon.name}</strong>
                    <small>
                      {weapon.kind}{' '}
                      {weapon.abilities.length ? '· ' + weapon.abilities.join(', ') : ''}
                    </small>
                  </td>
                  {['Rng', 'Atk', 'Hit', 'Wnd', 'Rnd', 'Dmg'].map((key) => (
                    <td key={key}>{weapon.values[key] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Rules rules={scroll.rules} />
      {scroll.notes.map((note, i) => (
        <p className="notice" key={i}>
          {note}
        </p>
      ))}
    </div>
  );
}
function Unit({ unit, study }: { unit: Study['parsed']['units'][number]; study?: UnitStudy }) {
  return (
    <details className="unit-card">
      <summary>
        <div className="unit-number">{study?.modelCount ?? unit.explicitCount ?? '?'}</div>
        <div className="unit-title">
          <h4>{unit.name}</h4>
          <p>
            {study?.countSource === 'inferred'
              ? 'Model count from profile'
              : unit.explicitCount
                ? 'Declared model count'
                : 'Model count not specified'}
            {unit.general ? ' · General' : ''}
            {unit.reinforced ? ' · Reinforced' : ''}
          </p>
          <div className="tags">
            {study?.roles.map((role, i) => (
              <span key={i}>{role}</span>
            ))}
            {unit.options.map((option) => (
              <span className="option-tag" key={option.id}>
                {option.name}
                {option.points ? ` (+${option.points})` : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="unit-cost">
          {unit.points ?? '—'}
          <small>declared pts</small>
        </div>
        <span className="chevron">⌄</span>
      </summary>
      <div className="unit-content">
        {study?.warscroll ? (
          <Profile scroll={study.warscroll} />
        ) : (
          <p className="notice">
            {study
              ? 'This warscroll is unresolved. Review the matching entries below.'
              : 'Generate a study sheet to load this unit’s rules.'}
          </p>
        )}
        {!!study?.optionRules.length && (
          <>
            <h3>Chosen enhancements & options</h3>
            <Rules rules={study.optionRules} />
          </>
        )}
      </div>
    </details>
  );
}
const sectionTitles: Record<Study['parsed']['choices'][number]['kind'], string> = {
  formation: 'Formation / Army of Renown',
  'spell-lore': 'Spell Lore',
  'prayer-lore': 'Prayer Lore',
  'manifestation-lore': 'Manifestation Lore',
  terrain: 'Faction Terrain',
  'battle-tactics': 'Battle Tactics',
  option: 'Enhancements & Options',
};

function App() {
  const [events, setEvents] = useState<EventSummary[]>([]),
    [eventId, setEventId] = useState(''),
    [roster, setRoster] = useState<Roster>(),
    [playerId, setPlayerId] = useState(''),
    [detail, setDetail] = useState<Detail>();
  const [url, setUrl] = useState(''),
    [refresh, setRefresh] = useState(false),
    [query, setQuery] = useState(''),
    [faction, setFaction] = useState(''),
    [tab, setTab] = useState<'overview' | 'units' | 'original'>('overview'),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const loadEvents = useCallback(async () => {
    const data = await api<EventSummary[]>('/api/events');
    setEvents(data);
    setEventId((current) => current || data[0]?.id || '');
  }, []);
  const loadRoster = useCallback(async () => {
    if (eventId) setRoster(await api<Roster>(`/api/events/${eventId}`));
  }, [eventId]);
  const loadPlayer = useCallback(async () => {
    if (eventId && playerId)
      setDetail(await api<Detail>(`/api/events/${eventId}/players/${playerId}`));
  }, [eventId, playerId]);
  useEffect(() => {
    void loadEvents().catch((e) => setError(e.message));
  }, [loadEvents]);
  useEffect(() => {
    setRoster(undefined);
    setPlayerId('');
    setDetail(undefined);
    setQuery('');
    setFaction('');
    void loadRoster().catch((e) => setError(e.message));
  }, [loadRoster]);
  useEffect(() => {
    setDetail(undefined);
    setTab('overview');
    void loadPlayer().catch((e) => setError(e.message));
  }, [loadPlayer]);
  useEffect(() => {
    let stopped = false,
      previous: string | undefined;
    const poll = async () => {
      try {
        const data = await api<Job[]>('/api/jobs');
        if (stopped) return;
        setJobs(data);
        const signature = data.map((job) => job.id + job.state).join('|');
        if (previous !== undefined && signature !== previous) {
          await loadEvents();
          await loadRoster();
          await loadPlayer();
        }
        previous = signature;
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [loadEvents, loadRoster, loadPlayer]);
  const run = async (operation: () => Promise<Job>) => {
    setError('');
    setBusy(true);
    try {
      const job = await operation();
      setJobs((current) => [...current.filter((item) => item.id !== job.id), job]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const active = jobs.filter((job) => ['running', 'waiting-for-login'].includes(job.state)),
    listJob = active.find((job) => job.eventId === eventId && job.playerId === playerId),
    importing = active.some((job) => job.kind === 'import');
  const latestFailure = [...jobs]
    .reverse()
    .find((job) => job.state === 'failed' && (!job.playerId || job.playerId === playerId));
  const parsed = detail?.study?.parsed ?? detail?.parsed,
    sheet = detail?.study;
  const selectedPlayer = roster?.players.find((player) => player.id === playerId);
  const players =
    roster?.players.filter(
      (player) =>
        (!faction || player.faction === faction) &&
        `${player.name} ${player.faction ?? ''}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const unresolved = sheet?.resolutions.filter((entry) => entry.status !== 'resolved') ?? [];
  const generate = () => run(() => api(`/api/events/${eventId}/players/${playerId}/generate`, {}));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <div>
            Roster study<small>AGE OF SIGMAR · 4TH EDITION</small>
          </div>
        </div>
        <div className="sidebar-body">
          <p className="eyebrow">Your tournaments</p>
          <nav className="event-nav" aria-label="Tournaments">
            {events.map((event) => (
              <button
                key={event.id}
                className={eventId === event.id ? 'selected' : ''}
                onClick={() => setEventId(event.id)}
              >
                <span>{event.name}</span>
                <small>
                  {event.playerCount} players <span>→</span>
                </small>
              </button>
            ))}
          </nav>
          {!events.length && (
            <p className="sidebar-hint">Import an event to start your collection.</p>
          )}
          <form
            className="import-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api('/api/imports', { url, refresh }));
            }}
          >
            <label htmlFor="event-url">Import a BCP event</label>
            <input
              id="event-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.bestcoastpairings.com/event/…"
              required
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={refresh}
                onChange={(e) => setRefresh(e.target.checked)}
              />{' '}
              Refresh saved lists
            </label>
            <button className="button primary" disabled={busy || importing || !url.trim()}>
              Import tournament <span>↗</span>
            </button>
            <p>Sign in manually when Chrome opens. You can stop and resume any import.</p>
          </form>
          {roster && (
            <button
              className="resume-button"
              disabled={importing || busy}
              onClick={() => void run(() => api('/api/imports', { url: roster.url, refresh }))}
            >
              ↻ Reimport / resume this event
            </button>
          )}
        </div>
        <footer className="sidebar-footer">
          <span className="local-dot" /> Local library
          <small>Saved sheets work offline. No AI.</small>
        </footer>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Tournament preparation</span>
          <span className="edition">
            AoS 4 <span> / </span> Rules at generation time
          </span>
        </header>
        {active.map((job) => (
          <div className="job-banner" key={job.id}>
            <span className="spinner" />
            <div>
              <strong>
                {job.kind === 'import' ? 'Importing tournament' : 'Generating study sheet'}
              </strong>
              <p>
                {job.message}
                {job.total > 0 ? ` (${job.completed}/${job.total})` : ''}
              </p>
              {job.state === 'waiting-for-login' && (
                <p>
                  In Chrome, sign in on BCP, then click “Continue collection” in the collector tab.
                </p>
              )}
            </div>
            <button
              onClick={() =>
                void api(`/api/jobs/${job.id}/cancel`, {}).catch((e) => setError(e.message))
              }
            >
              Stop
            </button>
          </div>
        ))}
        {(error || latestFailure) && (
          <div className="error-banner" role="alert">
            {error || latestFailure?.error}{' '}
            {latestFailure?.kind === 'generate' &&
              'Any previous sheet for this list is still available.'}
            <button
              aria-label="Dismiss error"
              onClick={() => {
                setError('');
                setJobs((current) => current.filter((job) => job.id !== latestFailure?.id));
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className="page-heading">
          <p className="eyebrow">Event library</p>
          <h1>{roster?.name ?? 'Prepare your next game'}</h1>
          <p>
            {roster
              ? `${roster.players.length} players · Imported ${new Date(roster.collectedAt).toLocaleDateString('en-GB')} · Select a player to explore their army.`
              : 'Keep your opponents’ lists and the rules that explain them in one place.'}
          </p>
        </div>
        <div className="study-layout">
          <section className="roster-panel" aria-label="Player roster">
            <div className="roster-heading">
              <h2>Roster</h2>
              <span>{players.length}</span>
            </div>
            <label className="sr-only" htmlFor="search">
              Search players
            </label>
            <input
              id="search"
              className="search"
              type="search"
              placeholder="Search player or faction…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="sr-only" htmlFor="faction">
              Faction filter
            </label>
            <select id="faction" value={faction} onChange={(e) => setFaction(e.target.value)}>
              <option value="">All factions</option>
              {[...new Set(roster?.players.map((player) => player.faction).filter(Boolean))]
                .sort()
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
            <div className="player-list">
              {players.map((player) => (
                <button
                  key={player.id}
                  className={'player-row ' + (playerId === player.id ? 'active' : '')}
                  onClick={() => {
                    setPlayerId(player.id);
                    setError('');
                  }}
                >
                  <div className="player-avatar">
                    {player.name
                      .split(' ')
                      .map((word) => word[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                  <div>
                    <strong>{player.name}</strong>
                    <span>{player.faction ?? 'Faction not declared'}</span>
                    <small className={'status ' + player.status}>
                      {player.studyStatus === 'outdated'
                        ? 'Sheet outdated'
                        : player.studyStatus
                          ? `${player.studyStatus === 'ready' ? 'Study ready' : 'Partial study'}`
                          : player.status === 'collected'
                            ? 'List collected'
                            : player.status}
                    </small>
                  </div>
                  <span className="row-arrow">›</span>
                </button>
              ))}
            </div>
            {roster && !players.length && (
              <p className="empty-mini">No players match this search.</p>
            )}
          </section>
          <main className="reader">
            {!playerId ? (
              <div className="empty-state">
                <div className="empty-symbol">✧</div>
                <p className="eyebrow">Know the army across the table</p>
                <h2>Start with a player.</h2>
                <p>
                  Explore their composition, active faction rules, enhancements and warscrolls.
                  Generate once, then return to the saved sheet whenever you need it.
                </p>
                <div className="empty-steps">
                  <span>
                    01 <b>Choose a list</b>
                  </span>
                  <span>
                    02 <b>Generate the sheet</b>
                  </span>
                  <span>
                    03 <b>Read the rules</b>
                  </span>
                </div>
              </div>
            ) : !detail ? (
              <p className="loading">Loading list…</p>
            ) : (
              <>
                <header className="reader-header">
                  <p className="eyebrow">
                    {parsed?.faction ?? detail.player.faction ?? 'Army list'}
                  </p>
                  <div className="reader-title">
                    <div>
                      <h2>{selectedPlayer?.name ?? detail.player.name}</h2>
                      <p>{parsed?.title ?? detail.record?.status ?? 'List pending'}</p>
                    </div>
                    {parsed && (
                      <button
                        className="button primary"
                        disabled={busy || !!listJob || importing}
                        onClick={() => void generate()}
                      >
                        {sheet ? 'Regenerate from Wahapedia' : 'Generate study sheet'}{' '}
                        <span>↗</span>
                      </button>
                    )}
                  </div>
                  {parsed && (
                    <div className="army-stats">
                      <div>
                        <span>Formation / army of renown</span>
                        <strong>{parsed.formation ?? 'Not declared'}</strong>
                      </div>
                      <div>
                        <span>Declared points</span>
                        <strong>
                          {parsed.points ?? '—'}
                          <small> / {parsed.limit ?? '—'}</small>
                        </strong>
                      </div>
                      <div>
                        <span>Drops</span>
                        <strong>{parsed.drops ?? '—'}</strong>
                      </div>
                      <div>
                        <span>Units</span>
                        <strong>{parsed.units.length}</strong>
                      </div>
                    </div>
                  )}
                  <div className="sheet-meta">
                    {sheet ? (
                      <>
                        <span
                          className={
                            'status ' + (sheet.status === 'ready' ? 'collected' : 'unsupported')
                          }
                        >
                          {sheet.status === 'ready' ? 'Saved study' : 'Partial study'}
                        </span>
                        <span>
                          Checked {new Date(sheet.generatedAt).toLocaleString('en-GB')} ·{' '}
                          {sheet.sources.length} sources
                        </span>
                      </>
                    ) : (
                      <span>
                        {detail.stale
                          ? 'The BCP list changed. Generate a new sheet for this version.'
                          : 'Your original list is saved. Generate a sheet to add current rules.'}
                      </span>
                    )}
                  </div>
                </header>
                <nav className="tabs" aria-label="Study views">
                  {(['overview', 'units', 'original'] as const).map((name) => (
                    <button
                      className={tab === name ? 'active' : ''}
                      onClick={() => setTab(name)}
                      key={name}
                    >
                      {name === 'overview'
                        ? 'Overview'
                        : name === 'units'
                          ? `Units (${parsed?.units.length ?? 0})`
                          : 'Original list'}
                    </button>
                  ))}
                </nav>
                <div className="reader-body">
                  {tab === 'original' ? (
                    <>
                      <h3>BCP original</h3>
                      <p className="muted">
                        Archived verbatim. Line numbers in unresolved entries refer to this text.
                      </p>
                      <pre className="original-text">
                        {detail.content?.text ?? 'No text has been collected.'}
                      </pre>
                      {detail.content?.attachments.map((attachment, i) => (
                        <p key={i}>
                          Attachment ({attachment.kind}):{' '}
                          <a
                            href={/^https?:\/\//i.test(attachment.url) ? attachment.url : undefined}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {attachment.url}
                          </a>
                        </p>
                      ))}
                      {detail.record?.reason && <p className="notice">{detail.record.reason}</p>}
                    </>
                  ) : (
                    <>
                      {tab === 'overview' && (
                        <>
                          <div className="section-heading">
                            <h3>Army at a glance</h3>
                            <span>Declared composition</span>
                          </div>
                          <div className="composition">
                            {parsed?.units
                              .filter((unit) => !unit.componentOf)
                              .map((unit) => (
                                <div key={unit.id}>
                                  <span>
                                    {unit.explicitCount ? `${unit.explicitCount}× ` : ''}
                                    {unit.name}
                                  </span>
                                  <small>
                                    {unit.general ? 'General · ' : ''}
                                    {unit.reinforced ? 'Reinforced · ' : ''}
                                    {unit.points ?? '—'} pts
                                  </small>
                                </div>
                              ))}
                          </div>
                          {!sheet && parsed && (
                            <div className="generate-prompt">
                              <h3>Bring the rules alongside the list.</h3>
                              <p>
                                Generation checks current Wahapedia pages and saves the result for
                                offline reading. Entries that need a confirmed match stay visible.
                              </p>
                              <button
                                className="button secondary"
                                disabled={busy || !!listJob || importing}
                                onClick={() => void generate()}
                              >
                                Generate study sheet →
                              </button>
                            </div>
                          )}
                          {!!sheet?.armyRules.length && (
                            <section className="rule-section" aria-label="Battle Traits">
                              <header className="rule-section-heading">
                                <h3>Battle Traits</h3>
                                <p>Common faction rules</p>
                              </header>
                              <Rules rules={sheet.armyRules} sectionTitle="Battle Traits" />
                            </section>
                          )}
                          {parsed?.choices
                            .filter((choice) => !choice.unitId)
                            .map((choice) => {
                              const section = sheet?.selectedRules.find(
                                (item) => item.choice.id === choice.id,
                              );
                              return (
                                <section
                                  className="rule-section"
                                  key={choice.id}
                                  aria-label={sectionTitles[choice.kind]}
                                >
                                  <header className="rule-section-heading">
                                    <h3>{sectionTitles[choice.kind]}</h3>
                                    <p>
                                      {choice.name}
                                      {choice.points ? ` · +${choice.points} pts` : ''}
                                    </p>
                                  </header>
                                  {section?.rules.length ? (
                                    <Rules
                                      rules={section.rules}
                                      sectionTitle={sectionTitles[choice.kind]}
                                      selection={choice.name}
                                    />
                                  ) : (
                                    <p className="muted">
                                      {sheet
                                        ? 'No resolved rule text for this entry yet.'
                                        : 'Rules will appear after generation.'}
                                    </p>
                                  )}
                                  {section?.warscrolls?.map((scroll, i) => (
                                    <details className="manifestation" key={i}>
                                      <summary>{scroll.name}</summary>
                                      <Profile scroll={scroll} />
                                    </details>
                                  ))}
                                </section>
                              );
                            })}
                        </>
                      )}
                      {tab === 'units' &&
                        parsed?.regiments.map((regiment) => (
                          <section key={regiment.id} className="regiment">
                            <div className="section-heading">
                              <h3>{regiment.name}</h3>
                              <span>
                                {
                                  parsed.units.filter((unit) => unit.regimentId === regiment.id)
                                    .length
                                }{' '}
                                entries
                              </span>
                            </div>
                            {parsed.units
                              .filter((unit) => unit.regimentId === regiment.id)
                              .map((unit) => (
                                <Unit
                                  key={unit.id}
                                  unit={unit}
                                  study={sheet?.units.find((item) => item.unitId === unit.id)}
                                />
                              ))}
                          </section>
                        ))}
                      {!!unresolved.length && (
                        <section className="unresolved">
                          <div className="section-heading">
                            <h3>Entries to resolve</h3>
                            <span>{unresolved.length}</span>
                          </div>
                          <p>
                            Only confirmed source text appears in the sheet. Choose the matching
                            source for an ambiguous entry.
                          </p>
                          {unresolved.map((entry) => (
                            <article key={entry.entryId} className="resolution">
                              <strong>{entry.label}</strong>
                              <span className="status unsupported">{entry.status}</span>
                              <p>{entry.message}</p>
                              {entry.candidates.map((candidate) => (
                                <div className="candidate" key={candidate.key}>
                                  <div>
                                    <strong>{candidate.name}</strong>
                                    <small>{candidate.context ?? candidate.url}</small>
                                    <SourceLink url={candidate.url} anchor={candidate.anchor} />
                                  </div>
                                  <button
                                    className="button secondary"
                                    disabled={busy || !!listJob || importing}
                                    onClick={() =>
                                      void run(() =>
                                        api(
                                          `/api/events/${eventId}/players/${playerId}/resolutions`,
                                          { entryId: entry.entryId, candidateKey: candidate.key },
                                        ),
                                      )
                                    }
                                  >
                                    Use this match
                                  </button>
                                </div>
                              ))}
                            </article>
                          ))}
                        </section>
                      )}
                      {!!parsed?.unparsed.length && (
                        <section className="unresolved">
                          <h3>Uninterpreted lines</h3>
                          {parsed.unparsed.map((entry, i) => (
                            <div className="unparsed" key={i}>
                              <span>Line {entry.line}</span>
                              <code>{entry.raw}</code>
                              <small>{entry.reason}</small>
                            </div>
                          ))}
                        </section>
                      )}
                      {sheet && (
                        <details className="sources">
                          <summary>Sources & generation notes ({sheet.sources.length})</summary>
                          {sheet.warnings.map((warning, i) => (
                            <p className="muted" key={i}>
                              {warning}
                            </p>
                          ))}
                          {sheet.sources.map((source) => (
                            <div key={source.url}>
                              <a href={source.url} target="_blank" rel="noreferrer noopener">
                                {source.url}
                              </a>
                              <small>
                                {source.fetchedAt} · SHA-256 {source.hash}
                              </small>
                            </div>
                          ))}
                        </details>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
        <footer className="workspace-footer">
          A factual reading companion · No damage calculations or legality validation.
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
