# Repository Instructions — Claude Code

Companion to [AGENTS.md](AGENTS.md), which applies here too. This file covers
what is specific to the Claude Code edition of this fork.

## Before you start

- Run `bun install` in `plugins/blender-agent-studio` first. Without it eight
  test files fail on `Cannot find module '@modelcontextprotocol/sdk'`, and the
  failures look like broken code rather than a missing dependency.
- Set `BLENDER_EXECUTABLE` to a Blender 5.2+ binary. Dozens of references read
  it; nothing assumes a path.

## Gates

- `bun run test` after changing TypeScript, MCP, scoring or benchmark code.
  Expect 75 pass, 3 skip, 0 fail.
- `bun run check` after changing plugin metadata, skills, marketplace files or
  documentation.
- `claude plugin validate .` after changing either `.claude-plugin` manifest.
- For the Claude benchmark port specifically, from
  `plugins/blender-agent-studio/skills/blender-agent-benchmark-claude`:
  `bun test scripts/` (35 tests) and `bun validate-port.ts --no-bare`, which
  spawns a real `claude` run and asserts eight conditions.

## Fork discipline

- **Keep changes additive.** The Codex path must keep working. The Claude
  benchmark port lives at `skills/blender-agent-benchmark-claude` *beside* the
  original rather than replacing it, for this reason.
- Do not edit `.agents/plugins/marketplace.json` or `.codex-plugin/plugin.json`.
  Claude's equivalents are `.claude-plugin/marketplace.json` and
  `plugins/blender-agent-studio/.claude-plugin/plugin.json`; keep the plugin
  name aligned across all four.
- Keep the diff against `upstream/main` reviewable. `claude-code-edition` is
  maintained as a PR-ready branch.
- Credit stays with Bars ([@ifBars](https://github.com/ifBars)); the skills are
  their work under MIT.

## Claude-specific traps in this repo

- **Use `.mcp-claude.json`, never `.mcp.json`.** The latter uses
  `./mcp/server.ts` with `cwd: "."`, which Codex resolves against the plugin
  root and Claude resolves against the session working directory — so under
  Claude it fails silently. The Claude file is `${CLAUDE_PLUGIN_ROOT}`-absolute.
- **Every new skill must link its bundled guidance.** `bun run check` requires
  the literal `](references/astra-workflow.md)` in each `SKILL.md`, and a
  bundled copy that matches the shared one. Run `bun tools/sync-guidance.ts`
  after adding a skill.
- **Skill `name:` frontmatter must equal its directory name.**

## Blender 5.2 API traps

Read [claude-edition/BLENDER-5.2-API-NOTES.md](claude-edition/BLENDER-5.2-API-NOTES.md)
before writing `bpy` against 4.x-era documentation. Three of the five changes
fail silently. The two that cost the most time:

- `scene.render.engine` **under-reports via RNA** — `enum_items` lists only
  `BLENDER_EEVEE` even where Cycles works, so a defensive membership check
  silently renders in EEVEE while reporting success. Assign directly inside
  `try/except TypeError`.
- **No visibility flag can hide a Geometry Nodes source object**, because
  instances inherit it. `hide_viewport` yields zero instances;
  `hide_render` yields an empty render; `visible_camera = False` yields
  translucent ghosts. Use `collection.instance_offset`.

## Evidence

- Do not commit generated Blender output. `.gitignore` already excludes
  `*.blend`, `*.glb`, `*.mp4`, `renders/`, `evidence/` and benchmark runs.
- Machine-generated logs and metrics carry absolute local paths. Keep them out,
  or genericise them; `claude-edition/` ships curated images and prose only.
- These skills require **opening rendered evidence**, not just reading metrics.
  In testing, half the skills passed every automated check while the renders
  showed real defects — see
  [claude-edition/FINDINGS.md](claude-edition/FINDINGS.md). Do not report a
  visual result you have not looked at.

## Benchmarking

- Compare conditions on `summary.json → execution.totalCostUsd`, not
  `totalTokens`. The latter excludes cache read/write and understated a
  validated run by 257x.
- Check `execution.costCoverage.complete`. A run killed by the timeout reports
  no cost and would silently understate the total.
- Pin exact model ids, never aliases. An alias resolves to whatever is current
  and breaks a comparison the moment a new model ships.
- Claude results are not comparable to the figures in
  `skills/blender-agent-benchmark/references/validated-results.md` — those are
  Codex runs on a different harness.
