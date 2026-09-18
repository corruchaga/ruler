import type { FreshnessFinding, FreshnessKind, FreshnessReport } from "./freshness.js";
import type { NoiseReport } from "./noise.js";
import { averageScore } from "./score-rule.js";

export const TOOL_VERSION = "0.1.0";
export const W_V = 0.6;
export const W_U = 0.4;
export const P_F = 6;
export const P_CAP = 40;
export const REVIEW_SCORE_MAX = 3;
export const HUMAN_FINDING_CAP = 15;
export const SNIPPET_MAX = 72;

export type Severity = "error" | "warning" | "info";
export type FindingCategory = "freshness" | "scoring" | "noise" | "judge";
export type FreshnessKindOut = "path" | "script" | "dependency";

export type Finding = {
  line: number;
  severity: Severity;
  category: FindingCategory;
  message: string;
  snippet?: string;
};

export type ScoredRuleInput = {
  text: string;
  line: number;
  score: number;
  signals: string[];
};

export type ReportInput = {
  target: string;
  scored: readonly ScoredRuleInput[];
  freshness: FreshnessReport;
  noise: NoiseReport;
};

export type FreshnessFindingOut = {
  kind: FreshnessKindOut;
  value: string;
  line: number;
  lookedIn: string;
};

export type Report = {
  version: string;
  target: string;
  score: number;
  rules: { count: number; avg: number };
  tokens: {
    total: number;
    useful: number;
    noisePercent: number;
  };
  freshness: { findings: FreshnessFindingOut[] };
  findings: Finding[];
};

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const FRESHNESS_KIND_OUT: Record<FreshnessKind, FreshnessKindOut> = {
  ruta: "path",
  script: "script",
  dependencia: "dependency",
};

const FRESHNESS_MESSAGE: Record<FreshnessKind, string> = {
  ruta: "path not found",
  script: "script not found",
  dependencia: "dependency not found",
};

type ParsedSignal = {
  id: string;
  delta: number;
  snippet?: string;
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseSignal(raw: string): ParsedSignal | null {
  const match = /^([^:]+):([+-]?\d+)(?::(.*))?$/.exec(raw);
  if (!match) {
    return null;
  }
  const id = match[1];
  const deltaRaw = match[2];
  if (id === undefined || deltaRaw === undefined) {
    return null;
  }
  const snippet = match[3];
  return {
    id,
    delta: Number(deltaRaw),
    snippet: snippet === undefined || snippet === "" ? undefined : snippet,
  };
}

export function truncateSnippet(text: string, max = SNIPPET_MAX): string {
  const graphemes = [...text];
  if (graphemes.length <= max) {
    return text;
  }
  return `${graphemes.slice(0, max).join("")}…`;
}

export function pickSnippet(signals: readonly string[], text: string): string {
  const parsed: ParsedSignal[] = [];
  for (const raw of signals) {
    const item = parseSignal(raw);
    if (item) {
      parsed.push(item);
    }
  }

  let best: ParsedSignal | undefined;
  for (const item of parsed) {
    if (item.delta >= 0 || item.snippet === undefined) {
      continue;
    }
    if (best === undefined || Math.abs(item.delta) > Math.abs(best.delta)) {
      best = item;
    }
  }
  if (best?.snippet !== undefined) {
    return truncateSnippet(best.snippet);
  }

  if (parsed.some((item) => item.id === "no_checkable")) {
    return "no_checkable";
  }

  return truncateSnippet(text);
}

export function globalScore(
  n: number,
  scores: readonly number[],
  noisePercent: number,
  freshnessCount: number,
): number {
  const avg = averageScore(scores);
  const v = n === 0 ? 0 : clamp(avg, 0, 10) / 10;
  const u = (100 - clamp(noisePercent, 0, 100)) / 100;
  const base = 100 * (W_V * v + W_U * u);
  const pen = Math.min(P_CAP, P_F * freshnessCount);
  return clamp(Math.round(base - pen), 0, 100);
}

function freshnessMessage(kind: FreshnessKind, value: string): string {
  return `${FRESHNESS_MESSAGE[kind]}: ${value}`;
}

function mapFreshnessFinding(item: FreshnessFinding): FreshnessFindingOut {
  return {
    kind: FRESHNESS_KIND_OUT[item.kind],
    value: item.value,
    line: item.line,
    lookedIn: item.lookedIn,
  };
}

export function compareFindings(a: Finding, b: Finding): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) {
    return sev;
  }
  if (a.category !== b.category) {
    return a.category < b.category ? -1 : 1;
  }
  if (a.message !== b.message) {
    return a.message < b.message ? -1 : 1;
  }
  return 0;
}

export function buildReport(input: ReportInput): Report {
  const n = input.scored.length;
  const scores = input.scored.map((item) => item.score);
  const findings: Finding[] = [];

  for (const item of input.freshness.findings) {
    findings.push({
      line: item.line,
      severity: "error",
      category: "freshness",
      message: freshnessMessage(item.kind, item.value),
      snippet: item.lookedIn,
    });
  }

  for (const item of input.scored) {
    if (item.score > REVIEW_SCORE_MAX) {
      continue;
    }
    findings.push({
      line: item.line,
      severity: "warning",
      category: "scoring",
      message: "review",
      snippet: pickSnippet(item.signals, item.text),
    });
  }

  for (const section of input.noise.secciones) {
    if (section.kind !== "documentacion") {
      continue;
    }
    findings.push({
      line: section.line,
      severity: "info",
      category: "noise",
      message: `documentation — ${section.title || "(preamble)"}`,
    });
  }

  findings.sort(compareFindings);

  return {
    version: TOOL_VERSION,
    target: input.target,
    score: globalScore(n, scores, input.noise.porcentajeRuido, input.freshness.findings.length),
    rules: {
      count: n,
      avg: round1(averageScore(scores)),
    },
    tokens: {
      total: input.noise.tokensTotales,
      useful: input.noise.tokensUtiles,
      noisePercent: input.noise.porcentajeRuido,
    },
    freshness: { findings: input.freshness.findings.map(mapFreshnessFinding) },
    findings,
  };
}
