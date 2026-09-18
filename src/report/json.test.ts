import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenRules, parseMarkdownInstructions } from "../parsers/markdown-instructions.js";
import { checkFreshness } from "../core/freshness.js";
import { analyzeNoise } from "../core/noise.js";
import { buildReport } from "../core/report.js";
import { scoreRule } from "../core/score-rule.js";
import { renderJson } from "./json.js";

function reportFrom(name: string, targetDir = resolve("test/fixtures")) {
  const target = resolve("test/fixtures", name);
  const content = readFileSync(target, "utf8");
  const doc = parseMarkdownInstructions(content);
  const scored = flattenRules(doc).map((rule) => {
    const result = scoreRule(rule);
    return { text: rule.text, line: rule.line, score: result.score, signals: result.signals };
  });
  return buildReport({
    target,
    scored,
    freshness: checkFreshness(doc, targetDir),
    noise: analyzeNoise(doc, content),
  });
}

describe("renderJson", () => {
  it("produces parseable JSON with frozen top-level keys", () => {
    const report = reportFrom("agents-bueno.md");
    const raw = renderJson(report);
    expect(raw).not.toMatch(/\x1B/);
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual(report);
    expect(Object.keys(parsed as object)).toEqual([
      "version",
      "target",
      "score",
      "reglas",
      "tokens",
      "freshness",
      "findings",
    ]);
    const body = parsed as {
      score: number;
      reglas: { n: number; avg: number };
      findings: { snippet?: string }[];
    };
    expect(body.score).toBe(79);
    expect(body.reglas).toEqual({ n: 8, avg: 6.8 });
    const info = body.findings.find((item) => !("snippet" in item));
    expect(info).toBeDefined();
  });

  it("keeps freshness findings and omits ANSI", () => {
    const dir = resolve("test/fixtures/freshness-repo");
    const raw = renderJson(reportFrom("freshness-repo/AGENTS.md", dir));
    expect(raw).not.toMatch(/\x1B/);
    const parsed = JSON.parse(raw) as {
      score: number;
      freshness: { findings: unknown[] };
      findings: { line: number; severity: string }[];
    };
    expect(parsed.score).toBe(64);
    expect(parsed.freshness.findings).toHaveLength(3);
    expect(parsed.findings.some((item) => item.line === 10 && item.severity === "error")).toBe(
      true,
    );
    expect(parsed.findings.some((item) => item.line === 10 && item.severity === "aviso")).toBe(
      true,
    );
  });
});
