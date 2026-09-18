import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenRules, parseMarkdownInstructions } from "../parsers/markdown-instructions.js";
import { checkFreshness } from "./freshness.js";
import { analyzeNoise } from "./noise.js";
import {
  REVIEW_SCORE_MAX,
  buildReport,
  globalScore,
  pickSnippet,
  truncateSnippet,
} from "./report.js";
import { scoreRule } from "./score-rule.js";

function fixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

function reportFrom(name: string, targetDir = resolve("test/fixtures")) {
  const target = resolve("test/fixtures", name);
  const content = fixture(name);
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

describe("globalScore", () => {
  it("returns 0 for zero rules and 100% noise", () => {
    expect(globalScore(0, [], 100, 0)).toBe(0);
  });

  it("returns 100 for perfect rules, no noise, no freshness", () => {
    expect(globalScore(1, [10], 0, 0)).toBe(100);
  });

  it("returns 40 when avg is 0, no noise, no freshness", () => {
    expect(globalScore(1, [0], 0, 0)).toBe(40);
  });

  it("locks agents-bueno arithmetic: 6.75 avg, 5% noise → 79", () => {
    expect(globalScore(8, [9, 8, 2, 2, 10, 8, 7, 8], 5, 0)).toBe(79);
  });

  it("locks TradingPOT arithmetic: avg 4.9, 36% noise → 55", () => {
    expect(globalScore(129, [4.9], 36, 0)).toBe(55);
  });

  it("subtracts 6 per freshness finding", () => {
    expect(globalScore(1, [10], 0, 1)).toBe(94);
  });

  it("caps freshness penalty at 40", () => {
    expect(globalScore(1, [10], 0, 7)).toBe(60);
    expect(globalScore(1, [10], 0, 100)).toBe(60);
  });

  it("does not produce NaN when n is 0", () => {
    expect(Number.isNaN(globalScore(0, [], 0, 0))).toBe(false);
    expect(globalScore(0, [], 0, 0)).toBe(40);
  });

  it("clamps ruido outside 0–100", () => {
    expect(globalScore(1, [10], -10, 0)).toBe(100);
    expect(globalScore(1, [10], 200, 0)).toBe(60);
  });
});

describe("pickSnippet", () => {
  it("prefers the most negative signal that has a snippet", () => {
    expect(
      pickSnippet(["vague_adverb:-2:cuando sea necesario", "hedge:-1:try to"], "x"),
    ).toBe("cuando sea necesario");
  });

  it("falls back to no_checkable", () => {
    expect(pickSnippet(["no_checkable:-3"], "Prefer small pull requests")).toBe(
      "no_checkable",
    );
  });

  it("falls back to truncated rule text", () => {
    expect(pickSnippet(["backtick:+3:`x`"], "hello world")).toBe("hello world");
  });

  it("truncates long snippets", () => {
    expect(truncateSnippet("a".repeat(80)).length).toBe(73);
    expect(truncateSnippet("a".repeat(80)).endsWith("…")).toBe(true);
  });
});

describe("buildReport", () => {
  it("locks agents-bueno.md score and findings", () => {
    const report = reportFrom("agents-bueno.md");
    expect(report.version).toBe("0.1.0");
    expect(report.score).toBe(79);
    expect(report.reglas).toEqual({ n: 8, avg: 6.8 });
    expect(report.tokens).toEqual({ totales: 92, utiles: 87, porcentajeRuido: 5 });
    expect(report.freshness.findings).toEqual([]);
    expect(report.findings.map((item) => [item.line, item.severity, item.category])).toEqual([
      [1, "info", "noise"],
      [7, "aviso", "scoring"],
      [11, "aviso", "scoring"],
    ]);
    expect(report.findings[0]?.message).toBe("documentación — Project Agents");
    expect(report.findings[1]?.message).toBe("revisar");
    expect(report.findings[2]?.message).toBe("revisar");
  });

  it("locks empty file at score 0 with no findings", () => {
    const report = reportFrom("agents-vacio.md");
    expect(report.score).toBe(0);
    expect(report.reglas).toEqual({ n: 0, avg: 0 });
    expect(report.tokens.porcentajeRuido).toBe(100);
    expect(report.findings).toEqual([]);
  });

  it("locks motivational fixture at score 0", () => {
    const report = reportFrom("agents-motivacional.md");
    expect(report.score).toBe(0);
    expect(report.reglas.n).toBe(0);
    expect(report.findings.every((item) => item.severity === "info")).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("locks freshness-repo at 64 and groups line 10", () => {
    const dir = resolve("test/fixtures/freshness-repo");
    const report = reportFrom("freshness-repo/AGENTS.md", dir);
    expect(report.score).toBe(64);
    expect(report.reglas.n).toBe(6);
    expect(report.reglas.avg).toBe(7.3);
    expect(report.freshness.findings).toHaveLength(3);
    const line10 = report.findings.filter((item) => item.line === 10);
    expect(line10.map((item) => item.severity)).toEqual(["error", "aviso"]);
    expect(line10[0]?.category).toBe("freshness");
    expect(line10[1]?.category).toBe("scoring");
  });

  it("shows noise heading and low-score item together in agents-capas.md", () => {
    const report = reportFrom("agents-capas.md");
    const stack = report.findings.find(
      (item) => item.severity === "info" && item.message.includes("Stack"),
    );
    const aviso = report.findings.find((item) => item.severity === "aviso");
    expect(stack).toBeDefined();
    expect(aviso).toBeDefined();
    expect(stack?.line).toBeLessThan(aviso?.line ?? 0);
    expect(aviso?.score).toBeUndefined();
    const scoredLow = report.findings.filter((item) => item.category === "scoring");
    expect(scoredLow).toHaveLength(1);
  });

  it("raises score when a bad rule is replaced by a checkable one", () => {
    const baja = reportFrom("agents-score-baja.md");
    const alta = reportFrom("agents-score-alta.md");
    expect(baja.reglas.n).toBe(1);
    expect(alta.reglas.n).toBe(1);
    expect(baja.score).toBeLessThanOrEqual(58);
    expect(alta.score).toBe(100);
    expect(alta.score).toBeGreaterThan(baja.score);
  });

  it("only flags rules at or below the review threshold", () => {
    const report = reportFrom("agents-bueno.md");
    const avisos = report.findings.filter((item) => item.category === "scoring");
    expect(REVIEW_SCORE_MAX).toBe(3);
    expect(avisos).toHaveLength(2);
  });
});
