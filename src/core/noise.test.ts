import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseMarkdownInstructions,
} from "../parsers/markdown-instructions.js";
import type { ParsedSection, Rule } from "../parsers/types.js";
import {
  analyzeNoise,
  classifySection,
  estimateTokens,
} from "./noise.js";

function rule(text: string): Rule {
  return { text, line: 1 };
}

function section(title: string, rules: Rule[] = []): ParsedSection {
  return { title, level: 2, line: 1, rules };
}

function fixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

describe("estimateTokens", () => {
  it("uses Math.round of chars/4", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(1);
    expect(estimateTokens(6)).toBe(2);
    expect(estimateTokens(7)).toBe(2);
    expect(estimateTokens(26833)).toBe(6708);
  });
});

describe("classifySection", () => {
  it("classifies frozen headings", () => {
    expect(classifySection(section("2. Stack", [rule("Always run npm run build")]))).toEqual({
      kind: "documentacion",
      reason: "heading:doc:stack",
    });
    expect(
      classifySection(section("MAPA DE ARCHIVOS (ir directo, no explorar todo)", [rule("src/a.ts")])),
    ).toEqual({
      kind: "documentacion",
      reason: "heading:doc:mapa de archivos",
    });
    expect(
      classifySection(
        section("7. Roadmap (NO implementar sin que se pida expresamente)", [rule("Fase 3")]),
      ),
    ).toEqual({
      kind: "documentacion",
      reason: "heading:doc:roadmap",
    });
    expect(classifySection(section("8. Reglas de trabajo para el agente", [rule("Always build")]))).toEqual({
      kind: "reglas",
      reason: "heading:regla:regla",
    });
    expect(
      classifySection(section("Notas del equipo", [rule("Always keep secrets out of git")])),
    ).toEqual({
      kind: "reglas",
      reason: "default:reglas",
    });
    expect(classifySection(section("", [rule("Always keep directory resolution covered here.")]))).toEqual({
      kind: "reglas",
      reason: "preamble:reglas",
    });
    expect(classifySection(section(""))).toEqual({
      kind: "documentacion",
      reason: "preamble:documentacion",
    });
    expect(classifySection(section("Estado global de la app"))).toEqual({
      kind: "documentacion",
      reason: "sin-reglas",
    });
    expect(classifySection(section("Reglas del stack", [rule("Always use TypeScript")]))).toEqual({
      kind: "reglas",
      reason: "heading:regla:regla",
    });
  });
});

describe("analyzeNoise", () => {
  it("returns 100% noise and empty secciones for empty input", () => {
    expect(analyzeNoise({ title: "", sections: [] }, "")).toEqual({
      tokensTotales: 0,
      tokensUtiles: 0,
      porcentajeRuido: 100,
      secciones: [],
    });
  });

  it("reports 100% noise for the motivational fixture", () => {
    const raw = fixture("agents-motivacional.md");
    const report = analyzeNoise(parseMarkdownInstructions(raw), raw);
    expect(report.porcentajeRuido).toBe(100);
    expect(report.tokensUtiles).toBe(0);
    expect(report.tokensTotales).toBe(estimateTokens(raw.length));
    expect(report.secciones.every((item) => item.kind === "documentacion")).toBe(true);
  });

  it("keeps Stack as documentation and Coding rules as reglas", () => {
    const raw = fixture("agents-ruido-mixto.md");
    const report = analyzeNoise(parseMarkdownInstructions(raw), raw);
    expect(report.secciones.map((item) => item.kind)).toEqual([
      "documentacion",
      "documentacion",
      "reglas",
    ]);
    expect(report.secciones.map((item) => item.reason)).toEqual([
      "sin-reglas",
      "heading:doc:stack",
      "heading:regla:rule",
    ]);
    expect(report.tokensTotales).toBe(estimateTokens(raw.length));
    const utilesChars = report.secciones
      .filter((item) => item.kind === "reglas")
      .reduce((sum, item) => sum + item.charCount, 0);
    expect(report.tokensUtiles).toBe(estimateTokens(utilesChars));
    expect(report.porcentajeRuido).toBe(
      Math.round((100 * (raw.length - utilesChars)) / raw.length),
    );
  });

  it("locks exact figures for agents-bueno.md", () => {
    const raw = fixture("agents-bueno.md");
    expect(raw.length).toBe(366);
    const report = analyzeNoise(parseMarkdownInstructions(raw), raw);
    expect(report.tokensTotales).toBe(92);
    expect(report.tokensUtiles).toBe(87);
    expect(report.porcentajeRuido).toBe(5);
    expect(report.secciones[0]).toMatchObject({
      title: "Project Agents",
      line: 1,
      kind: "documentacion",
      reason: "sin-reglas",
      charCount: 18,
    });
  });
});
