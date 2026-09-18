export type ProviderName = "openrouter" | "deepseek";

export type LlmConfig = {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export type ConfigErrorCode = "MISSING_API_KEY" | "UNKNOWN_PROVIDER" | "INVALID_JSON";

export type ConfigError = {
  code: ConfigErrorCode;
  message: string;
};

export type EnvMap = Readonly<Record<string, string | undefined>>;

type FileFields = {
  apiKey?: string;
  provider?: string;
  model?: string;
};

const PROVIDERS: Record<ProviderName, { baseUrl: string; model: string }> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
};

export const MISSING_API_KEY_MESSAGE = `--judge requires an API key. Set one of:
  1. Environment variable RULER_API_KEY
  2. Repo file .rulerrc.json (never commit this file)
  3. User file ~/.rulerlintrc.json
Supported providers: openrouter, deepseek.`;

export function isConfigError(value: LlmConfig | ConfigError): value is ConfigError {
  return "code" in value;
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isProviderName(value: string): value is ProviderName {
  return value === "openrouter" || value === "deepseek";
}

function invalidJson(source: "local" | "global"): ConfigError {
  return {
    code: "INVALID_JSON",
    message:
      source === "local" ? "invalid JSON in .rulerrc.json" : "invalid JSON in ~/.rulerlintrc.json",
  };
}

function parseFile(content: string, source: "local" | "global"): FileFields | ConfigError {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return invalidJson(source);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalidJson(source);
  }
  const record = raw as Record<string, unknown>;
  const fields: FileFields = {};
  for (const key of ["apiKey", "provider", "model"] as const) {
    if (!(key in record)) {
      continue;
    }
    const value = record[key];
    if (typeof value !== "string") {
      return invalidJson(source);
    }
    const cleaned = clean(value);
    if (cleaned !== undefined) {
      fields[key] = cleaned;
    }
  }
  return fields;
}

function fromEnv(env: EnvMap): FileFields {
  return {
    apiKey: clean(env.RULER_API_KEY),
    provider: clean(env.RULER_PROVIDER),
    model: clean(env.RULER_MODEL),
  };
}

function apply(target: FileFields, source: FileFields): void {
  if (source.apiKey !== undefined) {
    target.apiKey = source.apiKey;
  }
  if (source.provider !== undefined) {
    target.provider = source.provider;
  }
  if (source.model !== undefined) {
    target.model = source.model;
  }
}

export function resolveLlmConfig(
  env: EnvMap,
  localFileContent?: string,
  globalFileContent?: string,
): LlmConfig | ConfigError {
  const merged: FileFields = {};

  if (globalFileContent !== undefined) {
    const globalFields = parseFile(globalFileContent, "global");
    if ("code" in globalFields) {
      return globalFields;
    }
    apply(merged, globalFields);
  }

  if (localFileContent !== undefined) {
    const localFields = parseFile(localFileContent, "local");
    if ("code" in localFields) {
      return localFields;
    }
    apply(merged, localFields);
  }

  apply(merged, fromEnv(env));

  const providerKey = (merged.provider ?? "openrouter").toLowerCase();
  if (merged.provider !== undefined && !isProviderName(providerKey)) {
    return {
      code: "UNKNOWN_PROVIDER",
      message: `unknown provider "${merged.provider}". Supported providers: openrouter, deepseek.`,
    };
  }

  if (merged.apiKey === undefined) {
    return {
      code: "MISSING_API_KEY",
      message: MISSING_API_KEY_MESSAGE,
    };
  }

  const provider: ProviderName = isProviderName(providerKey) ? providerKey : "openrouter";
  const spec = PROVIDERS[provider];

  return {
    provider,
    model: merged.model ?? spec.model,
    apiKey: merged.apiKey,
    baseUrl: spec.baseUrl,
  };
}
