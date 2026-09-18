# rulerlint

Your `AGENTS.md` is injected on **every** model call. Vague rules, stale paths, and pages of docs are tokens you pay for — on every turn.

`ruler` is a deterministic CLI that audits agent instruction files (`AGENTS.md` / `CLAUDE.md`). No LLM. Score 0–100, stale-reference checks, and a token-cost noise report.

## Quick start

```bash
npx rulerlint <path>
```

`<path>` is a file or a directory (looks for `AGENTS.md`, then `CLAUDE.md`). After a global install the binary name is `ruler`.

```bash
npx rulerlint . --json
```

## Features (v0.1)

- Human terminal report with a global **score 0–100**
- Per-rule verifiability scoring (0–10, deterministic heuristics)
- **Freshness**: paths, npm scripts, and dependencies checked against the real repo
- **Noise / token cost**: documentation sections vs instruction sections
- **`--json`**: machine-readable report on stdout
- **Exit codes**: `1` on missing path / no instruction file / freshness errors; `0` if only warnings or infos

## Dogfooding

Run on the real TradingPOT `AGENTS.md`:

| | |
|---|---|
| Score | **55 / 100** |
| Rules | 129 (avg 4.9/10) |
| Flagged for review | **66** |
| Noise | 36% · **~2444 wasted tokens** (4264 useful / 6708 total) |
| Freshness | OK (0 errors) |

## Before / after

<!-- asciinema: record after publish and drop the player here -->

**Before** (TradingPOT, as `ruler` prints it):

```
score  55/100
129 rules · avg 4.9/10 · freshness OK
noise 36% · ~2444 wasted tokens (4264/6708)
```

Most of the file is context the model re-reads forever. Sixty-six bullets are not checkable.

**After** (tight fixture, `agents-bueno.md` — not a fictional TradingPOT rewrite):

```
score  79/100
8 rules · avg 6.8/10 · freshness OK
noise 5% · ~5 wasted tokens (87/92)
```

Shorter, checkable rules. Score goes up; wasted tokens go down.

## Roadmap

LLM judge, SKILL.md lint, and a GitHub Action — not in v0.1.

## License

MIT
