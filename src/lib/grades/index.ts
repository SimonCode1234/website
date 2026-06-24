export { buildAcademicProfile } from './engine';
export { validateGrades, normalizeToTwenty } from './validate';
export { weightedAverage } from './calculate';
export { analyzeTrend } from './trend';
export { whatIf, requiredScore } from './simulate';
export { computeStudyPriorities } from './prioritize';

export type {
  RawGrade, ValidatedGrade, AnomalyFlag, AnomalyType, AnomalySeverity,
  TrendAnalysis, TrendDirection,
  SubjectStats, SubjectHealth,
  StudyPriority,
  AcademicProfile,
  WhatIfResult, RequiredScoreResult, FeasibilityLevel,
  CalculatorOptions, EngineOptions,
} from './types';
