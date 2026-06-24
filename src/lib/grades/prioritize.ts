import type { SubjectStats, StudyPriority, EngineOptions } from './types';
import { clamp } from './stats';

const DEFAULT_TARGET = 14;

/**
 * Study priority engine — composite score (0–100):
 *
 *  35 pts  performance gap    how far below target?
 *  25 pts  trend danger       declining → urgent; improving → lower priority
 *  20 pts  subject weight     high-coefficient subjects matter more to GPA
 *  15 pts  improvement ease   potential × consistency (where effort pays off)
 *   5 pts  data sparsity      few grades → more data needed before conclusions
 */
export function computeStudyPriorities(
  subjects: SubjectStats[],
  options: EngineOptions = {},
): StudyPriority[] {
  if (subjects.length === 0) return [];

  const { subjectCoefficients = {}, targetAverage = DEFAULT_TARGET } = options;
  const maxCoeff = Math.max(...Object.values(subjectCoefficients), 1);

  const scored = subjects.map(s => {
    const reasons: string[] = [];
    let score = 0;

    // 1. Performance gap
    const gap = Math.max(0, targetAverage - s.average);
    score += (gap / targetAverage) * 35;
    if (gap > 3)      reasons.push(`Average ${s.average.toFixed(1)}/20 — ${gap.toFixed(1)} pts below target`);
    else if (gap > 1) reasons.push(`Slightly below target (${s.average.toFixed(1)}/20)`);

    // 2. Trend
    if (s.trend.direction === 'declining') {
      score += s.trend.strength * 25;
      reasons.push('Grades are declining — needs immediate attention');
    } else if (s.trend.direction === 'improving') {
      score = Math.max(0, score - s.trend.strength * 8);
      if (s.trend.strength > 0.4) reasons.push('Improving — keep the momentum');
    }

    // 3. Subject importance
    const coeff = subjectCoefficients[s.subject] ?? 1;
    score += (coeff / maxCoeff) * 20;
    if (coeff >= maxCoeff * 0.7) reasons.push('High-weight subject');

    // 4. Improvement ease: potential × consistency
    score += s.improvementPotential * (1 - s.volatility) * 15;

    // 5. Data sparsity
    if (s.effectiveGradeCount < 3) {
      score += 5;
      reasons.push(`Only ${s.effectiveGradeCount} grade(s) counted — limited data`);
    }

    if (reasons.length === 0) reasons.push('On track — maintain consistent effort');

    return {
      subject: s.subject,
      priorityScore: clamp(score, 0, 100),
      rank: 0,
      reasons,
      suggestedFocus: weakestTopic(s),
    };
  });

  scored.sort((a, b) => b.priorityScore - a.priorityScore);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Return the topic with the lowest mean normalized grade, if topics are tagged. */
function weakestTopic(s: SubjectStats): string | undefined {
  const map = new Map<string, number[]>();
  for (const g of s.grades) {
    if (g.topic) {
      const list = map.get(g.topic) ?? [];
      list.push(g.normalized);
      map.set(g.topic, list);
    }
  }
  if (map.size === 0) return undefined;

  let weakest: string | undefined;
  let weakestAvg = Infinity;
  for (const [topic, vals] of map) {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (avg < weakestAvg) { weakestAvg = avg; weakest = topic; }
  }
  return weakest;
}
