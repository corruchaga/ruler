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

  function isolatedIo(env: NodeJS.ProcessEnv = {}, fetchImpl?: typeof fetch) {
    return { env, homedir: () => join(tmpdir(), "rulerlint-no-home"), fetch: fetchImpl };
  }

  function chatResponse(content: string, status = 200): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function emptyJudgeFetch() {
    return vi.fn(async () => chatResponse("[]"));
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

  it("prints the human report plus the no-contradictions line when --judge has a fake key", async () => {
    const program = createProgram(
      isolatedIo({ RULER_API_KEY: "sk-fake" }, emptyJudgeFetch()),
    );
    await program.parseAsync([bueno, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    const text = stdout();
    expect(text).toContain("score  79/100");
    expect(text).toContain("8 rules · avg 6.8/10 · freshness OK");
    expect(text).toMatch(/\n\njudge {2}no contradictions found$/);
    expect(text).not.toContain("sk-fake");
    expect(stripAnsi(errors.join("\n"))).not.toContain("sk-fake");
  });

  it("keeps JSON stdout intact and writes no judge status on --json --judge success", async () => {
    const program = createProgram(
      isolatedIo({ RULER_API_KEY: "sk-fake" }, emptyJudgeFetch()),
    );
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
    expect(stripAnsi(errors.join("\n"))).not.toMatch(/judge {2}/);
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
    const program = createProgram(
      isolatedIo({ RULER_API_KEY: "sk-fake" }, emptyJudgeFetch()),
    );
    await expect(program.parseAsync([repo, "--judge"], { from: "user" })).rejects.toThrow(
      "exit:1",
    );
    expect(exitCode).toBe(1);
    const text = stdout();
    expect(text).toContain("score  64/100");
    expect(text).toContain("path not found: src/no-existo/");
    expect(text).toMatch(/judge {2}no contradictions found/);
  });

  it("includes --judge in help text", () => {
    const program = createProgram();
    const help = program.helpInformation();
    expect(help).toMatch(/--judge/);
    expect(help).toMatch(/Enable LLM judge \(requires API key\)/);
  });

  it("retries once on broken JSON then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("not json"))
      .mockResolvedValueOnce(chatResponse("[]"));
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
    await program.parseAsync([bueno, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(secondBody.messages.at(-1)?.content).toBe("respond ONLY with the JSON array");
    expect(stdout()).toMatch(/judge {2}no contradictions found/);
  });

  it("degrades after two broken JSON responses without changing the exit code", async () => {
    const fetchImpl = vi.fn(async () => chatResponse("not json"));
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
    await program.parseAsync([bueno, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const text = stdout();
    expect(text).toContain("score  79/100");
    expect(text).toMatch(
      /judge {2}unavailable \(invalid response\), deterministic results unaffected$/,
    );
    expect(text).not.toContain("contradiction with line");
  });

  it("degrades on HTTP 401 without leaking the key", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid api key sk-fake" }), { status: 401 }),
    );
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
    await program.parseAsync([bueno, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const text = stdout();
    expect(text).toContain("score  79/100");
    expect(text).toMatch(
      /judge {2}unavailable \(http 401\), deterministic results unaffected/,
    );
    expect(text).not.toContain("sk-fake");
    expect(stripAnsi(errors.join("\n"))).not.toContain("sk-fake");
  });

  it("never calls fetch without --judge", async () => {
    const fetchImpl = vi.fn(async () => chatResponse("[]"));
    const program = createProgram({ fetch: fetchImpl });
    await program.parseAsync([bueno], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stdout()).not.toMatch(/judge {2}/);
  });

  it("does not call fetch when there are no rule-section rules", async () => {
    const fetchImpl = emptyJudgeFetch();
    const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
    await program.parseAsync([vacio, "--judge"], { from: "user" });
    expect(exitCode).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stdout()).toMatch(/judge {2}no contradictions found/);
  });

  it("prints parseable JSON with category judge and keeps the score", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        "# Rules\n- Always ask for confirmation before deleting anything\n- Batch deletes run without any confirmation\n",
      );
      const fetchImpl = vi.fn(async () =>
        chatResponse(
          JSON.stringify([
            {
              lineA: 2,
              lineB: 3,
              explanation: "one requires confirmation, the other skips it",
            },
          ]),
        ),
      );
      const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
      await program.parseAsync([dir, "--json", "--judge"], { from: "user" });
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0] ?? "") as {
        score: number;
        findings: {
          line: number;
          severity: string;
          category: string;
          message: string;
          snippet?: string;
        }[];
      };
      const judgeHits = parsed.findings.filter((item) => item.category === "judge");
      expect(judgeHits).toEqual([
        {
          line: 2,
          severity: "warning",
          category: "judge",
          message: "contradiction with line 3: one requires confirmation, the other skips it",
        },
      ]);
      const withoutJudge = createProgram(isolatedIo());
      logs.length = 0;
      await withoutJudge.parseAsync([dir, "--json"], { from: "user" });
      const baseline = JSON.parse(logs[0] ?? "") as { score: number };
      expect(parsed.score).toBe(baseline.score);
      expect(stripAnsi(errors.join("\n"))).not.toContain("sk-fake");
      expect(logs[0]).not.toContain("sk-fake");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns when the judge analyzes a prefix of the rules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const bullets = Array.from({ length: 120 }, (_, i) => {
        const n = String(i).padStart(3, "0");
        return `- Always validate input field field${n} against the schema before saving to disk`;
      });
      writeFileSync(join(dir, "AGENTS.md"), `# Rules\n${bullets.join("\n")}\n`);
      const fetchImpl = emptyJudgeFetch();
      const program = createProgram(isolatedIo({ RULER_API_KEY: "sk-fake" }, fetchImpl));
      await program.parseAsync([dir, "--judge"], { from: "user" });
      expect(exitCode).toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const userContent = (
        JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
          messages: { content: string }[];
        }
      ).messages[1]?.content;
      expect(userContent).toContain("field000");
      expect(userContent).not.toContain("field119");
      expect(stdout()).toMatch(/judge {2}analyzed first \d+ of 120 rules/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the cap line to stderr on --json --judge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const bullets = Array.from({ length: 120 }, (_, i) => {
        const n = String(i).padStart(3, "0");
        return `- Always validate input field field${n} against the schema before saving to disk`;
      });
      writeFileSync(join(dir, "AGENTS.md"), `# Rules\n${bullets.join("\n")}\n`);
      const program = createProgram(
        isolatedIo({ RULER_API_KEY: "sk-fake" }, emptyJudgeFetch()),
      );
      await program.parseAsync([dir, "--json", "--judge"], { from: "user" });
      expect(exitCode).toBeUndefined();
      expect(logs).toHaveLength(1);
      JSON.parse(logs[0] ?? "");
      expect(stripAnsi(errors.join("\n"))).toMatch(
        /judge {2}analyzed first \d+ of 120 rules/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
