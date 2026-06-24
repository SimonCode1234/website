import type { ValidatedGrade, TrendAnalysis, TrendDirection } from './types';
import { linearRegression, clamp } from './stats';

// 0.015 pts/day ≈ 0.45 pts/month — minimum slope to declare a direction
const SLOPE_THRESHOLD      = 0.015;
// Only project if the regression explains ≥ 25% of variance
const MIN_R2_FOR_PROJECTION = 0.25;
// Slope considered full-strength: 0.08 pts/day ≈ 2.4 pts/month
const MAX_MEANINGFUL_SLOPE  = 0.08;

/**
 * Analyse grade trend via OLS linear regression.
 *
 * Only grades with no error-level anomalies and coefficient > 0 are used,
 * so bad entries do not distort the trend line.
 *
 * Trend strength = normalised(|slope|) × √R²
 * This blends how steep the trend is with how well the data fits a line.
 * A steep slope with noisy data scores lower than a steady, consistent change.
 */
export function analyzeTrend(grades: ValidatedGrade[]): TrendAnalysis {
  const clean = grades.filter(
    g => g.coefficient > 0 && !g.anomalyFlags.some(f => f.severity === 'error'),
  );

  if (clean.length < 2) {
    return {
      direction: 'stable', strength: 0, slope: 0, r2: 0,
      projected30d: clean.length === 1 ? (clean[0]?.normalized ?? null) : null,
      projected90d: clean.length === 1 ? (clean[0]?.normalized ?? null) : null,
      dataPoints: clean.length,
    };
  }

  const sorted = [...clean].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0     = sorted[0]!.date.getTime();
  const points = sorted.map(g => ({ x: (g.date.getTime() - t0) / 86_400_000, y: g.normalized }));

  const { slope, intercept, r2 } = linearRegression(points);
  const lastX = points[points.length - 1]!.x;

  const project = (dx: number): number | null =>
    r2 >= MIN_R2_FOR_PROJECTION ? clamp(slope * (lastX + dx) + intercept, 0, 20) : null;

  const direction: TrendDirection =
    slope > SLOPE_THRESHOLD  ? 'improving' :
    slope < -SLOPE_THRESHOLD ? 'declining'  : 'stable';

  const slopeNorm = clamp(Math.abs(slope) / MAX_MEANINGFUL_SLOPE, 0, 1);
  const strength  = clamp(slopeNorm * Math.sqrt(r2), 0, 1);

  return { direction, strength, slope, r2, projected30d: project(30), projected90d: project(90), dataPoints: clean.length };
}
