# The skills, and what to say to reach them

Twelve skills: Bars' eleven, plus the Claude CLI port of the benchmark
harness. Each entry gives what the skill does and a prompt that reaches it.

The skills are **model-invoked** — Claude matches your request against each
description, so plain English is enough. You do not name a skill. The root
[`SKILL.md`](../SKILL.md) also acts as a router when the right specialist is not
obvious: *"use Blender Agent Studio to build me a crate"* picks the workflow set
for you.

Each skill's `references/` holds its deeper guidance and each `scripts/` holds
runnable Python and TypeScript; Claude reads those as it goes. Install routes are
in [INSTALL.md](INSTALL.md); what testing found is in [FINDINGS.md](FINDINGS.md).

---

### 1. `blender-art-direction-intake`

Clarifies a vague brief before any modeling starts, and can generate a concept
mockup image first. Covers art style, subject, scale, target platform, shot
framing, materials, and reference direction.

> "I want a stylized sci-fi supply crate for a game. Ask me whatever you need
> before you start modeling."

### 2. `blender-modeling-workflow`

The main event: builds or substantially refines reproducible models through
Python and the Blender CLI — props, hard-surface assets, stylized objects,
assemblies, game-ready GLB exports. Iterates from visual feedback.

> "Model a game-ready wooden barrel under 3k triangles and export it as GLB."

### 3. `blender-procedural-workflow`

Geometry Nodes, modifiers, instancing, and procedural environments —
scattering, terrain, architecture, parametric generators, non-destructive
variation.

> "Build a Geometry Nodes setup that scatters rocks and grass across this
> terrain, driven by a density map I can tune."

### 4. `blender-rendering-workflow`

Stills, turntables, sequences, and animation renders with reproducible
lighting, camera, colour management, compositor, and output settings. Also
render passes, denoising, and look development.

> "Light and render a 3/4 hero still of the barrel on a neutral backdrop, then
> give me a 360° turntable."

### 5. `blender-simulation-workflow`

Deterministic physics: fluid, smoke, fire, rigid bodies, cloth, soft bodies,
particles, and hair — including collision setup, cache baking, and validating
the bake before you render it.

> "Set up and bake a smoke plume rising from this chimney, then render 60
> frames."

### 6. `blender-character-workflow`

Characters, creatures, and avatars: mesh repair, armatures, skinning weights,
IK/FK, blend shapes, facial rigs, and humanoid/VRM/game export — with
deformation and runtime validation.

> "Rig this humanoid mesh with an IK/FK armature and check the elbow and knee
> deformation at extreme poses."

This is the skill whose automated report came back spotless while the render
showed a torn elbow and detached feet. Ask for the pose renders and look at
them; see [FINDINGS.md](FINDINGS.md).

### 7. `blender-animation-workflow`

Motion for articulated props and mechanical assemblies: timing, pivots,
physical connections, critical poses, trajectories, visibility states, and
exported GLB actions.

> "Animate this door hinge opening over 48 frames and export the action to GLB."

### 8. `blender-asset-validation`

Inspects and validates what you actually produced — `.blend`, `.glb`, `.gltf`,
`.fbx`, `.obj`. Evaluated triangle/material/hierarchy metrics, topology and
export review, standardized multiview renders, fresh-import verification.

> "Validate `out/barrel.glb` — triangle count, materials, hierarchy, and give me
> multiview renders as evidence."

### 9. `blender-iterative-refinement`

An opt-in second pass on a *finished* deliverable: critique it, repair the
highest-impact defect, and prove nothing else regressed. Opt-in by design, so
it does not slow down normal work.

> "Critique the barrel you just made, fix the single worst problem, and show me
> before/after proof nothing regressed."

### 10. `blender-mcp-integration`

Choosing, configuring, and troubleshooting Blender MCP for live scene control
versus deterministic offline evaluation — including whether MCP is earning its
keep for a given task.

> "My Blender MCP connection keeps dropping mid-task — diagnose it, and tell me
> whether MCP is even helping here or if the CLI path is better."

