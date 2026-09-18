#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { checkFreshness, resolveTargetDir } from "./core/freshness.js";
import { isConfigError, resolveLlmConfig } from "./core/llm-config.js";
import { analyzeNoise } from "./core/noise.js";
import { TOOL_VERSION, buildReport } from "./core/report.js";
import { TargetNotFoundError, resolveTarget } from "./core/resolve-target.js";
import { scoreRule } from "./core/score-rule.js";
import {
  flattenRules,
  parseMarkdownInstructions,
} from "./parsers/markdown-instructions.js";
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";

export type CliIo = {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
};

export function createProgram(io: CliIo = {}): Command {
  const program = new Command();

  program
    .name("ruler")
    .description(pc.cyan("Auditor for AI agent instruction files"))
    .version(TOOL_VERSION, "-V, --version", pc.dim("Show version"))
    .argument("[path]", pc.dim("Path to audit"))
    .option("--json", "Print JSON report")
    .option("--judge", "Enable LLM judge (requires API key)")
    .helpOption("-h, --help", pc.dim("Show help"))
    .configureHelp({
      styleTitle: (str) => pc.bold(pc.cyan(str)),
      styleCommandText: (str) => pc.cyan(str),
      styleCommandDescription: (str) => pc.dim(str),
      styleOptionText: (str) => pc.green(str),
      styleArgumentText: (str) => pc.green(str),
      styleSubcommandText: (str) => pc.cyan(str),
    })
    .action((targetPath?: string, opts?: { json?: boolean; judge?: boolean }) => {
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

      const targetDir = resolveTargetDir(resolve(targetPath));

      if (opts?.judge) {
        const env = io.env ?? process.env;
        const home = (io.homedir ?? homedir)();
        const localPath = join(targetDir, ".rulerrc.json");
        const globalPath = join(home, ".rulerlintrc.json");
        const localContent = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined;
        const globalContent = existsSync(globalPath) ? readFileSync(globalPath, "utf8") : undefined;
        const resolved = resolveLlmConfig(env, localContent, globalContent);
        if (isConfigError(resolved)) {
          console.error(pc.red(`Error: ${resolved.message}`));
          process.exit(2);
        }
      }

      const content = readFileSync(filePath, "utf8");
      const doc = parseMarkdownInstructions(content);
      const scored = flattenRules(doc).map((rule) => {
        const result = scoreRule(rule);
        return {
          text: rule.text,
          line: rule.line,
          score: result.score,
          signals: result.signals,
        };
      });
      const report = buildReport({
        target: filePath,
        scored,
        freshness: checkFreshness(doc, targetDir),
        noise: analyzeNoise(doc, content),
      });

      console.log(opts?.json ? renderJson(report) : renderHuman(report));
      if (opts?.judge) {
        const note = pc.dim("judge  ready (no semantic checks yet)");
        if (opts.json) {
          console.error(note);
        } else {
          console.log("");
          console.log(note);
        }
      }
      if (report.freshness.findings.length > 0) {
        process.exit(1);
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
