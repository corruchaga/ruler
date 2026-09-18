import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

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
      logs.push(stripAnsi(String(msg ?? "")));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stdout(): string {
    return logs.join("\n");
  }

  it("prints a red error and exits 1 when path is missing", async () => {
    const program = createProgram();
    await expect(program.parseAsync([], { from: "user" })).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/missing path/i);
  });

  it("prints a red error and exits 1 when path does not exist", async () => {
    const program = createProgram();
    await expect(program.parseAsync(["./carpeta-inexistente"], { from: "user" })).rejects.toThrow(
      "exit:1",
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/path not found/i);
  });

  it("exits 1 when a directory has no AGENTS.md or CLAUDE.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const program = createProgram();
      await expect(program.parseAsync([dir], { from: "user" })).rejects.toThrow("exit:1");
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toMatch(/no AGENTS\.md or CLAUDE.md found/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the human report for agents-bueno.md without listing every rule", async () => {
    const program = createProgram();
    await program.parseAsync([bueno], { from: "user" });
    expect(exitCode).toBeUndefined();
    const text = stdout();
    expect(text).toContain("score  79/100");
    expect(text).toContain("8 reglas · avg 6.8/10 · freshness OK");
    expect(text).toContain("revisar");
    expect(text).toMatch(/ℹ {2}documentación — Project Agents/);
    expect(text).not.toContain("line 5 [9/10]");
    expect(text).not.toContain("8 rules");
  });

  it("prints score 0 for an empty agents file", async () => {
    const program = createProgram();
    await program.parseAsync([vacio], { from: "user" });
    expect(exitCode).toBeUndefined();
    const text = stdout();
    expect(text).toContain("score  0/100");
    expect(text).toContain("0 reglas");
    expect(text).toContain("freshness OK");
  });

  it("resolves AGENTS.md inside a directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        "- Always keep directory resolution covered here.\n",
      );
      const program = createProgram();
      await program.parseAsync([dir], { from: "user" });
      expect(exitCode).toBeUndefined();
      const text = stdout();
      expect(text).toContain("1 reglas");
      expect(text).toContain("revisar");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 and reports freshness findings for the mini-repo fixture", async () => {
    const repo = resolve("test/fixtures/freshness-repo");
    const program = createProgram();
    await expect(program.parseAsync([repo], { from: "user" })).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    const text = stdout();
    expect(text).toContain("score  64/100");
    expect(text).toContain("6 reglas");
    expect(text).toContain("ruta no encontrada: src/no-existo/");
    expect(text).toContain("script no encontrado: compilar");
    expect(text).toContain("dependencia no encontrada: no-such-pkg");
    expect(text).toMatch(/10\s+✖/);
    expect(text).toMatch(/10\s+⚠/);
  });

  it("prints parseable JSON with --json for agents-bueno.md", async () => {
    const program = createProgram();
    await program.parseAsync([bueno, "--json"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(/\x1B/);
    const parsed = JSON.parse(logs[0] ?? "") as {
      score: number;
      reglas: { n: number };
    };
    expect(parsed.score).toBe(79);
    expect(parsed.reglas.n).toBe(8);
  });

  it("prints parseable JSON and exits 1 for freshness-repo --json", async () => {
    const repo = resolve("test/fixtures/freshness-repo");
    const program = createProgram();
    await expect(program.parseAsync([repo, "--json"], { from: "user" })).rejects.toThrow(
      "exit:1",
    );
    expect(exitCode).toBe(1);
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0] ?? "") as {
      score: number;
      freshness: { findings: unknown[] };
    };
    expect(parsed.score).toBe(64);
    expect(parsed.freshness.findings).toHaveLength(3);
  });
});
