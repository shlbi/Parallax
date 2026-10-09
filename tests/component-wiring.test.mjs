// Static wiring checks, NOT rendered browser or end-to-end tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const intake = readFileSync(new URL('../app/case-intake.tsx', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../app/analysis-panels.tsx', import.meta.url), 'utf8');

test('intake calls the tested URL parser when staging', () => {
  assert.match(intake, /from '@\/lib\/workspace-regressions'/);
  assert.match(intake, /sourceUrl = normalizeSourceUrl\(url\)/);
  assert.match(intake, /url: sourceUrl/);
});
test('picker and drop events route through the same validated handler', () => {
  assert.match(intake, /addFiles\(event\.dataTransfer\.files\)/);
  assert.match(intake, /addFiles\(event\.target\.files\)/);
  assert.match(intake, /validateAttachmentBatch\(retained\.length \+ files\.length, added\)/);
});
test('intake restores metadata and merges it on staging', () => {
  assert.match(intake, /initial\?\.files\.map/);
  assert.match(intake, /stageAttachmentMetadata\(retained, files\)/);
  assert.match(intake, /files: references/);
  assert.match(intake, /reference retained/);
});
test('preview object URLs have a cleanup path', () => {
  assert.match(intake, /URL\.createObjectURL\(file\)/);
  assert.match(intake, /URL\.revokeObjectURL\(source\)/);
});
test('cumulative and score chart consume the tested bounded points', () => {
  assert.match(analytics, /replayTelemetry\(progress, batches\)/);
  assert.match(analytics, /points=\{telemetry\.points\}/);
  assert.match(analytics, /points=\{replayScorePoints\(scores, progress\)\}/);
  assert.match(analytics, /last\.position \* 2\.8/);
});
test('incomplete history is explicitly labeled, not silently backfilled', () => {
  assert.match(analytics, /replayClaimCoverage\(claims, events, progress\)/);
  assert.match(analytics, /Timeline highlights/);
  assert.match(analytics, /claims have no timeline event/);
  assert.doesNotMatch(analytics, /Every chart follows the replay cursor/);
});
test('existing public component exports remain compatible with the workspace', () => {
  for (const name of ['AnalysisPanel', 'BottomAnalysis', 'AskPanel']) {
    assert.match(analytics, new RegExp(`export function ${name}\\(`));
  }
  assert.match(intake, /export function CaseIntake\(/);
  assert.match(intake, /export type IntakeDraft/);
});