### 11. `blender-agent-benchmark`

Paired isolated runs to test whether a change actually helps: baseline against
skills, regression suites, prompt comparison, MCP usefulness, score
calibration.

> "Benchmark the modeling workflow with and without these skills across 5 tasks
> and score the difference."

**This one drives the `codex` CLI** and pins OpenAI model profiles. Use it if
you are benchmarking Codex. Under Claude Code, use the port below instead.

### 12. `blender-agent-benchmark-claude` — added by this fork

The same paired-condition protocol driven by `claude` instead of `codex`. Same
tasks, prompts and scoring; the CLI driver and event parsing are rewritten.
Compare conditions on `execution.totalCostUsd`, never `totalTokens` — the
latter excludes cache read/write and understated a validated run by 257x.

> "Run the smoke benchmark suite baseline against skills on Sonnet and report
> the delta."

Flag and event-schema mapping:
[PORT-NOTES.md](../plugins/blender-agent-studio/skills/blender-agent-benchmark-claude/PORT-NOTES.md).

---

## The MCP server

Installing as a plugin brings up the plugin's own MCP server and its twelve
`blender_*` tools, which the skills prefer over the CLI:

| Tool | |
| --- | --- |
| `blender_version`, `blender_describe_scene`, `blender_inspect_asset` | inspection |
| `blender_diagnose_topology`, `blender_quality_report`, `blender_compare_scenes` | analysis |
| `blender_render_scene`, `blender_render_evidence` | rendering |
| `blender_compare_reference`, `blender_fit_reference_camera` | reference matching |
| `blender_search_polyhaven_assets`, `blender_download_polyhaven_asset` | assets |

The findings in [FINDINGS.md](FINDINGS.md) §01–11 were measured on the CLI
fallback, before the server was installed. §12 re-ran the crate through the MCP
tools and **the two paths agree exactly** — 33 of 33 scene totals and zero
mismatches across 770 per-mesh field comparisons. Nothing in the ledger needed
revising. Prefer the MCP tools: `blender_render_evidence` returns the contact
sheet inline, so a render cannot be reported without being looked at.

### The three Rust-backed tools need a built runtime

`blender_describe_scene`, `blender_quality_report` and `blender_compare_scenes`
have no CLI equivalent and fail loudly — never silently — until the runtime is
built. Build it from the plugin root:

```bash
cargo +stable-x86_64-pc-windows-gnu build --release --locked --manifest-path runtime/Cargo.toml
```

On Windows, use the **GNU** toolchain as shown. `bun run setup:runtime` calls
plain `cargo build`, which selects MSVC and fails on
`linker link.exe not found` unless Visual C++ build tools are installed; the GNU
toolchain brings its own linker and builds in about 13 seconds.

What these three add is a refusal to overclaim. Every response carries a
`not_measured` list and an `agent_review_required` list, and a declared contact
pair comes back `contact_unverified` with `evidence: world_aabb_only` rather
than "pass", because overlapping bounding boxes do not prove that two surfaces
touch. The gates do fire: a 5,000-triangle budget against the 8,328-triangle
crate returns `status: constraints_failed`.

One trap worth knowing: `compare_scenes` applies `maxCenterShift`,
`maxDimensionChange` and `forbidNewTopologyFindings` to every matched object
when `invariantObjects` is empty — including Empties, which have no bounds or
mesh. That yields `constraints_failed` on an unevaluable gate, which reads like
a regression and is not one. Scope `invariantObjects` to mesh objects.

## Prerequisites

Set `BLENDER_EXECUTABLE` to a Blender 5.2+ binary — 28 references across the
skills read it and none assumes a path:

```bash
setx BLENDER_EXECUTABLE "C:\path\to\Blender\blender.exe"
```

Already-running programs keep their inherited copy, so restart after changing
it. Bun is needed for the benchmark and helper scripts, and `bun install` in
`plugins/blender-agent-studio` is needed before `bun run test` — without it
eight test files fail on a missing `@modelcontextprotocol/sdk` and the failures
look like broken code rather than a missing dependency.
