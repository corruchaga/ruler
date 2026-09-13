import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TargetNotFoundError, resolveTarget } from "./resolve-target.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ruler-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveTarget", () => {
  it("returns a file path unchanged", () => {
    const dir = tmp();
    const file = join(dir, "notes.md");
    writeFileSync(file, "# hi\n");
    expect(resolveTarget(file)).toBe(file);
  });

  it("prefers AGENTS.md over CLAUDE.md in a directory", () => {
    const dir = tmp();
    const agents = join(dir, "AGENTS.md");
    const claude = join(dir, "CLAUDE.md");
    writeFileSync(agents, "# agents\n");
    writeFileSync(claude, "# claude\n");
    expect(resolveTarget(dir)).toBe(agents);
  });

  it("falls back to CLAUDE.md when AGENTS.md is missing", () => {
    const dir = tmp();
    const claude = join(dir, "CLAUDE.md");
    writeFileSync(claude, "# claude\n");
    expect(resolveTarget(dir)).toBe(claude);
  });

  it("does not look in subdirectories", () => {
    const dir = tmp();
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "AGENTS.md"), "# nested\n");
    expect(() => resolveTarget(dir)).toThrow(TargetNotFoundError);
  });

  it("throws TargetNotFoundError when the directory has neither file", () => {
    const dir = tmp();
    expect(() => resolveTarget(dir)).toThrow(TargetNotFoundError);
    try {
      resolveTarget(dir);
    } catch (err) {
      expect(err).toBeInstanceOf(TargetNotFoundError);
      expect((err as TargetNotFoundError).message).toBe(
        `no AGENTS.md or CLAUDE.md found in ${dir}`,
      );
    }
  });
});
