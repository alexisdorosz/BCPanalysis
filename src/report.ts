import { analyseText, type FormatAnalysis, type ObservationKind } from './analysis.js';
import { Archive } from './archive.js';
import { type CollectionRecord, type EventSnapshot, type Status } from './types.js';

export interface CorpusReport {
  schemaVersion: 1;
  eventId: string;
  generatedAt: string;
  totalPlayers: number;
  statusCounts: Record<Status, number>;
  formats: { signature: string; source: string; language: string; players: string[] }[];
  sourceCounts: Record<string, number>;
  observations: { kind: ObservationKind; listCount: number; lineCount: number; examples: string[] }[];
  players: { record: CollectionRecord; analysis?: FormatAnalysis; archiveError?: string }[];
}

function cell(value: unknown): string {
  return String(value ?? '—').replace(/[\r\n\t]/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/([`<>])/g, '\\$1');
}

export function reportMarkdown(event: EventSnapshot, report: CorpusReport): string {
  const output = [
    `# BCP format inventory — ${cell(event.name)}`, '',
    `Event: ${event.url}`, `Generated: ${report.generatedAt}`, '',
    `${report.totalPlayers} players; ${report.statusCounts.collected} text lists collected; ${report.statusCounts.unsupported} records with unimplemented supports; ${report.statusCounts.pending} pending.`, '',
    'This is a format inventory, not a validated army parser. Every original text line is retained in the JSON report. Language labels are based on recognised headings only.', '',
    '## Collection status', '',
    '| Player | Faction | Status | Supports | Details |', '| --- | --- | --- | --- | --- |',
  ];
  for (const { record, archiveError } of report.players) output.push(`| ${cell(record.player.name)} | ${cell(record.player.faction)} | ${record.status} | ${cell(record.supports?.join(', '))} | ${cell(archiveError ?? record.reason)} |`);
  output.push('', '## Observed text formats', '');
  if (!report.formats.length) output.push('No event text has been collected yet. The supplied Lumineth fixture is not counted as event evidence.');
  else {
    output.push(`Recognised source markers: ${Object.entries(report.sourceCounts).map(([source, count]) => `${source}: ${count}`).join('; ')}.`, '',
      'Groups below describe observed combinations of optional labels and syntax, not independently validated export formats.', '');
  }
  for (const [index, format] of report.formats.entries()) {
    output.push(`- Format ${index + 1}: ${format.source}, ${format.language}; ${format.players.length} list(s).`);
  }
  output.push('', '## Cross-list syntax observations', '', '| Observation | Lists | Lines | Examples |', '| --- | --- | --- | --- |');
  for (const observation of report.observations) output.push(`| ${observation.kind} | ${observation.listCount} | ${observation.lineCount} | ${cell(observation.examples.join('; '))} |`);
  for (const { record, analysis, archiveError } of report.players) {
    if (!analysis && !record.archivePath) continue;
    output.push('', `## ${cell(record.player.name)}`, '', `List ID: ${cell(record.player.listId)}. Archive: ${cell(record.archivePath)}.`);
    if (archiveError) { output.push('', `Archive integrity error: ${cell(archiveError)}`); continue; }
    if (!analysis) { output.push('', 'No recognised text to inventory; review the original JSON and attachment references.'); continue; }
    output.push('', `Source: ${analysis.source}; language: ${analysis.language}; line endings: ${analysis.lineEnding}.`,
      `Sections: ${cell(analysis.conventions.sections.join('; '))}.`,
      `Labels: ${cell(analysis.conventions.labels.join('; '))}.`,
      `Bullets: ${cell(analysis.conventions.bullets.join(', '))}.`,
      `Unit syntax: ${cell(analysis.conventions.unitSyntax.join(', '))}.`,
      `${analysis.counts['unit-candidate'] ?? 0} unit candidates; ${analysis.counts.reinforcement ?? 0} reinforcement markers; ${analysis.counts.option ?? 0} other unit options.`,
      '', '### Ambiguities', '');
    if (!analysis.ambiguities.length) output.push('No structural ambiguity detected by the current inventory heuristics. Rules and names remain unvalidated.');
    else {
      output.push('| Line | Original | Observation |', '| --- | --- | --- |');
      for (const item of analysis.ambiguities) output.push(`| ${item.line} | ${cell(analysis.lines[item.line - 1]?.raw)} | ${cell(item.reason)} |`);
    }
  }
  output.push('', '## Parser design boundaries', '',
    '- Candidate units and modifier associations are inferred from text structure only.',
    '- Unknown lines and unknown formats require review; they are not silently discarded.',
    '- Separate point costs are not summed or assumed to be included in unit totals.',
    '- Images, files, external links and structured lists are retained without OCR or semantic interpretation.',
    '- Attachment URLs may expire. This collector does not download documents.',
    '- Wahapedia rules, tactical roles and damage estimates are outside this collection milestone.', '');
  return output.join('\n');
}

export async function writeReport(event: EventSnapshot, archive: Archive): Promise<CorpusReport> {
  const report: CorpusReport = {
    schemaVersion: 1, eventId: event.id, generatedAt: new Date().toISOString(), totalPlayers: event.players.length,
    statusCounts: { pending: 0, collected: 0, absent: 0, inaccessible: 0, unsupported: 0, error: 0 }, formats: [], sourceCounts: {}, observations: [], players: [],
  };
  const formats = new Map<string, CorpusReport['formats'][number]>();
  const observations = new Map<ObservationKind, CorpusReport['observations'][number]>();
  for (const player of event.players) {
    const record = await archive.readRecord(player.id) ?? {
      schemaVersion: 1, eventId: event.id, player, status: 'pending', attemptedAt: event.collectedAt,
    };
    const item: CorpusReport['players'][number] = { record };
    if (record.archivePath) {
      try {
        const content = await archive.readContent(record);
        if (content?.text?.trim()) {
          item.analysis = analyseText(content.text, player.faction);
          report.sourceCounts[item.analysis.source] = (report.sourceCounts[item.analysis.source] ?? 0) + 1;
          const observedHere = new Set<ObservationKind>();
          for (const observation of item.analysis.observations) {
            let group = observations.get(observation.kind);
            if (!group) { group = { kind: observation.kind, listCount: 0, lineCount: 0, examples: [] }; observations.set(observation.kind, group); }
            group.lineCount++;
            if (!observedHere.has(observation.kind)) { group.listCount++; observedHere.add(observation.kind); }
            if (group.examples.length < 3 && !group.examples.includes(observation.raw)) group.examples.push(observation.raw);
          }
          let group = formats.get(item.analysis.signature);
          if (!group) {
            group = { signature: item.analysis.signature, source: item.analysis.source, language: item.analysis.language, players: [] };
            formats.set(item.analysis.signature, group);
          }
          group.players.push(player.id);
        }
      } catch (error) { item.archiveError = (error as Error).message; }
    }
    report.statusCounts[record.status]++;
    report.players.push(item);
  }
  report.formats = [...formats.values()];
  report.observations = [...observations.values()];
  await archive.writeJson('report.json', report);
  await archive.writeText('report.md', reportMarkdown(event, report));
  return report;
}
