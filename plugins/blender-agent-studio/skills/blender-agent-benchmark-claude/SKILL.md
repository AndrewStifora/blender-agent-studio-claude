---
name: blender-agent-benchmark-claude
description: Benchmark Blender agent workflows with paired isolated runs driven by the Claude Code CLI. Use for baseline-versus-skills comparisons, regression suites, skill forward-testing, MCP usefulness evaluation, and cost-per-condition measurement when the agent under test is Claude Code rather than Codex.
---

# Blender Agent Benchmark — Claude Code edition

Read [the shared execution guidance](references/astra-workflow.md) once per task
for autonomous decisions, evidence cadence, and long-task continuity.

A port of `blender-agent-benchmark` that drives `claude` instead of `codex`.
The sibling skill is unchanged; use that one if you are benchmarking Codex.

Read [PORT-NOTES.md](PORT-NOTES.md) before changing anything here — it records
the flag mapping, the event-schema mapping, and the one place the port is
weaker than the original.

## What it does

Runs the same paired-condition protocol as the original: `baseline` (no skills)
against `skills` (skill files named in the prompt), holding task, model, effort,
time budget and evaluator identical, then scores both and reports the delta.

## Run it

```bash
bun run_benchmark.ts --suite smoke --mode baseline \
  --output ./runs/smoke-base --profile sonnet

bun run_benchmark.ts --suite smoke --mode skills \
  --output ./runs/smoke-skills --profile sonnet \
  --skill-root <path-to>/plugins/blender-agent-studio

bun compare_runs.ts --baseline ./runs/smoke-base \
  --candidate ./runs/smoke-skills --output ./runs/smoke-compare
```

Suites: `smoke` (1 task), `quick` (3), `full` (6), `challenge` (5),
`gauntlet` (1). An A/B is two agent runs per task plus one visual-judge run
per pair, so `full` is 18 agent invocations. `--timeout-minutes` defaults to
45 and `--repetitions` to 1.

Model profiles are pinned to exact ids, never aliases — an alias resolves to
whatever is current and silently breaks a comparison the moment a new model
ships. Efforts: `low|medium|high|xhigh|max`.

## Verify the port before trusting a run

```bash
bun validate-port.ts --no-bare   # OAuth is enough
bun validate-port.ts             # needs ANTHROPIC_API_KEY, exercises --bare
```

It spawns a real `claude` run through the harness's own argument builder,
captures the event stream the way `run_benchmark.ts` does, parses it with the
ported `trace.ts`, and asserts eight conditions. `bun test` in `scripts/`
covers the units.

## Compare conditions on cost, not tokens

`summary.json → execution` reports `totalCostUsd`. Use it.

`totalTokens` is input + output only and excludes cache read/write. In the
validated run that was 352 against 181,170 billed input tokens — a comparison
drawn on `totalTokens` would be measuring almost nothing. `costCoverage`
reports whether every run actually returned a cost; a run killed by the
timeout contributes nothing and would otherwise understate the total silently.

## Limits

- **`skills_mcp` mode needs the plugin's MCP server built.** It pins
  `<skillRoot>/mcp/server.ts`; the guard fires rather than running without MCP.
- **The visual judge is weaker than the Codex original.** Claude's CLI has no
  `--output-schema`, so conformance is requested in-prompt and validated
  afterwards, with one retry. See PORT-NOTES.md.
- **Results are not comparable to the numbers in
  `../blender-agent-benchmark/references/validated-results.md`.** Those are
  Codex runs on a different harness. Claude runs form their own baseline.
