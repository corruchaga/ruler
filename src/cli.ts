#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";

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

      console.log(
        `ruler v${VERSION} — auditor de instrucciones para agentes. Análisis: próximamente`,
      );
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
