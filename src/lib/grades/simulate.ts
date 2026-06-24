import type {
  ValidatedGrade, SubjectStats, AcademicProfile,
  WhatIfResult, RequiredScoreResult, FeasibilityLevel, EngineOptions,
} from './types';
import { weightedAverage } from './calculate';
import { clamp } from './stats';

/**
 * What-if simulator.
 *
 * Injects a hypothetical future grade and returns the new subject average
 * and the new overall average.
 */
export function whatIf(
  profile: AcademicProfile,
  subject: string,
  hypotheticalGrade: number,
  hypotheticalCoefficient: number,
  options: EngineOptions = {},
): WhatIfResult {
  const stats = profile.subjects.find(s => s.subject === subject);
  if (!stats) throw new Error(`Subject "${subject}" not found in profile`);

  const ref = options.referenceDate ?? new Date();

  // Build a fake ValidatedGrade for the hypothetical mark
  const fake: ValidatedGrade = {
    id: '__whatif__', value: hypotheticalGrade, outOf: 20,
    coefficient: hypotheticalCoefficient, date: ref, subject,
    isExam: false, normalized: clamp(hypotheticalGrade, 0, 20),
    isAnomaly: false, anomalyFlags: [], confidence: 1,
  };

  const { average: newSubjectAverage } = weightedAverage([...stats.grades, fake], options);

  const newOverallAverage = recomputeOverall(
    profile.subjects, subject, newSubjectAverage, options.subjectCoefficients ?? {},
  );

  return {
    subject, hypotheticalGrade, hypotheticalCoefficient,
    newSubjectAverage, newOverallAverage,
    subjectDelta: newSubjectAverage - stats.average,
    overallDelta:  newOverallAverage - profile.overallAverage,
  };
}

/**
 * Required score calculator.
 *
 * Algebraic derivation (with recency-decayed weights):
 *   current_sum = average × totalWeight
 *   target      = (current_sum + g_new × coeff_new) / (totalWeight + coeff_new)
 *   ⟹ g_new    = (target × (totalWeight + coeff_new) − current_sum) / coeff_new
 *
 * The new grade is assumed to be entered today so its recency factor = 1,
 * meaning coeff_new contributes at full weight.
 */
export function requiredScore(
  subject: SubjectStats,
  targetSubjectAverage: number,
  assumedCoefficient = 1,
  options: EngineOptions = {},
): RequiredScoreResult {
  const { average: currentAverage, totalWeight } = weightedAverage(subject.grades, options);

  if (currentAverage >= targetSubjectAverage) {
    return {
      subject: subject.subject, targetSubjectAverage, currentAverage,
      requiredGrade: null, requiredOnScale: () => 0,
      feasibility: 'easy',
      feasibilityMessage: `Already at ${currentAverage.toFixed(1)}/20 — target is met.`,
      assumedCoefficient,
    };
  }

  const currentSum = currentAverage * totalWeight;
  const required   = (targetSubjectAverage * (totalWeight + assumedCoefficient) - currentSum) / assumedCoefficient;
  const rounded    = Math.round(required * 100) / 100;
  const feasibility = classify(rounded);
  const isFeasible  = feasibility !== 'impossible';

  const messages: Record<FeasibilityLevel, string> = {
    easy:        `You need ${rounded.toFixed(1)}/20 — very achievable.`,
    achievable:  `You need ${rounded.toFixed(1)}/20 — within normal reach.`,
    ambitious:   `You need ${rounded.toFixed(1)}/20 — ambitious but possible.`,
    exceptional: `You need ${rounded.toFixed(1)}/20 — near-perfect performance required.`,
    impossible:  `Target ${targetSubjectAverage}/20 would require ${rounded.toFixed(1)}/20 — not achievable in one grade.`,
  };

  return {
    subject: subject.subject, targetSubjectAverage, currentAverage,
    requiredGrade: isFeasible ? rounded : null,
    requiredOnScale: (outOf: number) =>
      isFeasible ? clamp((rounded / 20) * outOf, 0, outOf) : outOf + 1,
    feasibility,
    feasibilityMessage: messages[feasibility],
    assumedCoefficient,
  };
}

function classify(required: number): FeasibilityLevel {
  if (required <= 0)  return 'easy';
  if (required <= 12) return 'easy';
  if (required <= 16) return 'achievable';
  if (required <= 18) return 'ambitious';
  if (required <= 20) return 'exceptional';
  return 'impossible';
}

function recomputeOverall(
  subjects: SubjectStats[],
  updatedSubject: string,
  newAvg: number,
  coefficients: Record<string, number>,
): number {
  let ws = 0, tw = 0;
  for (const s of subjects) {
    const w = coefficients[s.subject] ?? 1;
    ws += (s.subject === updatedSubject ? newAvg : s.average) * w;
    tw += w;
  }
  return tw > 0 ? clamp(ws / tw, 0, 20) : 0;
}
