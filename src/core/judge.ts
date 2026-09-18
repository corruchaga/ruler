import { classifySection, estimateTokens } from "./noise.js";
import type { Finding } from "./report.js";
import type { ParsedDocument, Rule } from "../parsers/types.js";

export const JUDGE_MAX_TOKENS = 1500;
export const JUDGE_TOKEN_BUDGET = 2000;
export const JUDGE_EXPLANATION_MAX = 200;
export const JUDGE_TEMPERATURE = 0;

export const JUDGE_SYSTEM_PROMPT = `You audit AI agent instruction files for contradictions.

Task: find pairs of rules that cannot be followed at the same time, or that overlap in a conflicting way.
Do not report restatements, refinements, or complementary rules.
Do not invent rules or line numbers.

Reply with a JSON array and nothing else. No markdown fences, no commentary.
Schema: [{"lineA": <number>, "lineB": <number>, "explanation": "<short English sentence>"}]
Use the line numbers from the input. lineA and lineB must be different.
If there are no contradictions, return [].`;

export const JUDGE_RETRY_NOTE = "respond ONLY with the JSON array";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type JudgePair = {
  lineA: number;
  lineB: number;
  explanation: string;
};

export type ParseJudgeResult =
  | { ok: true; pairs: JudgePair[] }
  | { ok: false };

export function rulesFromRuleSections(doc: ParsedDocument): Rule[] {
  return doc.sections.flatMap((section) => {
    const { kind } = classifySection(section);
    if (kind !== "reglas") {
      return [];
    }
    return section.rules;
  });
}

export function selectRulesForJudge(
  rules: readonly Rule[],
  budget = JUDGE_TOKEN_BUDGET,
): { selected: Rule[]; total: number } {
  const total = rules.length;
  const selected: Rule[] = [];
  let used = 0;
  for (const rule of rules) {
    const tokens = estimateTokens(rule.text.length);
    if (selected.length > 0 && used + tokens > budget) {
      break;
    }
    selected.push(rule);
    used += tokens;
  }
  return { selected, total };
}

export function buildJudgeMessages(rules: readonly Rule[]): ChatMessage[] {
  const body = rules.map((rule) => `${rule.line}: ${rule.text}`).join("\n");
  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: `Rules (line number, then text):\n${body}` },
  ];
}

export function withRetryNote(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages, { role: "user", content: JUDGE_RETRY_NOTE }];
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }
  return trimmed;
}

function capExplanation(text: string): string {
  const graphemes = [...text];
  if (graphemes.length <= JUDGE_EXPLANATION_MAX) {
    return text;
  }
  return graphemes.slice(0, JUDGE_EXPLANATION_MAX).join("");
}

export function parseJudgeResponse(
  raw: string,
  sentLines: ReadonlySet<number>,
): ParseJudgeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(raw));
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false };
  }

  const pairs: JudgePair[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.lineA !== "number" || typeof record.lineB !== "number") {
      continue;
    }
    if (!Number.isInteger(record.lineA) || !Number.isInteger(record.lineB)) {
      continue;
    }
    if (typeof record.explanation !== "string") {
      continue;
    }
    if (record.lineA === record.lineB) {
      continue;
    }
    if (!sentLines.has(record.lineA) || !sentLines.has(record.lineB)) {
      continue;
    }
    const lineA = Math.min(record.lineA, record.lineB);
    const lineB = Math.max(record.lineA, record.lineB);
    const key = `${lineA}:${lineB}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pairs.push({
      lineA,
      lineB,
      explanation: record.explanation.trim(),
    });
  }
  return { ok: true, pairs };
}

export function toJudgeFindings(pairs: readonly JudgePair[]): Finding[] {
  return pairs.map((pair) => ({
    line: pair.lineA,
    severity: "warning",
    category: "judge",
    message: `contradiction with line ${pair.lineB}: ${capExplanation(pair.explanation)}`,
  }));
}

export function judgeStatusLine(count: number): string {
  if (count === 0) {
    return "judge  no contradictions found";
  }
  if (count === 1) {
    return "judge  1 contradiction found";
  }
  return `judge  ${count} contradictions found`;
}

export function judgeCapLine(n: number, m: number): string {
  return `judge  analyzed first ${n} of ${m} rules`;
}

export function judgeUnavailableLine(reason: string): string {
  return `judge  unavailable (${reason}), deterministic results unaffected`;
}
