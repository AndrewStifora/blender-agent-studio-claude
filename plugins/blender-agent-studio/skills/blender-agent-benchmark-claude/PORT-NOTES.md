# blender-agent-benchmark → Claude Code CLI

A fork of skill 11, the one skill that could not run because its harness drives
the OpenAI `codex` CLI. The installed original is untouched, so the two can be
compared.

**Status: ported, unit-tested and validated end to end on 2026-09-19.** 35 unit
tests pass, and a live tool-using run passes all eight checks. See
[Verification](#verification).

```
plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/
├── SKILL.md
├── PORT-NOTES.md        this file
├── validate-port.ts     end-to-end check, run it yourself
└── scripts/             the ported harness
```

It sits beside the original `blender-agent-benchmark/` rather than replacing
it, so the Codex path keeps working and the diff against upstream is purely
additive. The harness's relative imports resolve unchanged from here:
`../../../scripts/blender-process.ts` reaches the plugin's shared helpers, and
`../blender-asset-validation/scripts/` reaches the inspector it calls.

---

## What changed, and what did not

| File | Change |
| --- | --- |
| `agent-cli.ts` | **new** — replaces `buildCodexArgs()` and the Codex halves of `pinned-mcp.ts` |
| `judge-cli.ts` | **new** — visual-judge adapter for three missing flags |
| `trace.ts` | **rewritten** — Claude `stream-json` event schema |
| `model-options.ts` | **rewritten** — Claude model ids and `--effort` levels |
| `run_benchmark.ts` | 4 edits: import, arg builder delegation, `Bun.spawn(["claude", …])`, command manifest — plus the new exported `summarizeExecution()` replacing the inline `execution` block |
| `compare_runs.ts` | 3 edits: import, `judgePair()` body, `execution` type + cost delta |
| `execution-aggregate.test.ts` | **new** — 4 tests over `summarizeExecution()` |
| `pinned-mcp.ts` | **deleted** — entirely Codex config plumbing; preflight moved into `agent-cli.ts` with a lazy SDK import |
| `trace.test.ts`, `run_benchmark.test.ts` | rewritten assertions |
| `score.ts`, `verified_score.ts`, `tasks.ts`, `rescore_run.ts` | **unchanged** — the whole scoring layer was already agent-agnostic |

`pluginPrefix()` needed no change either: the skill condition is delivered as a
prompt prefix naming absolute `SKILL.md` paths, not as a plugin install.

## Flag mapping

| Codex | Claude |
| --- | --- |
| `exec … -` (stdin prompt) | `-p` (reads piped stdin) |
| `--json` | `--output-format stream-json --verbose` |
| `-c model_reasoning_effort="high"` | `--effort high` |
| `--model M` | `--model M` (same flag) |
| `--sandbox danger-full-access` | `--permission-mode bypassPermissions` |
| `--dangerously-bypass-approvals-and-sandbox` | `--dangerously-skip-permissions` |
| `-C <cwd>` | dropped — `Bun.spawn({cwd})` already sets it |
| `--skip-git-repo-check` | dropped — Claude needs no git repo |
| `--ephemeral` | fresh `--session-id <uuid>` per run |
| `--ignore-user-config --ignore-rules --disable plugins --disable memories -c project_doc_max_bytes=0` + generated `skills.config=[…enabled=false]` | **`--bare`** |
| five `-c mcp_servers.bas_benchmark.*` pairs | `--mcp-config <json> --strict-mcp-config` |

Two places the port is **stronger** than the original:

- `--bare` replaces a generated argument that enumerated every host `SKILL.md`
  by path, and which carried a guard because it exceeded the Windows
  command-line budget. That whole mechanism is gone.
- `--strict-mcp-config` ignores all other MCP configuration. The Codex
  original's `-c` overrides were additive.

## Event schema mapping

| Codex | Claude |
| --- | --- |
| `turn.completed` | `result` |
| `usage.input_tokens` / `output_tokens` | same names |
| `usage.cached_input_tokens` | `usage.cache_read_input_tokens` |
| `usage.cache_write_input_tokens` | `usage.cache_creation_input_tokens` |
| `usage.reasoning_output_tokens` | `usage.output_tokens_details.thinking_tokens` |
| `item.completed` → `item.type` | `assistant` → `message.content[].type` |
| `item.status=="failed"` / `exit_code!=0` | `user` → `tool_result.is_error` |
| `item.type=="error"` | `result.is_error` / `subtype` / `terminal_reason` |

`AgentTraceSummary` keeps every original field, so nothing downstream changed.
Added fields, all of which Claude reports and the Codex parser had to infer:
`resultSubtype`, `terminalReason`, `permissionDenials`, `durationMs`,
`durationApiMs`, `totalCostUsd`, `sawResult`. The skill's own contract asks for
"execution failures, recovery turns, time" — `num_turns` and
`permission_denials` deliver two of those directly.

Tool calls are now tallied **by tool name** (`tool_use:Bash`), which the Codex
item types could not express.

## The one lossy part: the visual judge

`compare_runs.ts` asks an agent to look at rendered images and score them. It
used three Codex flags with no Claude equivalent.

| Lost flag | Compensation | Cost |
| --- | --- | --- |
| `--output-schema <file>` | schema embedded in the prompt; reply parsed and shape-validated in TypeScript; one retry with a stricter instruction | **Strictly weaker.** The model is *asked* for conforming JSON, not constrained to it |
| `--output-last-message <f>` | `--output-format json` returns the message in `.result`; the adapter writes `judge-result.json` itself | none |
| `--image <path>` | absolute paths listed in the prompt, agent told to open each with `Read` | one hop longer, same effect |
| `--sandbox read-only` | `--allowedTools "Read Glob"` — an allowlist, so no write or execute tool exists | arguably tighter |

Judging is the part of a benchmark that most needs to be trustworthy, so this
is called out rather than buried.

## Verification

**Unit tests: 35 pass, 0 fail.** `bun test` in
`skills/blender-agent-benchmark/scripts/`.

**End-to-end: PASSED 2026-09-19.** `validate-port.ts` spawns a real `claude`
run through the harness's own `buildClaudeArgs()`, captures the event stream
the way `run_benchmark.ts` does, and parses it with the ported `trace.ts`:

```
bun validate-port.ts            # needs ANTHROPIC_API_KEY (--bare path)
bun validate-port.ts --no-bare  # OAuth is enough; how this was validated
```

Result of the validated run — a two-tool task (write a file, read it back):

| Field | Value |
| --- | --- |
| `exitCode` / wall | 0 / 9,728 ms |
| `terminalReason` | `completed` |
| `toolCalls` | 2 — `tool_use:Write`, `tool_use:Read` |
| `tool_result` blocks | 2, `toolFailures` 0, `errors` 0 |
| `completedTurns` | 3 |
| `durationMs` / `durationApiMs` | 5,437 / 4,499 |
| tokens in / out | 18 / 334 |
| cache read / write | 43,688 / 46,879 |
| thinking tokens | 144 |
| `totalCostUsd` | 0.0998 |
| `invalidLines` | 0 |

All eight assertions pass. The `tool_use` / `tool_result` counting path, which
had only been checked against fixtures, is now confirmed against live output —
including the tally *by tool name*, which the Codex item types could not express.

### Three findings from the live runs

**1. Thinking tokens are `thinking_tokens`, not `reasoning_tokens`.** The Codex
field name (`reasoning_output_tokens`) led straight to the wrong key. Caught on
a *failed* run, before validation, because the raw envelope was dumped rather
than trusted. `reasoning_tokens` is kept as a fallback.

**2. `subtype` cannot be trusted on its own.** An expired-OAuth failure returns
`subtype: "success"` with `is_error: true` and `terminal_reason: "api_error"`.
Scored on subtype alone, that run would have been a clean success with zero
tokens — silent corruption of exactly the kind a benchmark cannot absorb. The
parser checks all three signals and there is a regression test for it.

**3. The stream carries event types this port was never shown.** The validated
run produced six: `system/init`, `system/commands_changed`,
`system/post_turn_summary`, `system/task_summary`, `system/thinking_tokens`
and `rate_limit_event`. The catch-all tallies them as `event:system` (8) and
`event:rate_limit_event` (1) instead of dropping them. The Codex parser's
equivalent branch `continue`d past anything unrecognised, so a new event type
was invisible; here it shows up in `completedItemsByType`. Worth keeping, since
the schema can gain types between CLI versions.

### Compare conditions on cost, not token count

From the validated run: `cacheWriteInputTokens` **46,879** against
`inputTokens` **18**. `usage.totalTokens` is input + output = **352**, which
misses roughly 99% of what the run actually consumed.

`totalCostUsd` (0.0998 here) is the honest comparison field, and it is one of
the fields this port gained.

**The aggregate is now wired through**, because the run-level summary was
reporting only the misleading number. `summarizeExecution()` in
`run_benchmark.ts` (exported and unit-tested) adds to `summary.json → execution`:

| Field | Why |
| --- | --- |
| `totalCostUsd` | summed from each run's result event — **the field to compare on** |
| `totalBilledInputTokens` | input + cache read + cache write: every token billed, at any rate |
| `totalCachedInputTokens`, `totalCacheWriteInputTokens` | the two the old total omitted |
| `totalThinkingTokens` | was captured per run, never aggregated |
| `costCoverage` | `{runsWithCost, runsTotal, complete}` |
| `costCaveat` | replaces the original `tokenCaveat` |

`compare_runs.ts` gains `candidateMinusBaseline.costUsd` and
`.billedInputTokens`, plus a top-level `execution.costComparable` flag.

Two deliberate choices:

- **`costCoverage` exists because cost only appears on the result event.** A
  run killed by the 45-minute timeout contributes $0 and silently understates
  the total. The count of runs that actually reported a cost travels with the
  sum, and `costComparable` is false unless *both* conditions reported cost for
  every run — a cost delta computed from partial data is worse than none.
- **The original's `tokenCaveat` was right.** It already said tokens were "a
  usage proxy, not a dollar-cost measurement"; Codex simply gave it no cost
  field to offer instead. The Claude CLI does, so the caveat became a
  measurement.

The tests use the validated run's real figures: two such runs aggregate to
`totalTokens` 704 against `totalBilledInputTokens` **181,170** — a 257× gap,
asserted so a regression that reintroduces the token-only view fails loudly.

## Will it reproduce the original results?

**Same methodology: yes.** Paired isolated conditions, identical task, effort
and evaluator, counting failures, turns and time — with better instrumentation
than before.

**Same numbers: no, definitionally.** `references/validated-results.md` records
`gpt-6-astra` runs. This harness measures Claude, and it is also a *different
harness*, so those figures are incomparable on two counts. Any Claude runs form
their own baseline series.

That is fine for the question worth asking — *do these skills improve my
outcomes?* — because both arms of that A/B run on this harness. Only comparison
against the published numbers is off the table.

## Known limits

- **The `--bare` isolation path is still untested.** Validation ran with
  `--no-bare`, because `--bare` authenticates strictly from
  `ANTHROPIC_API_KEY` or `apiKeyHelper` and never reads OAuth or the keychain.
  Everything else — arg construction, event parsing, tool counting, usage
  capture — is verified. For `baseline` vs `skills` comparisons `--bare` is
  optional; for a benchmark that wants host skills, plugins, memories and
  CLAUDE.md provably out of the picture, set an API key and run
  `bun validate-port.ts` without the flag. Note that this puts an API key in
  your environment as a second copy alongside whatever your applications use —
  worth adding to whatever credential-rotation list you keep.
- **`skills_mcp` mode cannot run.** It pins `<skillRoot>/mcp/server.ts`, and
  the plugin's MCP server was never ported. The guard fires with "Pinned MCP
  server is missing" rather than silently running without MCP. `baseline` and
  `skills` modes are unaffected.
- **`preflightPinnedMcp` needs `@modelcontextprotocol/sdk`**, not installed.
  The import is lazy, so nothing else breaks.
- **Effort levels are unvalidated per model.** `low|medium|high|xhigh|max` are
  accepted; whether each model honours each level is not checked. The requested
  value is recorded in the run manifest so a comparison can be audited later.
- **Pin exact model ids, never aliases.** `--model opus` resolves to whatever
  is current and silently breaks a benchmark when a new model ships. The
  profile table uses full ids for that reason.
