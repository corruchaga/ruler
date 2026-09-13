#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { checkFreshness, formatFreshness, resolveTargetDir } from "./core/freshness.js";
import { analyzeNoise } from "./core/noise.js";
import { TargetNotFoundError, resolveTarget } from "./core/resolve-target.js";
import { averageScore, scoreRule } from "./core/score-rule.js";
import {
  flattenRules,
  parseMarkdownInstructions,
} from "./parsers/markdown-instructions.js";

const VERSION = "0.1.0";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ruler")
    .description(pc.cyan("Auditor for AI agent instruction files"))
    .version(VERSION, "-V, --version", pc.dim("Show version"))
    .argument("[path]", pc.dim("Path to audit"))
    .helpOption("-h, --help", pc.dim("Show help"))
    .configureHelp({
      styleTitle: (str) => pc.bold(pc.cyan(str)),
      styleCommandText: (str) => pc.cyan(str),
      styleCommandDescription: (str) => pc.dim(str),
      styleOptionText: (str) => pc.green(str),
      styleArgumentText: (str) => pc.green(str),
      styleSubcommandText: (str) => pc.cyan(str),
    })
    .action((targetPath?: string) => {
      if (!targetPath) {
        console.error(pc.red("Error: missing path. Usage: ruler <path>"));
        process.exit(1);
      }

      if (!existsSync(resolve(targetPath))) {
        console.error(pc.red(`Error: path not found: ${targetPath}`));
        process.exit(1);
      }

      let filePath: string;
      try {
        filePath = resolveTarget(resolve(targetPath));
      } catch (err) {
        if (err instanceof TargetNotFoundError) {
          console.error(
            pc.red(`Error: no AGENTS.md or CLAUDE.md found in ${targetPath}`),
          );
          process.exit(1);
        }
        throw err;
      }

      const content = readFileSync(filePath, "utf8");
      const doc = parseMarkdownInstructions(content);
      const rules = flattenRules(doc);
      const targetDir = resolveTargetDir(resolve(targetPath));
      console.log(`${rules.length} rules`);
      const scores: number[] = [];
      for (const rule of rules) {
        const { score } = scoreRule(rule);
        scores.push(score);
        console.log(`line ${rule.line} [${score}/10]: ${rule.text}`);
      }
      if (rules.length > 0) {
        console.log(`avg: ${averageScore(scores).toFixed(1)}/10`);
      }
      for (const line of formatFreshness(checkFreshness(doc, targetDir).findings)) {
        console.log(line);
      }
      const noise = analyzeNoise(doc, content);
      const noiseColor =
        noise.porcentajeRuido >= 50 ? pc.red : noise.porcentajeRuido >= 30 ? pc.yellow : pc.green;
      console.log(
        noiseColor(
          `noise: ${noise.porcentajeRuido}% (~${noise.tokensUtiles} útiles de ${noise.tokensTotales} totales)`,
        ),
      );
      for (const item of noise.secciones) {
        if (item.kind === "documentacion") {
          const title = item.title || "(preámbulo)";
          console.log(pc.dim(`line ${item.line} [RUIDO]: documentación — ${title}`));
        }
      }
    });

  return program;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    const self = fileURLToPath(import.meta.url);
    const invoked = resolve(entry);
    return process.platform === "win32"
      ? self.toLowerCase() === invoked.toLowerCase()
      : self === invoked;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  createProgram().parse();
}
