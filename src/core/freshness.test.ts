import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseMarkdownInstructions,
} from "../parsers/markdown-instructions.js";
import {
  checkFreshness,
  extractDependencies,
  extractPaths,
  extractScripts,
  formatFreshness,
} from "./freshness.js";

function rule(text: string, line = 1) {
  return { text, line };
}

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ruler-fresh-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extractPaths", () => {
  it("extracts anchored files, dirs, and relative paths", () => {
    expect(extractPaths(rule("Nunca edites src/ui/Button.tsx"))).toEqual([
      "src/ui/Button.tsx",
    ]);
    expect(extractPaths(rule("Pon config en ./config/x.ts"))).toEqual([
      "./config/x.ts",
    ]);
    expect(extractPaths(rule("Lee docs/guide.md ahora mismo"))).toEqual([
      "docs/guide.md",
    ]);
    expect(extractPaths(rule("Always keep src/ui/ documented here"))).toEqual([
      "src/ui/",
    ]);
    expect(extractPaths(rule("Never touch `/src/services/` directly"))).toEqual([
      "/src/services/",
    ]);
  });

  it("strips wrapping punctuation including ()[]\"'", () => {
    expect(extractPaths(rule("See (src/ui/Button.tsx) please now"))).toEqual([
      "src/ui/Button.tsx",
    ]);
    expect(extractPaths(rule('See "src/ui/Button.tsx" please now'))).toEqual([
      "src/ui/Button.tsx",
    ]);
    expect(extractPaths(rule("See [src/ui/Button.tsx] please now"))).toEqual([
      "src/ui/Button.tsx",
    ]);
    expect(extractPaths(rule("See 'src/ui/Button.tsx' please now"))).toEqual([
      "src/ui/Button.tsx",
    ]);
  });

  it("ignores slashes that are not project paths", () => {
    expect(extractPaths(rule("usa y/o alternativas validas aqui"))).toEqual([]);
    expect(extractPaths(rule("servicio disponible 24/7 sin pausa"))).toEqual([]);
    expect(extractPaths(rule("usar flex/grid y gap en el layout"))).toEqual([]);
    expect(extractPaths(rule("colores LARGO/CORTO nunca se mezclan"))).toEqual(
      [],
    );
    expect(
      extractPaths(rule("tema claro/oscuro se aplica en el root")),
    ).toEqual([]);
    expect(
      extractPaths(rule("https://api.bybit.com/v5/market/kline demo")),
    ).toEqual([]);
    expect(
      extractPaths(rule("wss://stream.bybit.com/v5/public/spot stream")),
    ).toEqual([]);
    expect(extractPaths(rule("archivo providers/types.ts del adapter"))).toEqual(
      [],
    );
    expect(
      extractPaths(rule("ver strategyEngine.ts/strategyRules.ts juntos")),
    ).toEqual([]);
    expect(extractPaths(rule("documenta docs/*.md del proyecto"))).toEqual([]);
    expect(extractPaths(rule("Name files in kebab-case always"))).toEqual([]);
  });
});

describe("extractScripts", () => {
  it("extracts package scripts", () => {
    expect(extractScripts(rule("Always run `npm run build` first"))).toEqual([
      "build",
    ]);
    expect(extractScripts(rule("Then yarn test before merge"))).toEqual([
      "test",
    ]);
    expect(extractScripts(rule("Finally pnpm run lint on CI"))).toEqual([
      "lint",
    ]);
    expect(extractScripts(rule("Always run npm test before merge"))).toEqual([
      "test",
    ]);
  });

  it("ignores package manager builtins", () => {
    expect(extractScripts(rule("NO ejecutes npm install salvo que falte"))).toEqual(
      [],
    );
    expect(extractScripts(rule("Never run npm ci in this repo"))).toEqual([]);
    expect(extractScripts(rule("Avoid yarn add lodash here please"))).toEqual(
      [],
    );
  });
});

