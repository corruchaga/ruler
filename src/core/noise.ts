import type { ParsedDocument, ParsedSection } from "../parsers/types.js";

export type SectionKind = "reglas" | "documentacion";

export type SectionNoise = {
  title: string;
  line: number;
  kind: SectionKind;
  reason: string;
  charCount: number;
  tokens: number;
};

export type NoiseReport = {
  tokensTotales: number;
  tokensUtiles: number;
  porcentajeRuido: number;
  secciones: SectionNoise[];
};

const RULE_OVERRIDE: readonly string[] = [
  "regla",
  "reglas",
  "rule",
  "rules",
  "obligatorio",
  "obligatoria",
  "obligatorios",
  "obligatorias",
  "mandatory",
  "required",
  "prohibido",
  "prohibida",
  "prohibidos",
  "prohibidas",
  "always",
  "never",
  "siempre",
  "nunca",
];

const DOC_KEYWORDS: readonly string[] = [
  "stack",
  "tech stack",
  "mapa de archivos",
  "mapa del repo",
  "file map",
  "files map",
  "changelog",
  "roadmap",
  "fases",
  "historia",
  "history",
  "estado actual",
  "contexto",
  "proposito",
  "purpose",
  "overview",
  "disclaimer",
  "licencia",
  "license",
  "credits",
  "creditos",
  "motivacion",
  "manifiesto",
  "vision",
  "bienvenida",
  "welcome",
];

export function estimateTokens(charCount: number): number {
  return Math.round(charCount / 4);
}

function normalizeHeading(title: string): string {
  return title
    .normalize("NFC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[`*_~[\]()#]/g, " ")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function firstKeyword(normalized: string, keywords: readonly string[]): string | null {
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

export function classifySection(section: ParsedSection): {
  kind: SectionKind;
  reason: string;
} {
  if (section.title === "") {
    if (section.rules.length > 0) {
      return { kind: "reglas", reason: "preamble:reglas" };
    }
    return { kind: "documentacion", reason: "preamble:documentacion" };
  }

  const normalized = normalizeHeading(section.title);
  const ruleKw = firstKeyword(normalized, RULE_OVERRIDE);
  if (ruleKw !== null) {
    return { kind: "reglas", reason: `heading:regla:${ruleKw}` };
  }
  const docKw = firstKeyword(normalized, DOC_KEYWORDS);
  if (docKw !== null) {
    return { kind: "documentacion", reason: `heading:doc:${docKw}` };
  }
  if (section.rules.length === 0) {
    return { kind: "documentacion", reason: "sin-reglas" };
  }
  return { kind: "reglas", reason: "default:reglas" };
}

function lineStarts(raw: string): number[] {
  const starts = [0];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function spanEnd(
  starts: number[],
  rawLength: number,
  nextLine: number | undefined,
): number {
  if (nextLine === undefined) {
    return rawLength;
  }
  return starts[nextLine - 1] ?? rawLength;
}

export function analyzeNoise(doc: ParsedDocument, rawContent: string): NoiseReport {
  if (rawContent.length === 0 || doc.sections.length === 0) {
    return {
      tokensTotales: estimateTokens(rawContent.length),
      tokensUtiles: 0,
      porcentajeRuido: 100,
      secciones: [],
    };
  }

  const starts = lineStarts(rawContent);
  const secciones: SectionNoise[] = [];
  let utilesChars = 0;

  for (let i = 0; i < doc.sections.length; i += 1) {
    const section = doc.sections[i];
    if (section === undefined) {
      continue;
    }
    const { kind, reason } = classifySection(section);
    const start = starts[section.line - 1] ?? rawContent.length;
    const next = doc.sections[i + 1];
    const end = spanEnd(starts, rawContent.length, next?.line);
    const charCount = Math.max(0, end - start);
    if (kind === "reglas") {
      utilesChars += charCount;
    }
    secciones.push({
      title: section.title,
      line: section.line,
      kind,
      reason,
      charCount,
      tokens: estimateTokens(charCount),
    });
  }

  const tokensTotales = estimateTokens(rawContent.length);
  const tokensUtiles = estimateTokens(utilesChars);
  const porcentajeRuido =
    rawContent.length === 0
      ? 100
      : Math.round((100 * (rawContent.length - utilesChars)) / rawContent.length);

  return { tokensTotales, tokensUtiles, porcentajeRuido, secciones };
}
