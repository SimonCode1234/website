import type { RawGrade, ValidatedGrade, AnomalyFlag } from './types';
import { median, mad, mean, stddev } from './stats';

const COMMON_SCALES = new Set([5, 10, 20, 40, 100]);

function parseDate(raw: Date | string): Date {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${String(raw)}`);
  return d;
}

export function normalizeToTwenty(value: number, outOf: number): number {
  if (outOf <= 0) return 0;
  return Math.max(0, Math.min(20, (value / outOf) * 20));
}

/**
 * Detect anomaly flags for a single grade.
 *
 * Layers:
 *  1. Structural errors   — impossible values, negative, bad coefficient
 *  2. Scale warnings      — unusual denominators
 *  3. Typo detection      — decimal-point errors, wrong-scale entries
 *  4. Statistical outlier — MAD-based (n 4–7) or Z-score (n ≥ 8)
 */
function detectAnomalies(grade: RawGrade, peerNormalized: number[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  // ── 1. Structural ──────────────────────────────────────────────────────────
  if (grade.value < 0) {
    flags.push({ type: 'NEGATIVE_VALUE', severity: 'error',
      message: `Negative value: ${grade.value}` });
  }
  if (grade.value > grade.outOf && grade.value >= 0) {
    flags.push({ type: 'IMPOSSIBLE_VALUE', severity: 'error',
      message: `${grade.value} exceeds the maximum ${grade.outOf}` });
  }
  if (grade.coefficient < 0) {
    flags.push({ type: 'ZERO_COEFFICIENT', severity: 'error',
      message: 'Coefficient cannot be negative' });
  }
  if (grade.coefficient === 0) {
    flags.push({ type: 'ZERO_COEFFICIENT', severity: 'warning',
      message: 'Coefficient is 0 — will not count toward the average' });
  }

  // ── 2. Scale ───────────────────────────────────────────────────────────────
  if (!COMMON_SCALES.has(grade.outOf)) {
    flags.push({ type: 'UNUSUAL_SCALE', severity: 'info',
      message: `Unusual scale /${grade.outOf} (common: /5 /10 /20 /40 /100)` });
  }

  // ── 3. Typo detection ──────────────────────────────────────────────────────
  // Pattern A: value looks like a decimal-shifted entry (1.5 on /20 → likely 15)
  if (grade.outOf === 20 && grade.value > 0 && grade.value < 2) {
    const candidate = grade.value * 10;
    if (candidate <= 20) {
      flags.push({ type: 'ENTRY_TYPO_SUSPECTED', severity: 'warning',
        message: `${grade.value}/20 is unusually low — did you mean ${candidate}/20?`,
        suggestedFix: { value: candidate } });
    }
  }
  // Pattern B: value too large for /20 but fits /100
  if (grade.outOf === 20 && grade.value > 20 && grade.value <= 100) {
    flags.push({ type: 'ENTRY_TYPO_SUSPECTED', severity: 'warning',
      message: `${grade.value}/20 exceeds scale — possible scale mismatch ` +
        `(as /100 this would be ${((grade.value / 100) * 20).toFixed(1)}/20)`,
      suggestedFix: { outOf: 100 } });
  }

  // ── 4. Statistical outlier ─────────────────────────────────────────────────
  // Needs ≥ 4 peers. Uses modified Z-score (MAD) for small samples (n < 8),
  // classic Z-score for larger ones. Both are more robust than raw Z for the
  // skewed, small distributions typical in grade data.
  const n = peerNormalized.length;
  if (n >= 4) {
    const gradeNorm = normalizeToTwenty(Math.max(0, grade.value), grade.outOf);
    let isOutlier = false;

    if (n < 8) {
      const med = median(peerNormalized);
      const m   = mad(peerNormalized);
      const modZ = m > 0 ? Math.abs(0.6745 * (gradeNorm - med) / m) : 0;
      isOutlier = modZ > 3.5;
    } else {
      const m = mean(peerNormalized);
      const s = stddev(peerNormalized);
      isOutlier = s > 0 && Math.abs(gradeNorm - m) / s > 2.5;
    }

    if (isOutlier) {
      const avg = mean(peerNormalized).toFixed(1);
      flags.push({ type: 'STATISTICAL_OUTLIER', severity: 'info',
        message: `Grade (${gradeNorm.toFixed(1)}/20) is a statistical outlier ` +
          `vs. your subject average (${avg}/20)` });
    }
  }

  return flags;
}

/**
 * Validate and enrich a batch of raw grades.
 * Grades in the same subject share peer context for outlier detection.
 */
export function validateGrades(rawGrades: RawGrade[]): ValidatedGrade[] {
  const bySubject = new Map<string, RawGrade[]>();
  for (const g of rawGrades) {
    const list = bySubject.get(g.subject) ?? [];
    list.push(g);
    bySubject.set(g.subject, list);
  }

  return rawGrades.map(raw => {
    const date      = parseDate(raw.date);
    const safeValue = isFinite(raw.value)       ? raw.value       : 0;
    const safeOutOf = isFinite(raw.outOf) && raw.outOf > 0 ? raw.outOf : 20;
    const safeCoeff = isFinite(raw.coefficient) ? raw.coefficient : 1;
    const normalized = normalizeToTwenty(Math.max(0, safeValue), safeOutOf);

    const peers = bySubject.get(raw.subject) ?? [];
    const peerNormalized = peers
      .filter(p => p.id !== raw.id && isFinite(p.value) && p.value >= 0 && p.outOf > 0)
      .map(p => normalizeToTwenty(p.value, p.outOf));

    const anomalyFlags = detectAnomalies(raw, peerNormalized);
    const hasError   = anomalyFlags.some(f => f.severity === 'error');
    const hasWarning = anomalyFlags.some(f => f.severity === 'warning');
    const confidence = hasError ? 0.1 : hasWarning ? 0.7 : anomalyFlags.length > 0 ? 0.9 : 1.0;

    return {
      id: raw.id, value: safeValue, outOf: safeOutOf, coefficient: safeCoeff,
      date, subject: raw.subject, topic: raw.topic, title: raw.title,
      isExam: raw.isExam ?? false,
      normalized, isAnomaly: anomalyFlags.length > 0, anomalyFlags, confidence,
    };
  });
}
