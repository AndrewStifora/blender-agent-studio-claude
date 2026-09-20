# License note

This folder is part of a fork. Nothing here relicenses anything.

## The skills are Bars' work

Blender Agent Studio — all eleven skills, the MCP server, the scoring harness
and the reference documents — was written by **Bars**
([@ifBars](https://github.com/ifBars)) and published at
[ifBars/blender-agent-studio](https://github.com/ifBars/blender-agent-studio)
under the MIT License.

The root [`LICENSE`](../LICENSE) is upstream's, unmodified:

> MIT License
>
> Copyright (c) 2026 Bars

That copyright line stays exactly as it is. This fork claims no ownership of
the skills and makes no change to their terms.

## What this fork adds, and under what terms

Everything added here is contributed **under the same MIT License**, so the
repository has one set of terms throughout and a downstream user needs to read
only the root `LICENSE`:

| Addition | Author |
| --- | --- |
| `.claude-plugin/marketplace.json` and `plugins/blender-agent-studio/.claude-plugin/plugin.json` | this fork |
| `plugins/blender-agent-studio/.mcp-claude.json` | this fork |
| `plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/` | port of Bars' `blender-agent-benchmark`; the protocol, tasks, prompts and scoring are Bars', the CLI driver and event parsing are this fork's |
| `claude-edition/` (this folder) | this fork |
| `CLAUDE.md` | this fork |
| the fork notice at the top of `README.md` | this fork |

The benchmark port is a derivative work and is marked as such in its own
[`SKILL.md`](../plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/SKILL.md)
and [`PORT-NOTES.md`](../plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/PORT-NOTES.md).
It sits *beside* the original rather than replacing it, so upstream's Codex
harness is untouched.

## The images in `highlights/`

The 19 before/after PNGs are Blender renders produced by running Bars' skills
on scenes built for this testing. They are released under MIT with the rest of
the repository. They depict no real person, no third-party asset and no
imported model — every scene was generated from deterministic Python written
for these tests, so there is no CC BY-NC or other attribution obligation riding
along with them.

## Trademarks and dependencies

Blender and the Blender logo are trademarks of the Blender Foundation. This
project integrates with Blender and is neither affiliated with nor endorsed by
the Blender Foundation. Bundled third-party material — the Blender icon and the
runtime dependencies — is listed in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) at the repository root.

## If you use this

Keep the MIT notice and the `Copyright (c) 2026 Bars` line. Credit belongs
upstream; a link to [ifBars/blender-agent-studio](https://github.com/ifBars/blender-agent-studio)
is the honest way to point at it.
