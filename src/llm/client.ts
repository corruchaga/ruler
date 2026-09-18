import type { ChatMessage } from "../core/judge.js";
import type { LlmConfig } from "../core/llm-config.js";

export const LLM_TIMEOUT_MS = 30_000;

export type LlmResult =
  | { ok: true; content: string }
  | { ok: false; reason: string };

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return "";
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

export async function callLlm(
  config: LlmConfig,
  messages: readonly ChatMessage[],
  maxTokens: number,
  fetchImpl?: typeof fetch,
): Promise<LlmResult> {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, LLM_TIMEOUT_MS);
  try {
    const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `http ${response.status}` };
    }
    try {
      const payload: unknown = await response.json();
      return { ok: true, content: extractContent(payload) };
    } catch {
      return { ok: true, content: "" };
    }
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}
