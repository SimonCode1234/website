import { buildAcademicProfile } from '../engine';
import { validateGrades } from '../validate';
import { weightedAverage } from '../calculate';
import { analyzeTrend } from '../trend';
import { requiredScore } from '../simulate';
import type { RawGrade, ValidatedGrade, SubjectStats } from '../types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const D0  = new Date('2024-09-01');
const DAY = 86_400_000;
const d   = (offset: number) => new Date(D0.getTime() + offset * DAY);

function g(id: string, value: number, opts: Partial<RawGrade> = {}): RawGrade {
  return { id, value, outOf: 20, coefficient: 1, date: D0, subject: 'Math', ...opts };
}

const MATH_IMPROVING: RawGrade[] = [
  g('m1', 12, { date: d(0)  }),
  g('m2', 14, { date: d(14) }),
  g('m3', 16, { date: d(28) }),
  g('m4', 18, { date: d(42) }),
];

const FRENCH_WEAK: RawGrade[] = [
  g('f1', 8,  { subject: 'French', date: d(0)  }),
  g('f2', 7,  { subject: 'French', date: d(14) }),
  g('f3', 9,  { subject: 'French', date: d(28) }),
];

// ─── validate.ts ───────────────────────────────────────────────────────────────

describe('validateGrades', () => {
  test('normalises a /100 grade to /20', () => {
    const [v] = validateGrades([g('a', 75, { outOf: 100 })]);
    expect(v!.normalized).toBeCloseTo(15, 2);
  });

  test('flags value > outOf as error', () => {
    const [v] = validateGrades([g('a', 25)]);
    expect(v!.anomalyFlags.some(f => f.type === 'IMPOSSIBLE_VALUE' && f.severity === 'error')).toBe(true);
  });

  test('flags zero coefficient as warning', () => {
    const [v] = validateGrades([g('a', 14, { coefficient: 0 })]);
    expect(v!.anomalyFlags.some(f => f.type === 'ZERO_COEFFICIENT' && f.severity === 'warning')).toBe(true);
  });

  test('detects decimal-shift typo (1.5 on /20 → suggest 15)', () => {
    const [v] = validateGrades([g('a', 1.5)]);
    const flag = v!.anomalyFlags.find(f => f.type === 'ENTRY_TYPO_SUSPECTED');
    expect(flag).toBeDefined();
    expect(flag!.suggestedFix?.value).toBe(15);
  });

  test('detects statistical outlier with enough peer context', () => {
    const peers = [g('p1', 14), g('p2', 15), g('p3', 13), g('p4', 14)];
    const outlier = g('out', 2); // far below peers
    const validated = validateGrades([...peers, outlier]);
    const out = validated.find(v => v.id === 'out')!;
    expect(out.anomalyFlags.some(f => f.type === 'STATISTICAL_OUTLIER')).toBe(true);
  });

  test('does not flag normal grades as outliers', () => {
    const validated = validateGrades(MATH_IMPROVING);
    // No grade in this improving sequence should be a statistical outlier
    expect(validated.every(v => !v.anomalyFlags.some(f => f.type === 'STATISTICAL_OUTLIER'))).toBe(true);
  });
});

// ─── calculate.ts ──────────────────────────────────────────────────────────────

describe('weightedAverage', () => {
  test('equal weights → arithmetic mean', () => {
    const grades = validateGrades([g('a', 10), g('b', 20)]);
    const { average } = weightedAverage(grades, { recencyDecay: 0 });
    expect(average).toBeCloseTo(15, 1);
  });

  test('respects coefficient weighting', () => {
    const grades = validateGrades([
      g('a', 10, { coefficient: 1 }),
      g('b', 20, { coefficient: 3 }),
    ]);
    // (10×1 + 20×3) / 4 = 17.5
    const { average } = weightedAverage(grades, { recencyDecay: 0 });
    expect(average).toBeCloseTo(17.5, 1);
  });

  test('excludes zero-coefficient grades', () => {
    const grades = validateGrades([g('a', 10), g('b', 0, { coefficient: 0 })]);
    const { average } = weightedAverage(grades, { recencyDecay: 0 });
    expect(average).toBeCloseTo(10, 1);
  });

  test('recency decay boosts weight of newer grades', () => {
    const now = new Date();
    const grades = validateGrades([
      g('old', 6,  { date: new Date(now.getTime() - 180 * DAY) }),
      g('new', 18, { date: now }),
    ]);
    const withDecay    = weightedAverage(grades, { recencyDecay: 0.01, referenceDate: now });
    const withoutDecay = weightedAverage(grades, { recencyDecay: 0,    referenceDate: now });
    expect(withDecay.average).toBeGreaterThan(withoutDecay.average);
  });

  test('excludes error-flagged grades by default', () => {
    const grades = validateGrades([g('a', 10), g('b', 25)]); // b has IMPOSSIBLE_VALUE error
    const { average, effectiveGrades } = weightedAverage(grades, { recencyDecay: 0 });
    expect(effectiveGrades).toHaveLength(1);
    expect(average).toBeCloseTo(10, 1);
  });
});

// ─── trend.ts ──────────────────────────────────────────────────────────────────

