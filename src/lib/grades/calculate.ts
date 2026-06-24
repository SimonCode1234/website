import type { ValidatedGrade, CalculatorOptions } from './types';
import { stddev, clamp } from './stats';

/**
 * Weighted average with optional exponential recency decay.
 *
 *   effective_weight(g) = coefficient × e^(−α × daysAgo)
 *
 *   α = 0     → pure coefficient weighting (Pronote-compatible)
 *   α = 0.003 → default; grades from ~231 days ago count at 50%
 *
 * Returns:
 *   average         — final /20 value
 *   confidence      — reliability of this average (0–1)
 *   effectiveGrades — grades that actually contributed
 *   totalWeight     — sum of effective weights (needed by requiredScore)
 */
export function weightedAverage(
  grades: ValidatedGrade[],
  options: CalculatorOptions = {},
): { average: number; confidence: number; effectiveGrades: ValidatedGrade[]; totalWeight: number } {
  const {
    recencyDecay    = 0.003,
    excludeErrorGrades = true,
    referenceDate   = new Date(),
  } = options;

  let eligible = grades.filter(g => g.coefficient > 0);
  if (excludeErrorGrades) {
    eligible = eligible.filter(g => !g.anomalyFlags.some(f => f.severity === 'error'));
  }
  if (eligible.length === 0) {
    return { average: 0, confidence: 0, effectiveGrades: [], totalWeight: 0 };
  }

  const now = referenceDate.getTime();
  const weights = eligible.map(g => {
    const daysAgo = Math.max(0, (now - g.date.getTime()) / 86_400_000);
    return g.coefficient * Math.exp(-recencyDecay * daysAgo);
  });

  const totalWeight  = weights.reduce((s, w) => s + w, 0);
  const weightedSum  = eligible.reduce((sum, g, i) => sum + g.normalized * (weights[i] ?? 0), 0);
  const average      = clamp(weightedSum / totalWeight, 0, 20);

  return { average, confidence: confidence(eligible), effectiveGrades: eligible, totalWeight };
}

/**
 * Reliability score for a computed average.
 *
 * Four factors:
 *   count       (35%) — more grades = more reliable; √(n/10) capped at 1
 *   consistency (30%) — lower variance = more reliable
 *   recency     (20%) — stale data = less reliable; half-life ≈ 139 days
 *   anomalies   (15%) — each anomalous grade reduces confidence by 10%
 */
function confidence(eligible: ValidatedGrade[]): number {
  if (eligible.length === 0) return 0;

  const countFactor       = clamp(Math.sqrt(eligible.length / 10), 0.1, 1);
  const normalized        = eligible.map(g => g.normalized);
  const consistencyFactor = clamp(1 - stddev(normalized) / 20, 0, 1);

  const now         = Date.now();
  const mostRecent  = Math.max(...eligible.map(g => g.date.getTime()));
  const daysSince   = (now - mostRecent) / 86_400_000;
  const recencyFactor = Math.exp(-0.005 * daysSince);

  const anomalyCount  = eligible.filter(g => g.isAnomaly).length;
  const anomalyFactor = clamp(1 - 0.1 * anomalyCount, 0.3, 1);

  return clamp(
    0.35 * countFactor +
    0.30 * consistencyFactor +
    0.20 * recencyFactor +
    0.15 * anomalyFactor,
    0, 1,
  );
}
