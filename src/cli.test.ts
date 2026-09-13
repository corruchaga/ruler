import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli.js";

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

  it("prints the placeholder message when path exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ruler-"));
    try {
      const program = createProgram();
      await program.parseAsync([dir], { from: "user" });
      expect(logs).toContain(
        "ruler v0.1.0 — auditor de instrucciones para agentes. Análisis: próximamente",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
