#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { checkFreshness, resolveTargetDir } from "./core/freshness.js";
import {
  JUDGE_MAX_TOKENS,
  buildJudgeMessages,
  judgeCapLine,
  judgeStatusLine,
  judgeUnavailableLine,
  parseJudgeResponse,
  rulesFromRuleSections,
  selectRulesForJudge,
  toJudgeFindings,
  withRetryNote,
} from "./core/judge.js";
import {
  isConfigError,
  resolveLlmConfig,
  type LlmConfig,
} from "./core/llm-config.js";
import { analyzeNoise } from "./core/noise.js";
import { TOOL_VERSION, buildReport, compareFindings, type Finding } from "./core/report.js";
import { TargetNotFoundError, resolveTarget } from "./core/resolve-target.js";
import { scoreRule } from "./core/score-rule.js";
import { callLlm } from "./llm/client.js";
import {
  flattenRules,
  parseMarkdownInstructions,
} from "./parsers/markdown-instructions.js";
import type { ParsedDocument } from "./parsers/types.js";
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";

export type CliIo = {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  fetch?: typeof fetch;
};

type JudgeRun = {
  findings: Finding[];
  status: string;
  cap: string | undefined;
  failed: boolean;
};

async function runJudge(
  doc: ParsedDocument,
  config: LlmConfig,
  fetchImpl: typeof fetch | undefined,
): Promise<JudgeRun> {
  const candidate = rulesFromRuleSections(doc);
  const { selected, total } = selectRulesForJudge(candidate);
  if (selected.length === 0) {
    return {
      findings: [],
      status: judgeStatusLine(0),
      cap: undefined,
      failed: false,
    };
  }

  const messages = buildJudgeMessages(selected);
  const sentLines = new Set(selected.map((rule) => rule.line));
  const first = await callLlm(config, messages, JUDGE_MAX_TOKENS, fetchImpl);
  if (!first.ok) {
    return {
      findings: [],
      status: judgeUnavailableLine(first.reason),
      cap: undefined,
      failed: true,
    };
  }

  let parsed = parseJudgeResponse(first.content, sentLines);
  if (!parsed.ok) {
    const second = await callLlm(
      config,
      withRetryNote(messages),
      JUDGE_MAX_TOKENS,
      fetchImpl,
    );
    if (!second.ok) {
      return {
        findings: [],
        status: judgeUnavailableLine(second.reason),
        cap: undefined,
        failed: true,
      };
    }
    parsed = parseJudgeResponse(second.content, sentLines);
    if (!parsed.ok) {
      return {
        findings: [],
        status: judgeUnavailableLine("invalid response"),
        cap: undefined,
        failed: true,
      };
    }
  }

  return {
    findings: toJudgeFindings(parsed.pairs),
    status: judgeStatusLine(parsed.pairs.length),
    cap: selected.length < total ? judgeCapLine(selected.length, total) : undefined,
    failed: false,
  };
}

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
    .action(async (targetPath?: string, opts?: { json?: boolean; judge?: boolean }) => {
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

      let llmConfig: LlmConfig | undefined;
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
        llmConfig = resolved;
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

      let judgeStatus: string | undefined;
      let judgeCap: string | undefined;
      let judgeFailed = false;
      if (opts?.judge && llmConfig !== undefined) {
        const judged = await runJudge(doc, llmConfig, io.fetch);
        if (judged.findings.length > 0) {
          report.findings.push(...judged.findings);
          report.findings.sort(compareFindings);
        }
        judgeStatus = judged.status;
        judgeCap = judged.cap;
        judgeFailed = judged.failed;
      }

      console.log(opts?.json ? renderJson(report) : renderHuman(report));
      if (opts?.judge) {
        if (opts.json) {
          if (judgeFailed && judgeStatus !== undefined) {
            console.error(pc.dim(judgeStatus));
          }
          if (judgeCap !== undefined) {
            console.error(pc.dim(judgeCap));
          }
        } else {
          console.log("");
          if (judgeStatus !== undefined) {
            console.log(pc.dim(judgeStatus));
          }
          if (judgeCap !== undefined) {
            console.log(pc.dim(judgeCap));
          }
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
  void createProgram().parseAsync();
}
