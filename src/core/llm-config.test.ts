import { describe, expect, it } from "vitest";
import {
  MISSING_API_KEY_MESSAGE,
  isConfigError,
  resolveLlmConfig,
} from "./llm-config.js";

describe("resolveLlmConfig", () => {
  it("uses openrouter defaults when only RULER_API_KEY is set", () => {
    const result = resolveLlmConfig({ RULER_API_KEY: "sk-test" });
    expect(isConfigError(result)).toBe(false);
    expect(result).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      apiKey: "sk-test",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("uses deepseek baseUrl and default model from RULER_PROVIDER", () => {
    const result = resolveLlmConfig({
      RULER_API_KEY: "sk-test",
      RULER_PROVIDER: "deepseek",
    });
    expect(result).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
    });
  });

  it("lets RULER_MODEL override the provider default", () => {
    const result = resolveLlmConfig({
      RULER_API_KEY: "sk-test",
      RULER_MODEL: "openai/gpt-4o",
    });
    expect(result).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKey: "sk-test",
    });
  });

  it("lets local file fields override global file fields", () => {
    const result = resolveLlmConfig(
      {},
      JSON.stringify({
        apiKey: "local-key",
        provider: "deepseek",
        model: "deepseek-reasoner",
      }),
      JSON.stringify({
        apiKey: "global-key",
        provider: "openrouter",
        model: "openai/gpt-4o",
      }),
    );
    expect(result).toEqual({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "local-key",
      baseUrl: "https://api.deepseek.com",
    });
  });

  it("lets env override local file fields", () => {
    const result = resolveLlmConfig(
      {
        RULER_API_KEY: "env-key",
        RULER_PROVIDER: "openrouter",
        RULER_MODEL: "openai/gpt-4o",
      },
      JSON.stringify({
        apiKey: "local-key",
        provider: "deepseek",
        model: "deepseek-chat",
      }),
    );
    expect(result).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKey: "env-key",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("ignores extra JSON keys", () => {
    const result = resolveLlmConfig(
      {},
      JSON.stringify({ apiKey: "sk-test", foo: 1, temperature: 0 }),
    );
    expect(result).toMatchObject({ apiKey: "sk-test", provider: "openrouter" });
  });

  it("returns INVALID_JSON for a read file even if env has a key", () => {
    const local = resolveLlmConfig({ RULER_API_KEY: "sk-test" }, "{not json");
    expect(local).toEqual({
      code: "INVALID_JSON",
      message: "invalid JSON in .rulerrc.json",
    });
    expect(JSON.stringify(local)).not.toContain("sk-test");

    const global = resolveLlmConfig({ RULER_API_KEY: "sk-test" }, undefined, "{not json");
    expect(global).toEqual({
      code: "INVALID_JSON",
      message: "invalid JSON in ~/.rulerlintrc.json",
    });
    expect(JSON.stringify(global)).not.toContain("sk-test");
  });

  it("returns INVALID_JSON when apiKey, provider, or model is not a string", () => {
    expect(resolveLlmConfig({}, JSON.stringify({ apiKey: 1 }))).toEqual({
      code: "INVALID_JSON",
      message: "invalid JSON in .rulerrc.json",
    });
    expect(resolveLlmConfig({}, undefined, JSON.stringify({ apiKey: "sk", provider: true }))).toEqual(
      {
        code: "INVALID_JSON",
        message: "invalid JSON in ~/.rulerlintrc.json",
      },
    );
    expect(resolveLlmConfig({}, JSON.stringify({ apiKey: "sk", model: 3 }))).toEqual({
      code: "INVALID_JSON",
      message: "invalid JSON in .rulerrc.json",
    });
  });

  it("returns UNKNOWN_PROVIDER with the exact message", () => {
    const result = resolveLlmConfig({
      RULER_API_KEY: "sk-test",
      RULER_PROVIDER: "openai",
    });
    expect(result).toEqual({
      code: "UNKNOWN_PROVIDER",
      message: 'unknown provider "openai". Supported providers: openrouter, deepseek.',
    });
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });

  it("treats provider names as case-insensitive", () => {
    const result = resolveLlmConfig({
      RULER_API_KEY: "sk-test",
      RULER_PROVIDER: "DeepSeek",
    });
    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
  });

  it("treats empty or whitespace apiKey as absent with the exact MISSING_API_KEY message", () => {
    const result = resolveLlmConfig({ RULER_API_KEY: "   " });
    expect(result).toEqual({
      code: "MISSING_API_KEY",
      message: MISSING_API_KEY_MESSAGE,
    });
    expect(MISSING_API_KEY_MESSAGE).toBe(
      `--judge requires an API key. Set one of:
  1. Environment variable RULER_API_KEY
  2. Repo file .rulerrc.json (never commit this file)
  3. User file ~/.rulerlintrc.json
Supported providers: openrouter, deepseek.`,
    );
  });
});
