import { StudyStore } from './study-store.js';
import { generateStudy } from './generate-study.js';
import { SourceSession } from './wahapedia.js';
import { safeId } from './types.js';

// A single validation operation checks each shared source once for the whole corpus.
const eventId = safeId(process.argv[2] ?? 'RpBCJzCBsTCO'),
  store = new StudyStore(process.env.BCP_DATA_DIR ?? 'data');
const archive = store.archive(eventId),
  event = await archive.readEvent(),
  sources = new SourceSession();
const results = [];
for (const player of event.players) {
  try {
    const sheet = await generateStudy(store, eventId, player.id, {
      loader: (url) => sources.get(url),
    });
    const result = {
      playerId: player.id,
      status: sheet.status,
      units: sheet.parsed.units.length,
      resolvedUnits: sheet.units.filter((unit) => !!unit.warscroll).length,
      armyRules: sheet.armyRules.length,
      selectedRules: sheet.selectedRules.reduce((sum, item) => sum + item.rules.length, 0),
      unresolved: sheet.resolutions
        .filter((item) => item.status !== 'resolved')
        .map((item) => ({
          label: item.label,
          status: item.status,
          candidates: item.candidates.map((candidate) => candidate.name),
        })),
      warnings: sheet.warnings.slice(1),
    };
    results.push(result);
    console.log(
      `${player.id}: ${result.status}, ${result.resolvedUnits}/${result.units} units, ${result.unresolved.length} unresolved choices.`,
    );
  } catch (error) {
    const result = { playerId: player.id, error: (error as Error).message };
    results.push(result);
    console.log(`${player.id}: ${result.error}`);
  }
}
await archive.writeJson('study-validation.json', {
  eventId,
  checkedAt: new Date().toISOString(),
  sourceCount: sources.sources.length,
  results,
});
console.log(
  `Validated ${results.length} lists against ${sources.sources.length} source pages. Report: ${archive.root}/study-validation.json`,
);
if (results.some((result) => 'error' in result)) process.exitCode = 1;