describe('analyzeTrend', () => {
  test('detects improving trend', () => {
    const { direction } = analyzeTrend(validateGrades(MATH_IMPROVING));
    expect(direction).toBe('improving');
  });

  test('detects declining trend', () => {
    const raw = [
      g('d1', 18, { date: d(0)  }),
      g('d2', 15, { date: d(14) }),
      g('d3', 12, { date: d(28) }),
      g('d4', 9,  { date: d(42) }),
    ];
    expect(analyzeTrend(validateGrades(raw)).direction).toBe('declining');
  });

  test('stable for flat grades', () => {
    const raw = [
      g('s1', 13, { date: d(0)  }),
      g('s2', 14, { date: d(14) }),
      g('s3', 13, { date: d(28) }),
      g('s4', 14, { date: d(42) }),
    ];
    expect(analyzeTrend(validateGrades(raw)).direction).toBe('stable');
  });

  test('single grade → stable with current value as projection', () => {
    const trend = analyzeTrend(validateGrades([g('x', 15)]));
    expect(trend.direction).toBe('stable');
    expect(trend.projected30d).toBe(15);
  });

  test('r² ≥ 0 always', () => {
    const trend = analyzeTrend(validateGrades(MATH_IMPROVING));
    expect(trend.r2).toBeGreaterThanOrEqual(0);
  });
});

// ─── simulate.ts ───────────────────────────────────────────────────────────────

function makeSubjectStats(grades: ValidatedGrade[], avg: number): SubjectStats {
  return {
    subject: 'Math', average: avg, rawAverage: avg, grades,
    trend: analyzeTrend(grades),
    health: 'average', healthScore: 55, confidence: 1,
    gradeCount: grades.length, effectiveGradeCount: grades.length,
    lastUpdated: null, improvementPotential: 0.4, volatility: 0.1,
  };
}

describe('requiredScore', () => {
  test('calculates correct required grade', () => {
    // Two grades of 10/20 coeff 1 each. totalWeight ≈ 2 (no recency with decay=0).
    // To reach 14: g = (14×3 − 10×2) / 1 = 22 — should be impossible
    const grades = validateGrades([g('a', 10, { date: d(0) }), g('b', 10, { date: d(14) })]);
    const stats  = makeSubjectStats(grades, 10);
    const result = requiredScore(stats, 12, 1, { recencyDecay: 0 });
    // (12×3 − 10×2) / 1 = 16
    expect(result.requiredGrade).toBeCloseTo(16, 0);
    expect(result.feasibility).toBe('achievable');
  });

  test('returns impossible when target is unreachable in one grade', () => {
    const grades = validateGrades([
      g('a', 5, { date: d(0)  }),
      g('b', 5, { date: d(14) }),
      g('c', 5, { date: d(28) }),
      g('d', 5, { date: d(42) }),
    ]);
    const stats  = makeSubjectStats(grades, 5);
    const result = requiredScore(stats, 18, 1, { recencyDecay: 0 });
    expect(result.feasibility).toBe('impossible');
    expect(result.requiredGrade).toBeNull();
  });

  test('returns null requiredGrade when already at target', () => {
    const grades = validateGrades([g('a', 16)]);
    const stats  = makeSubjectStats(grades, 16);
    const result = requiredScore(stats, 14, 1, { recencyDecay: 0 });
    expect(result.requiredGrade).toBeNull();
    expect(result.feasibility).toBe('easy');
  });

  test('requiredOnScale converts correctly to /100', () => {
    const grades = validateGrades([g('a', 10), g('b', 10)]);
    const stats  = makeSubjectStats(grades, 10);
    const result = requiredScore(stats, 12, 1, { recencyDecay: 0 });
    if (result.requiredGrade !== null) {
      expect(result.requiredOnScale(100)).toBeCloseTo(result.requiredGrade * 5, 0);
    }
  });
});

// ─── engine.ts (end-to-end) ────────────────────────────────────────────────────

describe('buildAcademicProfile', () => {
  test('builds correct per-subject averages', () => {
    const profile = buildAcademicProfile([...MATH_IMPROVING, ...FRENCH_WEAK], { recencyDecay: 0 });
    const math    = profile.subjects.find(s => s.subject === 'Math')!;
    const french  = profile.subjects.find(s => s.subject === 'French')!;
    expect(math.average).toBeCloseTo(15, 0);   // (12+14+16+18)/4
    expect(french.average).toBeCloseTo(8, 0);  // (8+7+9)/3 ≈ 8
  });

  test('classifies weak and strong subjects', () => {
    const profile = buildAcademicProfile([...MATH_IMPROVING, ...FRENCH_WEAK], { recencyDecay: 0 });
    expect(profile.weakSubjects).toContain('French');
    expect(profile.strongSubjects).toContain('Math');
  });

  test('ranks the weak declining subject as top priority', () => {
    const frenchDeclining: RawGrade[] = [
      g('fd1', 10, { subject: 'French', date: d(0)  }),
      g('fd2', 8,  { subject: 'French', date: d(14) }),
      g('fd3', 6,  { subject: 'French', date: d(28) }),
    ];
    const profile = buildAcademicProfile([...MATH_IMPROVING, ...frenchDeclining], { recencyDecay: 0 });
    expect(profile.studyPriorities[0]!.subject).toBe('French');
  });

  test('collects anomalous grades', () => {
    const raw = [...MATH_IMPROVING, g('bad', 25)];
    const profile = buildAcademicProfile(raw, { recencyDecay: 0 });
    expect(profile.anomalousGrades.some(a => a.grade.id === 'bad')).toBe(true);
  });

  test('overall average respects subjectCoefficients', () => {
    const raw     = [...MATH_IMPROVING, ...FRENCH_WEAK];
    const profile = buildAcademicProfile(raw, {
      recencyDecay: 0,
      subjectCoefficients: { Math: 4, French: 1 },
    });
    // Math avg ≈ 15, French avg ≈ 8 → (15×4 + 8×1) / 5 = 68/5 = 13.6
    expect(profile.overallAverage).toBeCloseTo(13.6, 0);
  });

  test('empty input returns zero average', () => {
    const profile = buildAcademicProfile([]);
    expect(profile.overallAverage).toBe(0);
    expect(profile.subjects).toHaveLength(0);
  });
});
