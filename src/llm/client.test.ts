import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../core/judge.js";
import type { LlmConfig } from "../core/llm-config.js";
import { callLlm } from "./client.js";

const config: LlmConfig = {
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  apiKey: "sk-secret-key",
  baseUrl: "https://openrouter.ai/api/v1",
};

const messages: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "user" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("callLlm", () => {
  it("returns message content on HTTP 200", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "[]" } }] }),
    );
    const result = await callLlm(config, messages, 1500, fetchImpl);
    expect(result).toEqual({ ok: true, content: "[]" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret-key");
    const body = JSON.parse(String(init?.body)) as {
      temperature: number;
      max_tokens: number;
      model: string;
    };
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(1500);
    expect(body.model).toBe("openai/gpt-4o-mini");
  });

  it("maps AbortError to timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const result = await callLlm(config, messages, 1500, fetchImpl);
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(JSON.stringify(result)).not.toContain("sk-secret-key");
  });

  it("maps a thrown fetch error to network", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await callLlm(config, messages, 1500, fetchImpl);
    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("maps HTTP 401 to http 401 without leaking the key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid api key sk-secret-key" }), {
        status: 401,
      }),
    );
    const result = await callLlm(config, messages, 1500, fetchImpl);
    expect(result).toEqual({ ok: false, reason: "http 401" });
    expect(JSON.stringify(result)).not.toContain("sk-secret-key");
  });
});
