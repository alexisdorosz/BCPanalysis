# BCP analysis — local roster study

A local English application to study Age of Sigmar 4 army lists. Import a BCP tournament, select a player and generate a factual study sheet from current Wahapedia pages. React/Vite provides the interface and Node/Fastify the API. There is no AI, damage calculation, legality check or authored tactical advice.

## Open the application

Requires Node.js **22.12+** (or 24+) and installed Google Chrome.

```sh
npm install
npm run app
```

Open **http://127.0.0.1:4310**. The application/API bind to loopback only. This command builds the interface before starting; restart after editing source files. Stop with Ctrl+C.

Existing archives appear immediately. Paste a BCP event URL to import another tournament. The app and CLI share the same collection service and dedicated browser profile. Sign in manually on BCP, then click **Continue collection** in the collector tab. Progress and cancellation are available in the app. **Reimport / resume this event** updates the same tournament; **Refresh saved lists** also rereads intact lists. Interrupted imports retain their checkpoints.

Select a player and click **Generate study sheet**. Overview presents declared composition, common faction rules and selected formation, lores, manifestations, tactic cards and terrain. Units groups entries by regiment; expand one for profiles, weapons, keywords, abilities and chosen options. Conditional bonuses remain in the abilities, separate from base characteristics. Original list preserves BCP text verbatim and attachment references. `20x` is an explicit count and is never doubled again for reinforcement; counts inferred from Wahapedia are labelled.

Battle traits, formations and lores appear as titled sections with their introductions and restrictions. Abilities use Wahapedia's phase colours, pictograms, typography and borders, including casting, chanting and command values when present in the source. Original flavour text stays italic and separate from operative facts. Graphics and fonts are served locally from `web/public/wahapedia/`, originally retrieved from `https://wahapedia.ru/aos4/img/` and `https://wahapedia.ru/aos4/fonts/` on 2026-10-09, so the presentation also works offline. Regenerate older sheets once to retrieve this presentation metadata; a missing value is never guessed.

Ambiguous entries offer **Use this match** and a source link. Confirmation saves the association and regenerates the sheet. Removed candidates require a new decision. Unknown lines and unavailable rules stay visible. Some paid upgrades in BCP exports are absent from Wahapedia and cannot be enriched automatically. Future formats are not assumed compatible.

Saved sheets work without internet while the local server is running. **Regenerate from Wahapedia** checks each necessary URL once in that generation and records its URL, retrieval time and SHA-256 fingerprint. Failed refreshes retain the last sheet for the same original content. Changed BCP content invalidates a sheet; unchanged content remains valid after reimport regardless of collection timestamp. Old raw captures and sheet versions remain on disk.

Rules reflect Wahapedia AoS 4 **at generation time**, not a historic event date. Declared handbooks are used for tactic cards; when absent, the newest handbook discovered in navigation is used. Factions, units and rules come from Wahapedia navigation/pages without an event-specific catalog. Spearhead and Path to Glory ability sections are excluded, and Scourge variants remain distinct.

Environment variables: `BCP_DATA_DIR` (default `data`), `BCP_PROFILE_DIR` (default `.local/bcp-profile`), `BCP_PORT` (default `4310`). The profile must be outside the corpus. Simply reading a saved sheet does not refresh sources.

```sh
# Check the private corpus against live sources and save study sheets.
# Shared pages are checked once for this whole validation operation.
npm run validate:corpus -- RpBCJzCBsTCO
```

Enrichment files: `data/events/<event-id>/studies/<player-id>/latest.json`, versioned sheets and `mappings.json` in the same folder, and `study-validation.json` at the event root. They are separate from existing originals and the browser session.

## Local API and modules

`GET /api/events`, `GET /api/events/:eventId` and `GET /api/events/:eventId/players/:playerId` return the library, roster and original/parsed/generated list. `POST /api/imports` takes `{ "url": "…", "refresh": false }`. `POST /api/events/:eventId/players/:playerId/generate` starts generation. `POST .../resolutions` takes `{ "entryId": "…", "candidateKey": "…" }` from a current candidate. Operations return HTTP 202 with a job. `GET /api/jobs` reports progress; `POST /api/jobs/:jobId/cancel` stops work. Jobs live in memory; collection checkpoints, sheets and mappings survive restart. Cross-origin requests are rejected. Profile and corpus files are never served as static assets.

`src/collection-service.ts` is shared by CLI/API, `src/parse-list.ts` interprets lists, `src/wahapedia.ts` extracts sources, `src/generate-study.ts` assembles sheets and `src/study-store.ts` manages local versions/invalidation. The frontend lives in `web/`. Tests cover controlled markup, two tournaments and headless Chrome without BCP credentials. The twenty-list private corpus is also tested when present and is not included in source distribution.

