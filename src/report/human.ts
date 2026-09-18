import { basename } from "node:path";
import pc from "picocolors";
import {
  HUMAN_FINDING_CAP,
  compareFindings,
  truncateSnippet,
  type Finding,
  type Report,
  type Severity,
} from "../core/report.js";

const ICON: Record<Severity, string> = {
  error: "✖",
  aviso: "⚠",
  info: "ℹ",
};

export type VisibleFindings = {
  visible: Finding[];
  omittedAviso: number;
  omittedInfo: number;
};

export function selectVisibleFindings(
  findings: readonly Finding[],
  cap = HUMAN_FINDING_CAP,
): VisibleFindings {
  const errors = findings.filter((item) => item.severity === "error");
  const rest = findings.filter((item) => item.severity !== "error");
  const budget = Math.max(0, cap - errors.length);
  const shownRest = rest.slice(0, budget);
  const omitted = rest.slice(budget);
  const visible = [...errors, ...shownRest].sort(compareFindings);
  return {
    visible,
    omittedAviso: omitted.filter((item) => item.severity === "aviso").length,
    omittedInfo: omitted.filter((item) => item.severity === "info").length,
  };
}

function scoreColor(score: number): (text: string) => string {
  if (score >= 80) {
    return pc.green;
  }
  if (score >= 50) {
    return pc.yellow;
  }
  return pc.red;
}

function noiseColor(porcentaje: number): (text: string) => string {
  if (porcentaje >= 50) {
    return pc.red;
  }
  if (porcentaje >= 30) {
    return pc.yellow;
  }
  return pc.green;
}

function severityColor(severity: Severity): (text: string) => string {
  if (severity === "error") {
    return pc.red;
  }
  if (severity === "aviso") {
    return pc.yellow;
  }
  return pc.dim;
}

function formatRow(item: Finding): string {
  const icon = ICON[item.severity];
  const snippet = item.snippet ? `  ${item.snippet}` : "";
  const text = truncateSnippet(
    `${String(item.line).padStart(4, " ")}  ${icon}  ${item.message}${snippet}`,
  );
  return severityColor(item.severity)(text);
}

function omissionLine(omittedAviso: number, omittedInfo: number): string | null {
  const parts: string[] = [];
  if (omittedAviso > 0) {
    parts.push(`+${omittedAviso} avisos`);
  }
  if (omittedInfo > 0) {
    parts.push(`+${omittedInfo} infos`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `… ${parts.join(", ")} no mostrados`;
}

export function renderHuman(report: Report): string {
  const paint = scoreColor(report.score);
  const nErr = report.freshness.findings.length;
  const freshnessLabel =
    nErr === 0 ? pc.green("freshness OK") : pc.red(`freshness ${nErr} errores`);
  const ahorro = report.tokens.totales - report.tokens.utiles;
  const noise = noiseColor(report.tokens.porcentajeRuido);
  const { visible, omittedAviso, omittedInfo } = selectVisibleFindings(report.findings);
  const counts = report.findings.reduce(
    (acc, item) => {
      acc[item.severity] += 1;
      return acc;
    },
    { error: 0, aviso: 0, info: 0 },
  );

  const lines = [
    `${pc.bold(pc.cyan("ruler"))}  ${pc.bold(basename(report.target))}`,
    pc.dim(report.target),
    "",
    `score  ${paint(pc.bold(String(report.score)))}${pc.dim("/100")}`,
    `${report.reglas.n} reglas · avg ${report.reglas.avg.toFixed(1)}/10 · ${freshnessLabel}`,
    noise(
      `ruido ${report.tokens.porcentajeRuido}% · ~${ahorro} tokens ahorrables (${report.tokens.utiles}/${report.tokens.totales})`,
    ),
    "",
  ];

  for (const item of visible) {
    lines.push(formatRow(item));
  }
  if (visible.length > 0) {
    lines.push("");
  }

  lines.push(
    `${pc.red("✖")} ${counts.error}   ${pc.yellow("⚠")} ${counts.aviso}   ${pc.dim("ℹ")} ${counts.info}`,
  );
  const omitted = omissionLine(omittedAviso, omittedInfo);
  if (omitted) {
    lines.push(pc.dim(omitted));
  }

  return lines.join("\n");
}
