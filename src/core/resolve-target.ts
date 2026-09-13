import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export class TargetNotFoundError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string) {
    super(`no AGENTS.md or CLAUDE.md found in ${targetPath}`);
    this.name = "TargetNotFoundError";
    this.targetPath = targetPath;
  }
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function resolveTarget(targetPath: string): string {
  const stats = statSync(targetPath);
  if (stats.isFile()) {
    return targetPath;
  }

  const agents = join(targetPath, "AGENTS.md");
  if (isFile(agents)) {
    return agents;
  }

  const claude = join(targetPath, "CLAUDE.md");
  if (isFile(claude)) {
    return claude;
  }

  throw new TargetNotFoundError(targetPath);
}
