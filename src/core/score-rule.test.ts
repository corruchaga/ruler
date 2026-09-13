import { describe, expect, it } from "vitest";
import { averageScore, scoreRule } from "./score-rule.js";

function rule(text: string) {
  return { text, line: 1 };
}

const CALIBRATION = [
  { id: 1, text: "Escribe codigo limpio", kind: "vague" as const },
  { id: 2, text: "Write clean code", kind: "vague" as const },
  { id: 3, text: "Optimiza el rendimiento cuando sea necesario", kind: "vague" as const },
  { id: 4, text: "Improve the code as appropriate", kind: "vague" as const },
  { id: 5, text: "Hazlo rapido y de forma adecuada", kind: "vague" as const },
  { id: 6, text: "Clean up the module when needed", kind: "vague" as const },
  { id: 7, text: "Mejora la arquitectura siempre que se pueda", kind: "vague" as const },
  { id: 8, text: "Handle errors properly", kind: "vague" as const },
  { id: 9, text: "Mantén el código elegante y profesional", kind: "vague" as const },
  {
    id: 10,
    text: "Keep the implementation readable and maintainable",
    kind: "vague" as const,
  },
  {
    id: 11,
    text: "Los commits van en ASCII puro, sin ñ ni acentos",
    kind: "good" as const,
    min: 8,
  },
  {
    id: 12,
    text: "Always run `npm run build` before marking a task complete",
    kind: "good" as const,
  },
  {
    id: 13,
    text: "Al terminar cualquier tarea ejecuta `npm run build` y verifica que compila",
    kind: "good" as const,
  },
  { id: 14, text: "Never commit secrets or API keys", kind: "good" as const },
  { id: 15, text: "Name files in kebab-case", kind: "good" as const },
  {
    id: 16,
    text: "Cada panel tiene un `panelId` estable; actualizaciones por id, nunca por índice",
    kind: "good" as const,
  },
  { id: 17, text: "Keep functions under fifty lines", kind: "good" as const },
  {
    id: 18,
    text: "PROHIBIDO usar position:absolute entre textos hermanos; usar flex/grid y gap en el layout",
    kind: "good" as const,
  },
  { id: 19, text: "Always write tests for new public APIs", kind: "good" as const },
  {
    id: 20,
    text: "Los colores de tema se declaran solo en `src/index.css` dentro de `@theme`",
    kind: "good" as const,
  },
];

const BUENO_SCORES = [
  { text: "Always use TypeScript strict mode in new files", score: 9 },
  { text: "Never commit secrets or API keys", score: 8 },
  { text: "Prefer small pull requests over large ones", score: 2 },
  { text: "Do not run destructive git commands", score: 2 },
  { text: "Never skip the test suite", score: 10 },
  { text: "Always write tests for new public APIs.", score: 8 },
  { text: "Keep functions under fifty lines", score: 7 },
  { text: "Name files in kebab-case", score: 8 },
];

describe("scoreRule", () => {
  it("classifies the 20-rule calibration set", () => {
    for (const item of CALIBRATION) {
      const { score, signals } = scoreRule(rule(item.text));
      expect(signals.length, item.text).toBeGreaterThan(0);
      expect(Number.isInteger(score), item.text).toBe(true);
      if (item.kind === "vague") {
        expect(score, `#${item.id} ${item.text}`).toBeLessThanOrEqual(3);
      } else {
        const min = item.min ?? 7;
        expect(score, `#${item.id} ${item.text}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("matches the plan-maestro examples", () => {
    expect(scoreRule(rule("Escribe código limpio")).score).toBeLessThanOrEqual(3);
    expect(scoreRule(rule("Escribe codigo limpio")).score).toBeLessThanOrEqual(3);
    expect(
      scoreRule(rule("Los commits van en ASCII puro, sin ñ ni acentos")).score,
    ).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic", () => {
    const text = "Always run `npm run build` before marking a task complete";
    const first = scoreRule(rule(text));
    for (let i = 0; i < 20; i += 1) {
      expect(scoreRule(rule(text))).toEqual(first);
    }
  });

  it("returns integer scores between 0 and 10", () => {
    for (const item of CALIBRATION) {
      const { score } = scoreRule(rule(item.text));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it("never exceeds 3 without a plus signal", () => {
    const samples = [
      "",
      "???",
      "Be nice to everyone around here please.",
      "Prefer small pull requests over large ones",
    ];
    for (const text of samples) {
      const { score, signals } = scoreRule(rule(text));
      expect(score, text).toBeLessThanOrEqual(3);
      expect(signals.some((s) => s.startsWith("no_checkable:"))).toBe(true);
    }
  });

  it("does not throw on rare inputs and keeps signals non-empty", () => {
    const rares = [
      "",
      "✨🔥💯",
      "use `a` and `b` and `c`",
      "x".repeat(50_000),
      "🚀 Always run `npm test`",
      "???",
    ];
    for (const text of rares) {
      const result = scoreRule(rule(text));
      expect(result.signals.length, text.slice(0, 40)).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(10);
    }
  });

  it("locks exact scores for agents-bueno.md rules", () => {
    for (const item of BUENO_SCORES) {
      expect(scoreRule(rule(item.text)).score, item.text).toBe(item.score);
    }
  });
});

describe("averageScore", () => {
  it("returns 0 for an empty list", () => {
    expect(averageScore([])).toBe(0);
  });

  it("returns the mean of integer scores", () => {
    expect(averageScore([9, 8, 2, 2, 10, 8, 7, 8])).toBe(6.75);
  });
});
