# Findings ledger

Every defect found during testing, what caused it, and whether it was fixed
and re-verified. "Caught by" distinguishes findings that automated measurement
surfaced from ones only visible in a render.

---

## 01–03 · Crate (modeling, validation, rendering)

| Defect | Cause | Caught by | Outcome |
| --- | --- | --- | --- |
| 832 degenerate faces, 568 zero-length edges | Bevel width 3.5 mm equalled the nail height, collapsing faces | **metrics** | Fixed — bevel clamped to 20% of each part's thinnest dimension. Both → 0, triangles unchanged |
| Nail heads invisible from every exterior view | Placed on the planks' *inner* face | **render** | Fixed — moved to the outer face, proud of the surface |
| ~27 mm open slot under lid and above floor | Side planking spanned only `SIZE − 2×POST`, centred | **render** | Fixed — spans floor-top to lid-underside |
| Corner posts read as flush panels | Planking flush with the post faces | **render** | Fixed — planking recessed 35% of post width |
| Wood grain read as swirling burl veneer | Wave scale 14 + distortion 11 → ~7 cm chaotic swirls | **render** | Fixed — scale 120, distortion 1.8 → ~8 mm grain |
| Lid clipped to pure white | AgX "Punchy" look at +0.55 EV, lights too hot | **render** | Fixed — neutral look at 0 EV, lights cut ~40% |
| Grain direction wrong on posts and lid | Banding along a face's own normal gives no variation across it | **render** | Fixed — one wood variant per band axis, assigned by each part's *middle* dimension |
| Wood over-saturated to orange pine | My own over-correction of the pale-wood fix | **render** | Fixed — blue lifted, red eased, tint saturation back to 1.0 |
| Bracket z-fighting: wood grain rendered *through* the metal | Plates coplanar with the outer faces | **render** | Fixed — three plates per corner standing proud of each face |
| Hardware read as polished chrome | Metallic 1.0 at roughness 0.34 makes a flat plate a near-mirror | **render** | Fixed in skill 08 — noise-driven roughness 0.56–0.68 |

**Still open (cosmetic, documented not fixed):** backdrop plane edge reads as a
hard horizon; hero framing loose; the three bracket plates meet with visible
seams where a real bracket is one folded piece.

---

## 04 · Simulation (smoke)

| Defect | Cause | Caught by | Outcome |
| --- | --- | --- | --- |
| Plume flattened into a hard-edged mushroom cap | Domain only 1.85 m tall; plume hit the ceiling by frame 40 | **render** | Fixed — domain raised to 2.6 m, rebaked to a *new* cache directory |
| Inflow emitter rendering as a solid white disc on the lid | `hide_render` set on the effector proxy but not the emitter | **render** | Fixed — render-only change, no rebake needed |

**Gap in the skill's own guidance:** it says *"set seeds explicitly for
stochastic effects."* A Mantaflow **gas** domain in Blender 5.2 exposes no RNG
seed at all — only `particle_randomness`, which is liquid-only. The instruction
is unsatisfiable for gas; determinism comes from fixed settings plus the cache.
The manifest prints `seed: … via 'None'` rather than claiming a seed was set.

---

## 05 · Procedural (Geometry Nodes scatter)

| Defect | Cause | Caught by | Outcome |
| --- | --- | --- | --- |
| 0 instances, no error anywhere | `hide_viewport` on the source collection removes it from the depsgraph | **metrics** | Fixed |
| 3,124 instances but a completely empty render | `hide_render` removes the source from the *render* depsgraph | **render** | Fixed |
| Instances rendered as translucent ghosts | `visible_camera = False` is inherited by the instances | **render** | Fixed |
| Blown-out centre, black edges | Inherited a light rig sized for a 0.6 m object onto a 9 m field | **render** | Fixed — relit, then halved again |

