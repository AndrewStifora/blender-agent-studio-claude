# Claude Code edition

This fork adds Claude Code support to [Bars' Blender Agent
Studio](https://github.com/ifBars/blender-agent-studio) (MIT). All eleven
skills are Bars' work; the additions here are the plumbing Claude Code needs
and a record of testing every skill against real Blender.

**Nothing upstream is overwritten.** The diff is additive, so the Codex path
keeps working.

## What this fork adds

| Addition | Why |
| --- | --- |
| `.claude-plugin/marketplace.json` | Claude Code reads only `.claude-plugin/`; upstream ships `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`, which Claude cannot see |
| `plugins/blender-agent-studio/.claude-plugin/plugin.json` | same reason, at the plugin level |
| `plugins/blender-agent-studio/.mcp-claude.json` | the sibling `.mcp.json` uses `./mcp/server.ts` with `cwd: "."`, which Codex resolves against the plugin root but Claude resolves against the **session** working directory — so it fails silently. This one is `${CLAUDE_PLUGIN_ROOT}`-absolute |
| `skills/blender-agent-benchmark-claude/` | the benchmark harness driven by `claude` instead of `codex`, added beside the original rather than replacing it |
| `claude-edition/` | this folder: test findings, API notes, before/after evidence |

See [INSTALL.md](INSTALL.md) for both install routes.

## Documents

- **[SKILLS.md](SKILLS.md)** — all twelve skills, what each one does, and a
  prompt that reaches it. Start here if you just want to use them.
- **[FINDINGS.md](FINDINGS.md)** — every defect found while testing the skills,
  its cause, and whether it was fixed and re-verified.
- **[BLENDER-5.2-API-NOTES.md](BLENDER-5.2-API-NOTES.md)** — five breaking
  Blender 5.2 API changes found the hard way. Useful to anyone scripting `bpy`
  against 4.x-era documentation; three of the five **fail silently**.
- **[../plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/PORT-NOTES.md](../plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/PORT-NOTES.md)**
  — the full Codex → Claude flag and event-schema mapping.
- **[LICENSE-NOTE.md](LICENSE-NOTE.md)** — who owns what. The skills are Bars'
  under MIT; this fork's additions carry the same terms and the upstream
  copyright line is unchanged.

## Testing summary

Ten of the eleven skills were exercised end to end against Blender 5.2.2 LTS
on Cycles/OptiX. Each test built something real — a crate, a smoke plume, a
rigged figure, a hinged lid — checked it with the skills' own automated
inspectors, then **opened the rendered images**.

**The most useful result: in half the tests, every automated check passed while
the pictures showed real defects.**

The clearest case is the rigged figure. The report was spotless — 21
correctly-named bones, zero unweighted vertices, a clean GLB round-trip, all
gates green, zero issues. Then the arm was bent, and the elbow **tore open**,
the feet came **detached** with the shin passing through them, and the
shoulders and hips had never been joined at all. The root cause is named
verbatim in the skill's own reference: *"A mesh joined into one Blender object
is not necessarily continuous geometry."*

That is what this package is for. It does not just automate Blender; it insists
on looking at the result and tells you where to look.

| # | Skill | Result |
| --- | --- | --- |
| 01 | modeling | works — 8,328-triangle crate from one script |
| 02 | asset-validation | works — pinned 832 bad faces to a named object and 3D coordinates |
| 03 | rendering | works — auto-selected the GPU, 6 evidence views in 7.8 s |
| 04 | simulation | works — gas bake in 16 s, caught the plume hitting the domain ceiling |
| 05 | procedural | works — 44 → 248 instances on one parameter, exposed an unenforced invariant |
| 06 | character | works — caught a torn rig every metric called clean |
| 07 | animation | works — connector attachment verified to 0.0000 mm |
| 08 | iterative-refinement | works — full freeze → critique → repair → rollback decision |
| 09 | art-direction-intake | works — asked *nothing* on a clear brief, two questions on a vague one |
| 10 | mcp-integration | works — audited a live setup and found a preferred component missing |
| 11 | agent-benchmark | original needs the `codex` CLI; **ported**, 35 unit tests + a validated live run |

## Evidence

`highlights/` holds twenty images as labelled before/after pairs:

| Pair | What it shows |
| --- | --- |
| `01-crate-six-view-*-visual-fixes` | Nail heads invisible, gap under the lid, posts hidden → all fixed |
| `02-bracket-*` | Wood grain rendering *through* metal → solid hardware |
| `03-wood-*` | An over-correction: too orange, then calibrated back |
| `04-elbow-*` | The torn elbow → one continuous surface |
| `05-foot-*` | Detached foot with the shin through it → attached |
| `06-smoke-*` | Plume flattened against an invisible domain ceiling → clear |
| `07-hinge-*` | Lid pivoting beside hardware it was never attached to → real strap hinge |
| `08-bracket-chrome-*` | Hardware reading as polished chrome → cast iron |
| `09-scatter-*` | 44 instances placed procedurally, and 248 showing a rule break down |
| `10-concept-lantern` | An art-direction reference generated before modelling |
| `11-crate-six-view-FINAL-after-bracket-fix` | The crate as it actually ends up, brackets standing proud |

Pair `01` is the crate **part-way through** — after the first round of visual
fixes, before the corner brackets were rebuilt. `02-bracket-*` is that rebuild
and `11` is the finished state, so read 01 → 02 → 11.

## Honest limits

- **The rigged figure is a mannequin** — no clothing, face or fingers. That was
  the declared scope, so the clothed-humanoid checks in the skill's own review
  guide are unmet by design.
- **The animation's timing was never verified.** The skill requires watching
  the finished action at normal speed, and an agent cannot watch video
  playback. That check belongs to a human.
- **The A/B benchmark has not been run.** The ported harness can run it, but
  the mcp-integration audit only covers one condition. "Nothing was blocked
  without it" is not the same as "it does not help."
- **Three skills cannot be re-measured through the geometry tools at all** —
  iterative-refinement produced a review record, art-direction-intake a concept
  image, mcp-integration an audit. The other eight were re-measured and the two
  paths agree; see [FINDINGS.md](FINDINGS.md) §12, which also records the three
  places where archived metrics had fallen a stage behind their artifact.
- **Raw artifacts are not in this repo** — logs, metrics JSON, `.blend`/`.glb`
  files and the video were left out deliberately, both for size and because
  machine-generated output carried absolute local paths.

## Credit

Skills, MCP server, scoring harness and references: **Bars**
([@ifBars](https://github.com/ifBars)) — MIT. The root `LICENSE` is upstream's,
unmodified, and everything this fork adds carries the same terms.

[LICENSE-NOTE.md](LICENSE-NOTE.md) sets out the split in full, alongside
`LICENSE` and `THIRD_PARTY_NOTICES.md` at the repository root.
