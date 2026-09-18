# rulerlint

Your `AGENTS.md` is injected on **every** model call. Vague rules, stale paths, and pages of docs are tokens you pay for â€” on every turn.

`ruler` is a deterministic CLI that audits agent instruction files (`AGENTS.md` / `CLAUDE.md`). No LLM. Score 0â€“100, stale-reference checks, and a token-cost noise report.

## Quick start

```bash
npx rulerlint <path>
```

`<path>` is a file or a directory (looks for `AGENTS.md`, then `CLAUDE.md`). After a global install the binary name is `ruler`.

```bash
npx rulerlint . --json
```

## Features (v0.1)

- Human terminal report with a global **score 0â€“100**
- Per-rule verifiability scoring (0â€“10, deterministic heuristics)
- **Freshness**: paths, npm scripts, and dependencies checked against the real repo
- **Noise / token cost**: documentation sections vs instruction sections
- **`--json`**: machine-readable report on stdout
- **`--judge`**: optional LLM contradiction check (sends extracted rules only)
- **Exit codes**: `1` on missing path / no instruction file / freshness errors; `2` on `--judge` with broken LLM config; `0` if only warnings or infos

## Dogfooding

Run on the real TradingPOT `AGENTS.md`:

| | |
|---|---|
| Score | **55 / 100** |
| Rules | 129 (avg 4.9/10) |
| Flagged for review | **66** |
| Noise | 36% Â· **~2444 wasted tokens** (4264 useful / 6708 total) |
| Freshness | OK (0 errors) |

## Before / after

[![ruler demo: 24/100 -> 92/100](https://asciinema.org/a/jVW99HJ9UTUSnAJt.svg)](https://asciinema.org/a/jVW99HJ9UTUSnAJt)

**Before** (TradingPOT, as `ruler` prints it):

```
score  55/100
129 rules Â· avg 4.9/10 Â· freshness OK
noise 36% Â· ~2444 wasted tokens (4264/6708)
```

Most of the file is context the model re-reads forever. Sixty-six bullets are not checkable.

**After** (tight fixture, `agents-bueno.md` â€” not a fictional TradingPOT rewrite):

```
score  79/100
8 rules Â· avg 6.8/10 Â· freshness OK
noise 5% Â· ~5 wasted tokens (87/92)
```

Shorter, checkable rules. Score goes up; wasted tokens go down.

## LLM judge (optional)

Without `--judge`, `ruler` is unchanged: fully deterministic, no env or config files read.

```bash
npx rulerlint . --judge
npx rulerlint . --json --judge
```

With `--judge` and a valid key, `ruler` sends extracted rule texts (and line numbers) to the configured provider and reports contradictory or overlapping pairs. Deterministic scoring is unchanged.

### Privacy

`--judge` is the only mode that leaves the machine. It sends extracted rule texts and their line numbers to the configured provider (OpenRouter or DeepSeek) — never the raw file, never documentation sections, never your repository. Without `--judge`, ruler is fully local: no network, no env, no config files.

### Configuration

Priority (last wins): built-in defaults → `~/.rulerlintrc.json` → `.rulerrc.json` in the **audited repo** → environment variables.

| Source | Keys |
|---|---|
| Environment | `RULER_API_KEY`, `RULER_PROVIDER`, `RULER_MODEL` |
| JSON files | `apiKey`, optional `provider`, optional `model` |

Supported providers: `openrouter` (default, model `openai/gpt-4o-mini`) and `deepseek` (model `deepseek-chat`).

`.rulerrc.json` lives in the **audited repository**, not in rulerlint. Never commit it. Add `.rulerrc.json` to **that repo's** `.gitignore` — rulerlint's own gitignore does not protect the audited project.

### Exit codes

- `0` — success (warnings / infos only)
- `1` — missing path, no instruction file, or freshness errors
- `2` — `--judge` with missing API key, unknown provider, or invalid JSON config

## Roadmap

Rule rewrites, visible token cost, SKILL.md lint, and a GitHub Action — not in this version.

## License

MIT

