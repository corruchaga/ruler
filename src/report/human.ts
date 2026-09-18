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
  warning: "⚠",
  info: "ℹ",
};

export type VisibleFindings = {
  visible: Finding[];
  omittedWarning: number;
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
    omittedWarning: omitted.filter((item) => item.severity === "warning").length,
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

function noiseColor(percent: number): (text: string) => string {
  if (percent >= 50) {
    return pc.red;
  }
  if (percent >= 30) {
    return pc.yellow;
  }
  return pc.green;
}

function severityColor(severity: Severity): (text: string) => string {
  if (severity === "error") {
    return pc.red;
  }
  if (severity === "warning") {
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

function omissionLine(omittedWarning: number, omittedInfo: number): string | null {
  const parts: string[] = [];
  if (omittedWarning > 0) {
    parts.push(`+${omittedWarning} warnings`);
  }
  if (omittedInfo > 0) {
    parts.push(`+${omittedInfo} infos`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `… ${parts.join(", ")} not shown`;
}

export function renderHuman(report: Report): string {
  const paint = scoreColor(report.score);
  const nErr = report.freshness.findings.length;
  const freshnessLabel =
    nErr === 0 ? pc.green("freshness OK") : pc.red(`freshness ${nErr} errors`);
  const wasted = report.tokens.total - report.tokens.useful;
  const noise = noiseColor(report.tokens.noisePercent);
  const { visible, omittedWarning, omittedInfo } = selectVisibleFindings(report.findings);
  const counts = report.findings.reduce(
    (acc, item) => {
      acc[item.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );

  const lines = [
    `${pc.bold(pc.cyan("ruler"))}  ${pc.bold(basename(report.target))}`,
    pc.dim(report.target),
    "",
    `score  ${paint(pc.bold(String(report.score)))}${pc.dim("/100")}`,
    `${report.rules.count} rules · avg ${report.rules.avg.toFixed(1)}/10 · ${freshnessLabel}`,
    noise(
      `noise ${report.tokens.noisePercent}% · ~${wasted} wasted tokens (${report.tokens.useful}/${report.tokens.total})`,
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
    `${pc.red("✖")} ${counts.error}   ${pc.yellow("⚠")} ${counts.warning}   ${pc.dim("ℹ")} ${counts.info}`,
  );
  const omitted = omissionLine(omittedWarning, omittedInfo);
  if (omitted) {
    lines.push(pc.dim(omitted));
  }

  return lines.join("\n");
}
