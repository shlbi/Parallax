import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENT_BYTES, normalizeSourceUrl, validateAttachmentBatch,
  stageAttachmentMetadata, clampProgress, replayWindow, replayTelemetry,
  replayScorePoints, replayClaimCoverage,
} from '../lib/workspace-regressions.ts';

const file = (changes = {}) => ({name: 'reference.png', type: 'image/png', size: 1024, ...changes});
const batches = [8, 13, 6, 19, 11, 24, 14, 7, 21, 16, 28, 18];
// IDs are the inspected Northlight fixture's 22 claims and 12 event references.
// These are unit fixtures, not a browser or live fixture integration test.
const claims = Array.from({length: 22}, (_, i) => ({id: `r${String(i + 1).padStart(2, '0')}`}));
const events = ['r11', 'r01', 'r02', 'r04', 'r05', 'r08', 'r09', 'r12', 'r22', 'r18', 'r19', 'r07']
  .map(relation => ({relation}));

test('blank source URL remains optional', () => assert.equal(normalizeSourceUrl('  '), ''));
test('valid URL is trimmed and normalized', () => assert.equal(normalizeSourceUrl(' HTTPS://example.com '), 'https://example.com/'));
test('valid URL retains path, encoded query, port, and fragment', () => assert.equal(normalizeSourceUrl('https://example.com:8443/a?q=one%20two#source'), 'https://example.com:8443/a?q=one%20two#source'));
for (const invalid of ['https://', 'http://', 'https:///example.com', '//example.com', 'example.com',
  'javascript:alert(1)', 'file:///tmp/a', 'ftp://example.com', 'https://example.com/a b',
  'https://example.com\\@private', 'https://example.com/\u0000', 'https://user:password@example.com',
  'https://example.com:99999']) {
  test(`invalid source URL rejected: ${JSON.stringify(invalid)}`, () => assert.throws(() => normalizeSourceUrl(invalid)));
}
test('overlong source URL rejected', () => assert.throws(() => normalizeSourceUrl('https://example.com/' + 'a'.repeat(2048))));
for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.png', 'image/png'],
  ['a.webp', 'image/webp'], ['a.pdf', 'application/pdf'], ['a.txt', 'text/plain'],
  ['a.csv', 'text/csv'], ['a.csv', 'application/vnd.ms-excel'], ['a.json', 'application/json'], ['A.PNG', '']]) {
  test(`supported attachment ${name} (${type || 'no browser MIME'})`, () => assert.doesNotThrow(() => validateAttachmentBatch(0, [file({name, type})])));
}
test('drop and picker can share validation; executable suffix rejected', () => assert.throws(() => validateAttachmentBatch(0, [file({name: 'run.exe', type: 'application/octet-stream'})])));
test('executable disguised as image MIME is rejected by suffix', () => assert.throws(() => validateAttachmentBatch(0, [file({name: 'run.exe'})])));
test('image suffix with incompatible MIME rejected', () => assert.throws(() => validateAttachmentBatch(0, [file({type: 'application/x-msdownload'})])));
test('SVG/HTML active content not accepted', () => {
  assert.throws(() => validateAttachmentBatch(0, [file({name: 'image.svg', type: 'image/svg+xml'})]));
  assert.throws(() => validateAttachmentBatch(0, [file({name: 'page.html', type: 'text/html'})]));
});
test('all-or-nothing batch rejects a bad file among good files', () => assert.throws(() => validateAttachmentBatch(0, [file(), file({name: 'script.js'})])));
test('size boundary is inclusive', () => assert.doesNotThrow(() => validateAttachmentBatch(0, [file({size: MAX_ATTACHMENT_BYTES})])));
test('empty, oversized and nonfinite attachment sizes rejected', () => {
  for (const size of [0, -1, 1.5, Infinity, NaN, MAX_ATTACHMENT_BYTES + 1]) assert.throws(() => validateAttachmentBatch(0, [file({size})]));
});
test('8 retained references leave no ninth slot', () => assert.throws(() => validateAttachmentBatch(8, [file()])));
test('8 total references allowed including retained ones', () => assert.doesNotThrow(() => validateAttachmentBatch(7, [file()])));
test('negative attachment count rejected', () => assert.throws(() => validateAttachmentBatch(-1, [])));
test('reopening and restaging a file-only draft preserves metadata', () => {
  const initial = [file()];
  assert.deepEqual(stageAttachmentMetadata(initial, []), initial);
});
test('new attachments are added alongside retained references', () => assert.equal(stageAttachmentMetadata([file()], [file({name: 'new.png'})]).length, 2));
test('staging clones metadata and discards File-like extra properties', () => {
  const retained = [file({privateBytes: 'do not serialize'})];
  const output = stageAttachmentMetadata(retained, []);
  assert.notEqual(output[0], retained[0]);
  assert.deepEqual(Object.keys(output[0]).sort(), ['name', 'size', 'type']);
});
test('deleting retained reference stays deleted at restaging', () => assert.deepEqual(stageAttachmentMetadata([], []), []));
test('retained references count toward limits even at final staging', () => assert.throws(() => stageAttachmentMetadata(Array.from({length: 8}, () => file()), [file()])));
test('progress clamps invalid and out-of-range values', () => {
  assert.equal(clampProgress(-1), 0); assert.equal(clampProgress(1000), 100);
  assert.equal(clampProgress(NaN), 0); assert.equal(clampProgress(Infinity), 0);
});
test('replay endpoint is last slot at phase one, not past the array', () => assert.deepEqual(replayWindow(100, 12), {progress: 100, index: 11, phase: 1}));
test('empty replay is safe', () => {
  assert.deepEqual(replayWindow(50, 0), {progress: 50, index: -1, phase: 0});
  assert.equal(replayTelemetry(100, []).total, 0);
  assert.deepEqual(replayScorePoints([], 50), []);
});
test('at zero, cumulative chart has zero values and no future total', () => {
  const state = replayTelemetry(0, batches);
  assert.equal(state.total, 0); assert.deepEqual(state.points, [{position: 0, value: 0}]);
  assert.ok(state.values.every(value => value === 0));
});
test('halfway includes only completed batches', () => {
  const state = replayTelemetry(50, batches);
  assert.equal(state.total, 81);
  assert.ok(state.points.every(point => point.position <= 50 && point.value <= 81));
  assert.ok(state.values.slice(6).every(value => value === 0));
});
test('final cumulative sample is exactly 185', () => {
  const state = replayTelemetry(100, batches);
  assert.equal(state.total, 185); assert.equal(state.exactTotal, 185);
  assert.deepEqual(state.points.at(-1), {position: 100, value: 185});
});
test('cumulative curve is monotonic, bounded and cursor-aligned at 1001 positions', () => {
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const progress = i / 10, state = replayTelemetry(progress, batches);
    assert.ok(state.exactTotal >= previous && state.exactTotal <= 185);
    assert.equal(state.points.at(-1).position, progress);
    assert.equal(state.points.at(-1).value, state.exactTotal);
    assert.ok(state.points.every(point => point.position <= progress + 1e-9 && point.value <= state.exactTotal));
    previous = state.exactTotal;
  }
});
test('single-sample cumulative series interpolates correctly', () => assert.deepEqual(replayTelemetry(25, [8]).points, [{position: 0, value: 0}, {position: 25, value: 2}]));
test('bad synthetic samples rejected', () => {
  for (const value of [NaN, -1, Infinity]) assert.throws(() => replayTelemetry(30, [value]));
});
test('future score values are absent before their event', () => {
  assert.deepEqual(replayScorePoints([20, 90], 25), [{position: 0, value: 20}, {position: 25, value: 20}]);
});
test('score event changes are steps, not invented interpolated scores', () => assert.deepEqual(replayScorePoints([20, 90], 50), [
  {position: 0, value: 20}, {position: 50, value: 20}, {position: 50, value: 90},
]));
test('replay highlights expose 10 untimed claims instead of claiming complete history', () => {
  const coverage = replayClaimCoverage(claims, events, 100);
  assert.equal(coverage.highlighted.length, 12); assert.equal(coverage.untimed.length, 10);
  assert.equal(coverage.future.length, 0);
  assert.equal(coverage.highlighted.length + coverage.untimed.length, claims.length);
});
test('first event appears, future events do not, untimed claims remain explicit', () => {
  const coverage = replayClaimCoverage(claims, events, 0);
  assert.deepEqual(coverage.highlighted.map(c => c.id), ['r11']);
  assert.equal(coverage.future.length, 11); assert.equal(coverage.untimed.length, 10);
});
test('coverage respects supplied filtered claim subset', () => assert.deepEqual(replayClaimCoverage([{id: 'r03'}], events, 100), {
  highlighted: [], untimed: [{id: 'r03'}], future: [],
}));
test('repeated event references do not duplicate claims', () => assert.equal(replayClaimCoverage([{id: 'one'}], [{relation: 'one'}, {relation: 'one'}], 100).highlighted.length, 1));
test('empty timeline leaves all claims explicitly untimed', () => assert.deepEqual(replayClaimCoverage([{id: 'one'}], [], 100), {
  highlighted: [], untimed: [{id: 'one'}], future: [],
}));
test('coverage helpers do not mutate their inputs', () => {
  const source = Object.freeze([Object.freeze({id: 'one'})]);
  const timeline = Object.freeze([Object.freeze({relation: 'one'})]);
  assert.equal(replayClaimCoverage(source, timeline, 100).highlighted.length, 1);
});

for (const extension of ['__proto__', 'constructor']) {
  test(`inherited object property is not an allowed extension: ${extension}`, () => {
    assert.throws(() => validateAttachmentBatch(0, [file({name: `file.${extension}`, type: ''})]));
  });
}