**The hide-method matrix** is the most instructive result here: four plausible
ways to hide a Geometry Nodes source object, three of which fail, **two of them
silently.** The only method that works is parking the source out of frame and
setting `collection.instance_offset` to compensate. The full table is in
[BLENDER-5.2-API-NOTES.md](BLENDER-5.2-API-NOTES.md#3--you-cannot-hide-a-geometry-nodes-source-with-any-visibility-flag).

**Real defect left in place, by report:** the generator declares a non-overlap
invariant it does not enforce. `Min Distance` spaces *points* and knows nothing
about instance footprint or scale. At the 0.75 m default, diagonal neighbours
already interpenetrate; at 0.35 m you get the pile in
`highlights/09-scatter-248-crates-overlap.png`. Guaranteeing it needs
`Min Distance ≥ Scale Max × diagonal` ≈ 0.99 m — which would remove the ability
to make dense piles deliberately, so it is documented rather than silently
clamped.

**Measured instancing cost** — the number the skill asks you to produce:

| Config | Instances | Realised triangles |
| --- | --- | --- |
| default (1.2/m²) | 3,124 (44 crates) | 0 |
| minimum (0.15/m²) | 781 (11 crates) | 0 |
| maximum (8.0/m², 0.35 m) | 17,608 (248 crates) | 0 |
| **Realize = true** | **0** | **366,432** |

44 × 8,328 = 366,432 exactly. Instancing is free; realising is not.

---

## 06 · Character (rigged figure)

**Every automated check passed.** 21 semantically-named bones, 21 vertex groups,
zero unweighted vertices, max 5 influences, clean GLB round-trip,
`hard_gate_pass: True`, `issues: []`.

| Defect | Caught by | Outcome |
| --- | --- | --- |
| Elbow tore open at extreme bend | **render** | Fixed |
| Feet detached, shin passing through them | **render** | Fixed |
| Shoulders and hips never continuous; no crotch geometry | **render** | Fixed |
| Torso a straight-sided slab | **render** | Improved |

**Single root cause, named verbatim in the skill's own reference before I built
anything:** *"A mesh joined into one Blender object is not necessarily
continuous geometry. Overlapping capped leg tubes and a separate pelvis are not
a finished trouser crotch."* The body was nine capped tubes plus a sphere,
`join`ed into one object. Automatic weights bound each tube to its nearest bones
and the tubes slid apart under rotation.

**Fix:** rebuilt as an edge skeleton driven through the Skin modifier plus one
Subdivision level, which generates a single branching surface.

| Measure | Before | After |
| --- | --- | --- |
| Separate shells | 10 | **1** |
| Mean bone influences | 1.65 | **2.00** |

The influence count rising is the quantitative signature: vertices now sit in
shared loops blending between two bones instead of binding rigidly to one.

**Still open:** height 1.673 m against a 1.75 m contract (−4.4%); limbs
spindly; feet are rounded flippers; self-intersection at one pose from IK
target placement.

---

## 07 · Animation (hinged lid)

| Defect | Cause | Caught by | Outcome |
| --- | --- | --- | --- |
| Lid driven 15.8 mm through a rigid rail | An "anticipation" phase authored at +1.5°. Over a 0.604 m lever that is real interpenetration, not anticipation | **metrics** | Fixed — a rigid lid on a rigid box has nothing to compress, so the phase became a held beat at 0° |
| Hinge hardware decorative, not connective | Built knuckles fixed to the carcase but never the leaves on the lid | **render** | Fixed — full strap hinge: knuckle, lid leaf, rear-face leaf |

**A measurement that was useless and got replaced.** An AABB gap test reads
−9 to −34 mm at every frame, because a lid hinged on the rear top edge
*necessarily* overlaps the rear posts. It cannot distinguish hinge adjacency
from the lid sinking through its seat. Replaced with lowest-lid-vertex versus
rail-top height, which can.

**Invariants, both to a 6.08 mm tolerance (1% of extent):**

- Connector endpoint residual: **0.0000 mm** at all seven critical frames.
- Hinge leaf axis deviation: **0.00006 mm** max. A rigidly hung leaf keeps a
  *constant* distance from the hinge axis, so asserting deviation from the
  seated value proves the parenting rather than eyeballing it.

**Export verified functionally, not structurally.** Lid top measured on
re-import: 0.3000 / 0.7228 / 0.8758 against authored 0.3000 / 0.7243 / 0.8768 —
within 1.5 mm, float quantisation.

**Never verified:** timing, speed and rebound feel. The skill is explicit that a
frame strip cannot substitute for watching playback, and an agent cannot watch
video. That check belongs to a human.

---

## 08 · Iterative refinement

A complete protocol run, not a spot check. Candidate frozen to its own folder,
eight requirements given a pass/fail/unclear verdict citing specific views
**before** any editing, one priority-ranked defect repaired in durable source,
recheck with byte-identical cameras and settings.

**Decision: `retain_repair`.** C4 (hardware reads as iron) moved fail → pass;
nothing else regressed.

The rigour came from hashing the sorted object-name list —
`ae89d428a995b76f` on both sides — which proves nothing was added, removed or
renamed without diffing files. Dimensions, materials, engine, view transform
and exposure all value-identical.

Two things the protocol forced that would otherwise have been skipped: ranking
all eight requirements first (which established that the chrome brackets
outranked the loose framing), and **refusing** to fix the framing, because
moving the camera would invalidate the regression comparison.

---

## 09 · Art direction intake

Tested on two briefs, because this skill's distinctive instruction is
*restraint*: "a missing field does not by itself require a question."

- **Actionable brief** (the real crate request): **0 questions, 0 concept
  offer.** Eleven decisions resolved, seven as labelled assumptions. Matches
  what actually happened — the crate was built without asking anything.
- **Vague brief** ("make me a lantern"): **two** questions, not six. Era/genre
  and runtime-vs-beauty-shot have no reasonable default and force a rebuild if
  guessed. Scale, axis and view set were defaulted instead.

The concept image was generated, but **not** through the configured tool —
`mcp__gemini__gemini_generate_image` cannot be invoked in this harness because
its schema declares an old JSON Schema dialect. Worked around by calling the
same model over REST with the API key already in the environment.

---

## 10 · MCP integration

The only test that produced a finding about **the setup** rather than about the
work. The skill ranks the layers explicitly; audited against what is installed:

| Skill rank | Layer | Here |
| --- | --- | --- |
| **1 — "use by default with Blender 5.1+"** | Blender Lab MCP (official) | **not installed** |
| 2 | Blender Agent Studio MCP | not ported (broken relative path) |
| 3 — "consider only when…" | `ahujasid/blender-mcp` | **the only one registered** |

Running exclusively on the tier ranked *last*, while the default-for-5.1+
choice is absent — on Blender 5.2.2, which is inside that band. The tier-3 gate
is "only when you need Poly Haven / Sketchfab / external generation," and those
API keys were never entered, so the capability justifying the extra surface is
unused.

Telemetry is correctly off: `DISABLE_TELEMETRY=true` plus a declined consent file.

---

## 11 · Agent benchmark — blocked

Its automated harness spawns the OpenAI `codex` CLI and hardcodes OpenAI model
names (`gpt-6-astra`, `gpt-5.6-sol`). `codex` is not installed. The methodology
and scoring references are readable and the scoring scripts are agent-agnostic,
but the harness cannot run here.

---

## 12 · Re-verification on the MCP path (2026-09-19)

Everything above was measured through each skill's **CLI fallback**, because the
original install shipped no MCP server. After installing the plugin properly the
server's twelve `blender_*` tools came up, so the crate was rebuilt from
`01-modeling/source/create_crate.py` and measured again through them.

**The two measurement paths agree exactly.** 33 of 33 scene totals identical,
and zero mismatches across 770 per-mesh field comparisons (70 meshes × 11
fields). Same Blender build both times, `d13f752e3b9c`. Nothing above needs
revising on account of the tool change.

Four things the re-run did establish:

| Finding | Detail |
| --- | --- |
| **`six-view-final/` was not final** | Its renders predated the bracket fix. Caught by `bounds` in the manifest: 0.600 m against the metrics' 0.608 m — exactly the 2 × 4 mm of bracket standing proud. Re-rendered; the superseded set is kept as `six-view-after-visual-fixes/` |
| **GLB export splits meshes** | One bracket plate: 8 vertices, 1 component, 0 non-manifold edges in `.blend` → 138 vertices, 9 components, 174 non-manifold edges in `.glb`. Triangles unchanged |
| **The build is not bit-reproducible** | Same-size GLB, ~53 bytes differing — float LSB drift. `compare_scenes` reports 71/71 unchanged, `triangle_delta: 0` |
| **The Rust runtime needs the GNU toolchain** | `bun run setup:runtime` uses plain `cargo build`, picks MSVC, and fails with `linker link.exe not found` |

### The non-manifold count was never a defect

`metrics-04` reports **11,732 non-manifold edges** scene-wide, which reads
alarmingly. It is an artifact of inspecting the GLB. The same inspector on the
`.blend` reports **zero**. Vertex splitting for flat normals turns every face
into its own shell on export; the model is sound. Read topology from the
`.blend`, and treat the GLB's counts as a property of the export.

### What the Rust-backed tools add

They are the three with no CLI equivalent, and what they contribute is
*refusal to overclaim*. Every response carries a `not_measured` list —
triangle-level intersections, surface contact, symmetry, silhouette similarity,
aesthetic quality — and an `agent_review_required` list of questions only a
human or a look at the renders can answer. Declared contact pairs come back
`contact_unverified` with `evidence: world_aabb_only` rather than "pass",
because overlapping bounding boxes do not prove two surfaces touch.

The constraint gates do fire. A triangle budget of 5,000 against the crate's
8,328 returns `status: constraints_failed` with
`{code: triangle_budget, actual: 8328, maximum: 5000}`.

**One trap.** `maxCenterShift`, `maxDimensionChange` and
`forbidNewTopologyFindings` apply to every matched object when
`invariantObjects` is left empty — including Empties such as `Crate_Root`,
which have no bounds or mesh. The gate then reports
`invariant_bounds_unavailable` and `constraints_failed`, which looks like a
regression and is not one. Scope `invariantObjects` to mesh objects; the same
comparison then returns `regression.count: 0`.

That failure mode is the right one to have — it refuses to report a pass for a
gate it could not evaluate. It just needs reading carefully, which is the theme
of this whole ledger.

