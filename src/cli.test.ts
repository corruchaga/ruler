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

  function isolatedIo(env: NodeJS.ProcessEnv = {}) {
    return { env, homedir: () => join(tmpdir(), "rulerlint-no-home") };
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
    expect(text).toContain("8 rules · avg 6.8/10 · freshness OK");
    expect(text).toContain("review");
    expect(text).toMatch(/ℹ {2}documentation — Project Agents/);
    expect(text).not.toContain("line 5 [9/10]");
  });

  it("prints score 0 for an empty agents file", async () => {
    const program = createProgram();
    await program.parseAsync([vacio], { from: "user" });
    expect(exitCode).toBeUndefined();
    const text = stdout();
    expect(text).toContain("score  0/100");
    expect(text).toContain("0 rules");
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
      expect(text).toContain("1 rules");
      expect(text).toContain("review");
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
    expect(text).toContain("6 rules");
    expect(text).toContain("path not found: src/no-existo/");
    expect(text).toContain("script not found: compilar");
    expect(text).toContain("dependency not found: no-such-pkg");
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
      rules: { count: number };
    };
    expect(parsed.score).toBe(79);
    expect(parsed.rules.count).toBe(8);
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

  it("exits 2 with the exact missing-key error and no report when --judge has no API key", async () => {
    const program = createProgram(isolatedIo());
    await expect(program.parseAsync([bueno, "--judge"], { from: "user" })).rejects.toThrow(
      "exit:2",
    );
    expect(exitCode).toBe(2);
    expect(logs).toHaveLength(0);
    const err = stripAnsi(errors.join("\n"));
    expect(err).toContain("Error: --judge requires an API key. Set one of:");
    expect(err).toContain("1. Environment variable RULER_API_KEY");
    expect(err).toContain("2. Repo file .rulerrc.json (never commit this file)");
    expect(err).toContain("3. User file ~/.rulerlintrc.json");
    expect(err).toContain("Supported providers: openrouter, deepseek.");
  });

  it("prints the human report plus the judge-ready line when --judge has a fake key", async () => {
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }));
    await program.parseAsync([bueno, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    const text = stdout();
    expect(text).toContain("score  79/100");
    expect(text).toContain("8 rules · avg 6.8/10 · freshness OK");
    expect(text).toMatch(/\n\njudge {2}ready \(no semantic checks yet\)$/);
    expect(text).not.toContain("sk-fake");
    expect(stripAnsi(errors.join("\n"))).not.toContain("sk-fake");
  });

  it("keeps JSON stdout intact and writes the judge note to stderr with --json --judge", async () => {
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }));
    await program.parseAsync([bueno, "--json", "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(/\x1B/);
    const parsed = JSON.parse(logs[0] ?? "") as {
      score: number;
      rules: { count: number };
      apiKey?: unknown;
    };
    expect(parsed.score).toBe(79);
    expect(parsed.rules.count).toBe(8);
    expect(parsed.apiKey).toBeUndefined();
    expect(logs[0]).not.toContain("sk-fake");
    expect(stripAnsi(errors.join("\n"))).toMatch(/judge {2}ready \(no semantic checks yet\)/);
    expect(stripAnsi(errors.join("\n"))).not.toContain("sk-fake");
  });

  it("still exits 1 for a missing path when --judge is set", async () => {
    const program = createProgram(isolatedIo());
    await expect(program.parseAsync(["--judge"], { from: "user" })).rejects.toThrow("exit:1");
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/missing path/i);
  });

  it("still exits 1 when a directory has no instruction file and --judge is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }));
      await expect(program.parseAsync([dir, "--judge"], { from: "user" })).rejects.toThrow(
        "exit:1",
      );
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toMatch(/no AGENTS\.md or CLAUDE.md found/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not read LLM config files without --judge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), "- Always keep directory resolution covered here.\n");
      writeFileSync(join(dir, ".rulerrc.json"), "{not json");
      const program = createProgram();
      await program.parseAsync([dir], { from: "user" });
      expect(exitCode).toBeUndefined();
      expect(stdout()).toContain("1 rules");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 not 2 for freshness errors when --judge config resolves", async () => {
    const repo = resolve("test/fixtures/freshness-repo");
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }));
    await expect(program.parseAsync([repo, "--judge"], { from: "user" })).rejects.toThrow(
      "exit:1",
    );
    expect(exitCode).toBe(1);
    const text = stdout();
    expect(text).toContain("score  64/100");
    expect(text).toContain("path not found: src/no-existo/");
    expect(text).toMatch(/judge {2}ready \(no semantic checks yet\)/);
  });

  it("includes --judge in help text", () => {
    const program = createProgram();
    const help = program.helpInformation();
    expect(help).toMatch(/--judge/);
    expect(help).toMatch(/Enable LLM judge \(requires API key\)/);
  });
});
