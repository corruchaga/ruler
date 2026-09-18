import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { flattenRules, parseMarkdownInstructions } from "../parsers/markdown-instructions.js";
import { checkFreshness } from "../core/freshness.js";
import { analyzeNoise } from "../core/noise.js";
import { HUMAN_FINDING_CAP, buildReport, type Finding, type Report } from "../core/report.js";
import { scoreRule } from "../core/score-rule.js";
import { renderHuman, selectVisibleFindings } from "./human.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function reportFrom(name: string, targetDir = resolve("test/fixtures")): Report {
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

function finding(over: Partial<Finding> & Pick<Finding, "line" | "severity" | "category">): Finding {
  return {
    message: over.message ?? over.severity,
    ...over,
  };
}

const UI_SPANISH = /reglas|ruido|avisos|revisar|documentación|encontrad|ahorrables|mostrados/i;

describe("selectVisibleFindings", () => {
  it("always keeps errors and caps the rest", () => {
    const findings: Finding[] = [
      finding({ line: 1, severity: "info", category: "noise" }),
      finding({ line: 2, severity: "warning", category: "scoring" }),
      finding({ line: 3, severity: "error", category: "freshness" }),
    ];
    const many = [
      ...findings,
      ...Array.from({ length: 20 }, (_, i) =>
        finding({ line: 10 + i, severity: "warning", category: "scoring" }),
      ),
    ];
    const { visible, omittedWarning, omittedInfo } = selectVisibleFindings(many, 5);
    expect(visible.some((item) => item.severity === "error")).toBe(true);
    expect(visible).toHaveLength(5);
    expect(omittedWarning).toBeGreaterThan(0);
    expect(omittedInfo).toBe(0);
  });
});

describe("renderHuman", () => {
  it("matches snapshot for agents-bueno.md", () => {
    expect(stripAnsi(renderHuman(reportFrom("agents-bueno.md")))).toMatchSnapshot();
  });

  it("matches snapshot for agents-vacio.md", () => {
    expect(stripAnsi(renderHuman(reportFrom("agents-vacio.md")))).toMatchSnapshot();
  });

  it("matches snapshot for freshness-repo", () => {
    const dir = resolve("test/fixtures/freshness-repo");
    expect(stripAnsi(renderHuman(reportFrom("freshness-repo/AGENTS.md", dir)))).toMatchSnapshot();
  });

  it("contains grouped line 10 error and warning for freshness-repo", () => {
    const dir = resolve("test/fixtures/freshness-repo");
    const text = stripAnsi(renderHuman(reportFrom("freshness-repo/AGENTS.md", dir)));
    const rows = text.split("\n").filter((line) => /^\s*10\s+/.test(line));
    expect(rows.some((line) => line.includes("✖"))).toBe(true);
    expect(rows.some((line) => line.includes("⚠") && line.includes("review"))).toBe(true);
  });

  it("shows noise heading and low-score item for agents-capas.md", () => {
    const text = stripAnsi(renderHuman(reportFrom("agents-capas.md")));
    expect(text).toMatch(/ℹ {2}documentation — Stack/);
    expect(text).toMatch(/⚠ {2}review/);
  });

  it("prints omission only for categories actually omitted", () => {
    const findings: Finding[] = Array.from({ length: HUMAN_FINDING_CAP + 5 }, (_, i) =>
      finding({
        line: i + 1,
        severity: "warning",
        category: "scoring",
        message: "review",
      }),
    );
    const report: Report = {
      version: "0.1.0",
      target: "x.md",
      score: 40,
      rules: { count: 20, avg: 2 },
      tokens: { total: 10, useful: 10, noisePercent: 0 },
      freshness: { findings: [] },
      findings,
    };
    const text = stripAnsi(renderHuman(report));
    expect(text).toContain("… +5 warnings not shown");
    expect(text).not.toContain("infos");
  });

  it("does not emit ANSI-only-empty output without the report body", () => {
    const raw = renderHuman(reportFrom("agents-bueno.md"));
    expect(raw).toMatch(/\x1B/);
    const plain = stripAnsi(raw);
    expect(plain).toContain("score  79/100");
    expect(plain).toContain("8 rules · avg 6.8/10 · freshness OK");
    expect(plain).not.toContain("line 5 [9/10]");
  });

  it("uses English chrome on agents-bueno.md", () => {
    const plain = stripAnsi(renderHuman(reportFrom("agents-bueno.md")));
    expect(plain).not.toMatch(UI_SPANISH);
  });

  it("does not run judge messages through the 72-char snippet cap", () => {
    const report = reportFrom("agents-bueno.md");
    const explanation = "x".repeat(150);
    report.findings.push({
      line: 5,
      severity: "warning",
      category: "judge",
      message: `contradiction with line 12: ${explanation}`,
    });
    const plain = stripAnsi(renderHuman(report));
    expect(plain).toContain(explanation);
    expect(plain).toContain("contradiction with line 12:");
  });
});
