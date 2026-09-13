import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli.js";

const bueno = resolve("test/fixtures/agents-bueno.md");
const vacio = resolve("test/fixtures/agents-vacio.md");

describe("createProgram", () => {
  let exitCode: number | undefined;
  const errors: string[] = [];
  const logs: string[] = [];

  beforeEach(() => {
    exitCode = undefined;
    errors.length = 0;
    logs.length = 0;
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      exitCode = typeof code === "number" ? code : 0;
      throw new Error(`exit:${exitCode}`);
    });
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ""));
    });
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ""));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a red error and exits 1 when path is missing", async () => {
    const program = createProgram();
    await expect(program.parseAsync([], { from: "user" })).rejects.toThrow(
      "exit:1",
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/missing path/i);
  });

  it("prints a red error and exits 1 when path does not exist", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["./carpeta-inexistente"], { from: "user" }),
    ).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/path not found/i);
  });

  it("exits 1 when a directory has no AGENTS.md or CLAUDE.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const program = createProgram();
      await expect(program.parseAsync([dir], { from: "user" })).rejects.toThrow(
        "exit:1",
      );
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toMatch(
        /no AGENTS\.md or CLAUDE\.md found/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints exactly 8 rules for agents-bueno.md", async () => {
    const program = createProgram();
    await program.parseAsync([bueno], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(logs).toEqual([
      "8 rules",
      "line 5 [9/10]: Always use TypeScript strict mode in new files",
      "line 6 [8/10]: Never commit secrets or API keys",
      "line 7 [2/10]: Prefer small pull requests over large ones",
      "line 11 [2/10]: Do not run destructive git commands",
      "line 12 [10/10]: Never skip the test suite",
      "line 14 [8/10]: Always write tests for new public APIs.",
      "line 18 [7/10]: Keep functions under fifty lines",
      "line 19 [8/10]: Name files in kebab-case",
      "avg: 6.8/10",
    ]);
  });

  it("prints 0 rules for an empty agents file", async () => {
    const program = createProgram();
    await program.parseAsync([vacio], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(logs).toEqual(["0 rules"]);
  });

  it("resolves AGENTS.md inside a directory and prints exact counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        "- Always keep directory resolution covered here.\n",
      );
      const program = createProgram();
      await program.parseAsync([dir], { from: "user" });
      expect(exitCode).toBeUndefined();
      expect(logs).toEqual([
        "1 rules",
        "line 1 [2/10]: Always keep directory resolution covered here.",
        "avg: 2.0/10",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
