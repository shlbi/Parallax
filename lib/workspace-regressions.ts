/** Pure state helpers shared by the demo UI and its dependency-free regression tests.
 * These checks validate local staging, not network authorization or file safety.
 * Server-side validation and durable historical events belong to later batches.
 */
export type AttachmentMetadata = {name: string; type: string; size: number};
export type ChartPoint = {position: number; value: number};
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.json';

const fileTypes: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'],
  pdf: ['application/pdf'], txt: ['text/plain'],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  json: ['application/json', 'text/json', 'text/plain'],
};

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** Optional URL, normalized for the draft. Never fetches or trusts a source. */
export function normalizeSourceUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';
  if (value.length > 2048 || (/\s|\\/u.test(value) || hasControlCharacters(value))
      || !/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(value)) {
    throw new Error('Use a valid, full HTTP or HTTPS source URL.');
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Use a valid, full HTTP or HTTPS source URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Source URLs must use HTTP or HTTPS and must not include credentials.');
  }
  return url.href;
}

/** Used by both the picker and drag/drop. MIME may be absent in a browser. */
export function validateAttachmentBatch(existingCount: number, added: readonly AttachmentMetadata[]): void {
  if (!Number.isInteger(existingCount) || existingCount < 0) throw new Error('Invalid attachment count.');
  if (existingCount + added.length > MAX_ATTACHMENTS) {
    throw new Error('This preview supports up to 8 files per draft, including retained references.');
  }
  for (const file of added) {
    const extension = file.name.toLowerCase().split('.').pop() || '';
    const mimeTypes = Object.prototype.hasOwnProperty.call(fileTypes, extension) ? fileTypes[extension] : undefined;
    if (!file.name.includes('.') || !mimeTypes || hasControlCharacters(file.name)
        || (file.type && !mimeTypes.includes(file.type.toLowerCase()))) {
      throw new Error('Supported reference files: JPEG, PNG, WebP, PDF, TXT, CSV and JSON.');
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each preview file must be nonempty and 10 MB or smaller.');
    }
  }
}

/** Preserve metadata after a modal closes, without claiming File bytes survive. */
export function stageAttachmentMetadata(
  retained: readonly AttachmentMetadata[], fresh: readonly AttachmentMetadata[],
): AttachmentMetadata[] {
  validateAttachmentBatch(0, retained);
  validateAttachmentBatch(retained.length, fresh);
  return [...retained, ...fresh].map(({name, type, size}) => ({name, type, size}));
}

export function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
}

export function replayWindow(progress: number, count: number) {
  const bounded = clampProgress(progress);
  if (!Number.isSafeInteger(count) || count <= 0) return {progress: bounded, index: -1, phase: 0};
  const position = bounded / 100 * count;
  const index = Math.min(count - 1, Math.floor(position));
  return {progress: bounded, index, phase: position - index};
}

/** Only observed portions are plotted; no line or area extends past the cursor. */
export function replayTelemetry(progress: number, batches: readonly number[]) {
  if (batches.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid replay sample.');
  const window = replayWindow(progress, batches.length);
  const values = batches.map((value, i) => i < window.index ? value : i === window.index ? value * window.phase : 0);
  const points: ChartPoint[] = [{position: 0, value: 0}];
  let exactTotal = 0;
  for (let i = 0; i < window.index; i++) {
    exactTotal += values[i];
    points.push({position: (i + 1) / batches.length * 100, value: exactTotal});
  }
  if (window.index >= 0) exactTotal += values[window.index];
  if (window.progress > points[points.length - 1].position) points.push({position: window.progress, value: exactTotal});
  return {...window, values, points, exactTotal, total: Math.floor(exactTotal)};
}

/** Events take effect at the beginning of their replay slot. Scores are stepwise,
 * not an interpolation suggesting a claim's evidence score changes over time. */
export function replayScorePoints(scores: readonly number[], progress: number): ChartPoint[] {
  const {index, progress: bounded} = replayWindow(progress, scores.length);
  if (index < 0) return [];
  const points: ChartPoint[] = [{position: 0, value: scores[0]}];
  for (let i = 1; i <= index; i++) {
    const position = i / scores.length * 100;
    points.push({position, value: scores[i - 1]}, {position, value: scores[i]});
  }
  if (bounded > points[points.length - 1].position) points.push({position: bounded, value: scores[index]});
  return points;
}

/** A timeline mention is not a discovery date. Keep un-timed claims separate;
 * never invent historical timestamps to make the final replay count equal 100%. */
export function replayClaimCoverage<T extends {id: string}>(
  claims: readonly T[], events: readonly {relation: string}[], progress: number,
): {highlighted: T[]; untimed: T[]; future: T[]} {
  const {index} = replayWindow(progress, events.length);
  const all = new Set(events.map(event => event.relation));
  const seen = new Set(events.slice(0, index + 1).map(event => event.relation));
  return {
    highlighted: claims.filter(claim => seen.has(claim.id)),
    untimed: claims.filter(claim => !all.has(claim.id)),
    future: claims.filter(claim => all.has(claim.id) && !seen.has(claim.id)),
  };
}
