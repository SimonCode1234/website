// ─── Raw input ─────────────────────────────────────────────────────────────────

export interface RawGrade {
  id: string;
  value: number;
  outOf: number;            // scale denominator (5 | 10 | 20 | 40 | 100 | …)
  coefficient: number;      // weight within the subject
  date: Date | string;
  subject: string;
  topic?: string;           // sub-topic (e.g. "Algebra" inside "Math")
  title?: string;           // test / assignment name
  isExam?: boolean;
}

// ─── Anomaly detection ─────────────────────────────────────────────────────────

export type AnomalyType =
  | 'IMPOSSIBLE_VALUE'
  | 'NEGATIVE_VALUE'
  | 'ZERO_COEFFICIENT'
  | 'UNUSUAL_SCALE'
  | 'STATISTICAL_OUTLIER'
  | 'ENTRY_TYPO_SUSPECTED';

export type AnomalySeverity = 'error' | 'warning' | 'info';

export interface AnomalyFlag {
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  suggestedFix?: Partial<Pick<RawGrade, 'value' | 'outOf' | 'coefficient'>>;
}

// ─── Validated grade ───────────────────────────────────────────────────────────

export interface ValidatedGrade {
  id: string;
  value: number;
  outOf: number;
  coefficient: number;
  date: Date;
  subject: string;
  topic?: string;
  title?: string;
  isExam: boolean;
  normalized: number;       // always /20
  isAnomaly: boolean;
  anomalyFlags: AnomalyFlag[];
  confidence: number;       // 0–1, per-grade reliability
}

// ─── Trend ─────────────────────────────────────────────────────────────────────

export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface TrendAnalysis {
  direction: TrendDirection;
  strength: number;           // 0–1 (normalised slope × √R²)
  slope: number;              // pts/day on /20 scale
  r2: number;                 // regression fit quality 0–1
  projected30d: number | null;
  projected90d: number | null;
  dataPoints: number;
}

// ─── Subject stats ─────────────────────────────────────────────────────────────

export type SubjectHealth = 'strong' | 'average' | 'weak' | 'critical';

export interface SubjectStats {
  subject: string;
  average: number;              // weighted /20
  rawAverage: number;           // unweighted mean /20
  grades: ValidatedGrade[];
  trend: TrendAnalysis;
  health: SubjectHealth;
  healthScore: number;          // 0–100
  confidence: number;           // 0–1
  gradeCount: number;
  effectiveGradeCount: number;  // excludes zero-coeff and error grades
  lastUpdated: Date | null;
  improvementPotential: number; // 0–1
  volatility: number;           // 0–1  (low = consistent)
}

// ─── Study priorities ──────────────────────────────────────────────────────────

export interface StudyPriority {
  subject: string;
  priorityScore: number;   // 0–100
  rank: number;            // 1 = highest priority
  reasons: string[];
  suggestedFocus?: string; // weakest topic inside the subject
}

// ─── Full academic profile ─────────────────────────────────────────────────────

export interface AcademicProfile {
  overallAverage: number;
  overallTrend: TrendAnalysis;
  subjects: SubjectStats[];
  studyPriorities: StudyPriority[];
  weakSubjects: string[];
  strongSubjects: string[];
  confidence: number;
  generatedAt: Date;
  anomalousGrades: Array<{ grade: ValidatedGrade; subject: string }>;
}

// ─── Simulator ─────────────────────────────────────────────────────────────────

export interface WhatIfResult {
  subject: string;
  hypotheticalGrade: number;
  hypotheticalCoefficient: number;
  newSubjectAverage: number;
  newOverallAverage: number;
  subjectDelta: number;
  overallDelta: number;
}

export type FeasibilityLevel =
  | 'easy'
  | 'achievable'
  | 'ambitious'
  | 'exceptional'
  | 'impossible';

export interface RequiredScoreResult {
  subject: string;
  targetSubjectAverage: number;
  currentAverage: number;
  requiredGrade: number | null;       // /20  (null = already met or impossible)
  requiredOnScale: (outOf: number) => number;
  feasibility: FeasibilityLevel;
  feasibilityMessage: string;
  assumedCoefficient: number;
}

// ─── Engine options ────────────────────────────────────────────────────────────

export interface CalculatorOptions {
  recencyDecay?: number;          // default 0.003  (half-life ≈ 231 days)
  excludeErrorGrades?: boolean;   // default true
  referenceDate?: Date;
}

export interface EngineOptions extends CalculatorOptions {
  subjectCoefficients?: Record<string, number>;
  targetAverage?: number;         // priority engine target, default 14
}
