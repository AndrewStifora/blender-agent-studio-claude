# Installing under Claude Code

Two routes. The marketplace route is the normal one; the skills-directory
route is useful if you want the skills without the plugin machinery.

## Prerequisites

- **Blender 5.2 or newer.** The skills read the `BLENDER_EXECUTABLE`
  environment variable rather than assuming a path — there are dozens of
  references to it, so set it once:

  ```powershell
  setx BLENDER_EXECUTABLE "C:\path\to\Blender\blender.exe"
  ```
  ```bash
  export BLENDER_EXECUTABLE=/path/to/blender      # add to your shell profile
  ```

- **[Bun](https://bun.sh)** for the MCP server, the Poly Haven helpers and the
  benchmark harness. The bundled scripts import only `node:*` and `bun:test`,
  so no `bun install` is needed for the skills themselves.

- **Optional:** a Rust toolchain, only for `blender_describe_scene`,
  `blender_quality_report` and `blender_compare_scenes`, which use the bundled
  SceneIR analyzer. Everything else is independent of it, and the skills
  degrade gracefully — they tell you to continue with the inspector and visual
  evidence rather than claim unmeasured analysis.

## Route 1 — as a plugin (recommended)

```bash
claude plugin marketplace add AndrewStifora/blender-agent-studio-claude
```
```bash
claude plugin install blender-agent-studio@blender-agent-studio-claude
```

That reads `.claude-plugin/marketplace.json` at the repository root, which
points at `plugins/blender-agent-studio`. All eleven skills plus the Claude
benchmark port come with it.

To work from a local clone instead, pass the path:

```bash
claude plugin marketplace add /path/to/blender-agent-studio-claude
```

**Why upstream cannot be installed directly:** Claude Code looks only for
`.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`. Upstream
ships `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`, so
pointing Claude at it fails with *"No manifest found in directory."* That is
the gap this fork closes.

## Route 2 — as a skills directory

Copy the skills into a single folder under your Claude skills directory, so
they load as one unit:

```
~/.claude/skills/blender-agent-studio/
├── .claude-plugin/plugin.json      { "skills": ["./"] }
├── SKILL.md                        the router
└── skills/                         the eleven skills
```

Copy `plugins/blender-agent-studio/skills/` and
`plugins/blender-agent-studio/scripts/` into that folder. Two things to fix
afterwards:

1. **The router's paths.** The root `SKILL.md` dispatches to
   `plugins/blender-agent-studio/skills/<name>/SKILL.md`. Flattened into a
   skills directory, those become `skills/<name>/SKILL.md`.
2. **Copy `scripts/` too.** Two benchmark scripts import
   `../../../scripts/blender-process.ts`, which lives at the plugin root, not
   inside a skill.

Loaded this way it appears as `blender-agent-studio@skills-dir`.

## MCP server

The plugin declares `.mcp-claude.json`, whose paths are
`${CLAUDE_PLUGIN_ROOT}`-absolute. Do **not** use the sibling `.mcp.json`
under Claude: it uses `./mcp/server.ts` with `cwd: "."`, which Codex resolves
against the plugin root but Claude resolves against the session working
directory — so it fails silently.

The MCP tools are optional. Every skill documents a CLI equivalent, and all
the testing in `claude-edition/` was done through those fallbacks with no MCP
server present. If you already run a Blender MCP server, mind the guidance in
`blender-mcp-integration`: do not run two add-on socket servers on the same
host and port.

## Verify the install

```bash
claude plugin validate /path/to/blender-agent-studio-claude
```

For the benchmark port specifically:

```bash
cd plugins/blender-agent-studio/skills/blender-agent-benchmark-claude
bun test scripts/            # 35 unit tests
bun validate-port.ts --no-bare   # real claude run, 8 assertions
```

Note that `claude plugin validate <repo>` checks only the marketplace manifest.
To check the plugin manifest as well, point it at the plugin:

```bash
claude plugin validate /path/to/blender-agent-studio-claude/plugins/blender-agent-studio
```

## Then what

[SKILLS.md](SKILLS.md) lists all twelve skills with a prompt that reaches each
one. You never name a skill — the descriptions are matched against what you ask
for.
