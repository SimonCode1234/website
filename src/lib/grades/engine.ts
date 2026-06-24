import type {
  RawGrade, ValidatedGrade, SubjectStats, SubjectHealth, AcademicProfile, EngineOptions,
} from './types';
import { validateGrades } from './validate';
import { weightedAverage } from './calculate';
import { analyzeTrend } from './trend';
import { computeStudyPriorities } from './prioritize';
import { stddev, clamp } from './stats';

function subjectHealth(avg: number): SubjectHealth {
  if (avg >= 15) return 'strong';
  if (avg >= 12) return 'average';
  if (avg >= 8)  return 'weak';
  return 'critical';
}

function healthScore(avg: number, dir: 'improving' | 'stable' | 'declining'): number {
  const base  = (avg / 20) * 80;
  const bonus = dir === 'improving' ? 15 : dir === 'declining' ? -15 : 0;
  return clamp(base + bonus, 0, 100);
}

/**
 * Improvement potential: how much room to improve × how predictable the gains are.
 * Students with low variance grades are more likely to improve consistently;
 * high volatility means outcomes are less certain even if the gap is large.
 */
function improvementPotential(avg: number, volatility: number): number {
  return clamp((20 - avg) / 20, 0, 1) * (1 - volatility);
}

function buildSubjectStats(
  subject: string,
  grades: ValidatedGrade[],
  options: EngineOptions,
): SubjectStats {
  const { average, confidence, effectiveGrades } = weightedAverage(grades, options);
  const normalized = grades.map(g => g.normalized);
  const rawAvg     = normalized.length > 0 ? normalized.reduce((s, v) => s + v, 0) / normalized.length : 0;
  const vol        = clamp(normalized.length > 1 ? stddev(normalized) / 20 : 0, 0, 1);
  const trend      = analyzeTrend(grades);
  const dates      = grades.map(g => g.date.getTime());

  return {
    subject, average, rawAverage: rawAvg, grades, trend,
    health: subjectHealth(average),
    healthScore: healthScore(average, trend.direction),
    confidence,
    gradeCount: grades.length,
    effectiveGradeCount: effectiveGrades.length,
    lastUpdated: dates.length > 0 ? new Date(Math.max(...dates)) : null,
    improvementPotential: improvementPotential(average, vol),
    volatility: vol,
  };
}

/**
 * Main entry point — takes raw grade data and returns a fully computed AcademicProfile.
 *
 * Pipeline:
 *   validateGrades()       → anomaly-flagged ValidatedGrade[]
 *   buildSubjectStats()    → per-subject weighted averages, trends, health
 *   overallAverage         → subject-coefficient-weighted mean
 *   computeStudyPriorities → ranked action list
 */
export function buildAcademicProfile(
  rawGrades: RawGrade[],
  options: EngineOptions = {},
): AcademicProfile {
  const validated = validateGrades(rawGrades);

  const bySubject = new Map<string, ValidatedGrade[]>();
  for (const g of validated) {
    const list = bySubject.get(g.subject) ?? [];
    list.push(g);
    bySubject.set(g.subject, list);
  }

  const subjects: SubjectStats[] = [];
  for (const [subject, grades] of bySubject) {
    subjects.push(buildSubjectStats(subject, grades, options));
  }

  const { subjectCoefficients = {} } = options;
  let ws = 0, tw = 0;
  for (const s of subjects) {
    const w = subjectCoefficients[s.subject] ?? 1;
    ws += s.average * w;
    tw += w;
  }
  const overallAverage = tw > 0 ? clamp(ws / tw, 0, 20) : 0;

  const overallTrend      = analyzeTrend(validated.filter(g => g.coefficient > 0));
  const overallConfidence = subjects.length > 0
    ? subjects.reduce((s, sub) => s + sub.confidence, 0) / subjects.length : 0;

  return {
    overallAverage,
    overallTrend,
    subjects,
    studyPriorities: computeStudyPriorities(subjects, options),
    weakSubjects:    subjects.filter(s => s.health === 'weak' || s.health === 'critical').map(s => s.subject),
    strongSubjects:  subjects.filter(s => s.health === 'strong').map(s => s.subject),
    confidence: overallConfidence,
    generatedAt: options.referenceDate ?? new Date(),
    anomalousGrades: validated.filter(g => g.isAnomaly).map(g => ({ grade: g, subject: g.subject })),
  };
}