## Install and collect

The CLI remains available and uses installed Chrome without downloading a Playwright browser.

```sh
npm install
npm run collect -- 'https://www.bestcoastpairings.com/event/RpBCJzCBsTCO?active_tab=roster'
```

Chrome opens with a separate local profile and two tabs. Sign in **on the BCP website**, then select **Continue collection** in the **BCP list collector** tab. That tab remains available while the other tab visits each list. Your normal Chrome profile is not used.

Close the browser, click **Stop for now**, or press Ctrl+C to stop. Re-run the same command to resume: previously archived lists are skipped when their roster list identifier, link and player update timestamp are unchanged and their archive checksums are valid. Inaccessible/error records are retried on the next run. An expired session gets one manual sign-in and one retry per run. Any subsequent denial is reported and respected.

To use Playwright's Chromium instead:

```sh
npx playwright install chromium
npm run collect -- '<event-url>' --browser chromium
```

## Other commands

```sh
# Public event/roster only; no browser or authentication
npm run collect -- 'https://www.bestcoastpairings.com/event/RpBCJzCBsTCO' --roster-only

# Read lists again; previous captured originals are retained
npm run collect -- '<event-url>' --refresh

# Regenerate the report offline
npm run report -- RpBCJzCBsTCO

# Inspect a pasted/exported text file without BCP
npm run inspect -- path/to/list.txt --faction 'Lumineth Realm-lords'
npm run example

npm run typecheck
npm test
npm run test:browser
```

Options include `--data-dir <path>`, `--profile-dir <path>`, `--browser chrome|chromium` and `--timeout <milliseconds>`; run `npm run collect -- --help` for details. Profile and corpus locations must be separate, with neither containing the other. Browser integration tests use headless installed Chrome and mocked responses, with no BCP credentials.

## Local files

```text
.local/bcp-profile/                       Browser session; never part of the corpus
data/events/<event-id>/event.json          Event metadata and complete roster
data/events/<event-id>/records/<id>.json    One checkpoint per player
data/events/<event-id>/content/*.json       Immutable captured content and its shape
data/events/<event-id>/content/*.txt        Exact text, without newline conversion
data/events/<event-id>/report.json         Inventory including every original text line
data/events/<event-id>/report.md           Readable status and format report
```

The default session/data folders are ignored by Git. Files are written atomically with private permissions. If you customise their locations, keep those locations out of version control too. The collector never exports browser cookies, credentials, storage state, request headers, traces or session tokens. It archives original list content fields, not expanded user/account/event objects; credential-named fields are excluded. Attachment links are retained as provided and may contain temporary document signatures or expire.

Text lists are marked `collected`. Images, file references, external links, structured lists and unknown non-text payloads are retained and marked `unsupported`; no OCR or document download is attempted. A mixed text/attachment list is also marked `unsupported`, but its text is still inventoried. `absent`, `inaccessible`, `error` and `pending` identify the other outcomes. The report counts only lists actually read from this event, never the example fixture.

The inventory recognises a limited set of English/French headings, bullet modifiers and `Name (points)` unit candidates. It also inventories syntax variants such as decorated regiment headings, `Name -- points`, inline options, model-count prefixes and inline terrain without claiming to parse them. Official-app, War Nexus and Octolith source markers are recognised; unmarked origins remain unknown. Separator lines, application build numbers and literal placeholders are retained without being treated as units or costs. It records candidate modifier associations but does not resolve option names, official unit names, army legality or whether separate costs are included in totals. Unrecognised lines break the candidate modifier association to avoid attaching options to the wrong unit. Language/source detection is based on visible markers, not a general language classifier.

## Access and exits

Public roster reads follow BCP pagination, de-duplicate players and reject repeated non-empty cursors rather than claiming completeness. Lists are read from responses loaded by ordinary BCP list pages after sign-in; no session token is extracted to call a protected API. Collection is sequential. Hidden lists are not opened. A refusal stays a refusal: the collector does not use alternate endpoints, other accounts or external-link crawling.

Exit codes: `0` for a completed run (including archived unsupported formats), `2` for a partial run with pending/inaccessible/error records, `130` for interruption/cancellation, and `1` for startup or fatal errors. A roster-only run returns `0` with list content explicitly pending. Network/API/page changes are reported and saved originals remain available.

The supplied `fixtures/lumineth.txt` is the user's example, transcribed as plain text without chat-only backslash separators. It is a reference for the parser and tests, not a list fetched from BCP.