describe("extractDependencies", () => {
  it("extracts phrase, kebab+version, and import forms", () => {
    expect(
      extractDependencies(rule("Indicadores: librería `technicalindicators`")),
    ).toEqual(["technicalindicators"]);
    expect(
      extractDependencies(rule("Always usa la librería left-pad in tests")),
    ).toEqual(["left-pad"]);
    expect(
      extractDependencies(rule("Gráficos: lightweight-charts v5 en cliente")),
    ).toEqual(["lightweight-charts"]);
    expect(
      extractDependencies(rule('Always import x from "zod" in new files')),
    ).toEqual(["zod"]);
  });

  it("looks up names case-insensitively at check time and skips stoplist", () => {
    expect(
      extractDependencies(rule("Always usa la librería Left-Pad in tests")),
    ).toEqual(["Left-Pad"]);
    expect(extractDependencies(rule("Never uses React Portal anywhere"))).toEqual(
      [],
    );
    expect(extractDependencies(rule("Estado: Zustand con persist middleware"))).toEqual(
      [],
    );
    expect(extractDependencies(rule("Always usa Vite for the toolchain"))).toEqual(
      [],
    );
    expect(
      extractDependencies(rule("Always use TypeScript strict mode in files")),
    ).toEqual([]);
  });

  it("ignores CSS, kebab-case, and non-package prose", () => {
    expect(
      extractDependencies(rule("Name files in kebab-case always please")),
    ).toEqual([]);
    expect(
      extractDependencies(rule("Respetar always prefers-reduced-motion")),
    ).toEqual([]);
    expect(
      extractDependencies(rule("Nunca uses `position:absolute` ni z altos")),
    ).toEqual([]);
    expect(
      extractDependencies(
        rule("NO ejecutes npm install salvo que falte una dependencia concreta"),
      ),
    ).toEqual([]);
    expect(
      extractDependencies(rule("TODA la app usa la tipografía de marca")),
    ).toEqual([]);
    expect(
      extractDependencies(rule("un chip LARGO no usa el pastel de marca")),
    ).toEqual([]);
  });
});

describe("checkFreshness", () => {
  const fixture = resolve("test/fixtures/freshness-repo");

  it("reports missing path, script, and dependency with exact lines", () => {
    const doc = parseMarkdownInstructions(
      `## Rules
- Always keep \`src/ui/\` documented
- Always run \`npm run build\`
- Always usa la librería left-pad
- Never edit \`src/no-existo/\`
- Always run \`npm run compilar\`
- Never usa la librería no-such-pkg
`,
    );
    const { findings } = checkFreshness(doc, fixture);
    expect(findings).toEqual([
      {
        kind: "ruta",
        value: "src/no-existo/",
        line: 5,
        lookedIn: resolve(fixture, "src/no-existo/"),
      },
      {
        kind: "script",
        value: "compilar",
        line: 6,
        lookedIn: "package.json scripts",
      },
      {
        kind: "dependencia",
        value: "no-such-pkg",
        line: 7,
        lookedIn: "package.json dependencies/devDependencies",
      },
    ]);
  });

  it("matches dependencies case-insensitively", () => {
    const doc = parseMarkdownInstructions(
      "- Always usa la librería Left-Pad in this module\n",
    );
    expect(checkFreshness(doc, fixture).findings).toEqual([]);
  });

  it("skips scripts and deps when package.json is missing", () => {
    const dir = tmp();
    mkdirSync(join(dir, "src", "ui"), { recursive: true });
    writeFileSync(join(dir, "src", "ui", "ok.ts"), "export {};\n");
    const doc = parseMarkdownInstructions(
      "- Always keep `src/ui/` documented here\n- Always run `npm run missing`\n",
    );
    expect(checkFreshness(doc, dir).findings).toEqual([]);
  });

  it("formats findings and OK", () => {
    expect(formatFreshness([])).toEqual(["freshness: OK"]);
    expect(
      formatFreshness([
        {
          kind: "ruta",
          value: "src/no-existo/",
          line: 4,
          lookedIn: "C:\\tmp\\src\\no-existo\\",
        },
      ]),
    ).toEqual([
      "line 4 [FRESHNESS]: ruta - src/no-existo/ not found (C:\\tmp\\src\\no-existo\\)",
    ]);
  });
});
