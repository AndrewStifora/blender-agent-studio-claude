# Blender 5.2 API changes found during testing

Five breaking changes hit while scripting against Blender 5.2.2. Each one is
recorded with the exact error and the working replacement, because three of the
five **fail silently or misleadingly** — they do not look like API problems.

Useful beyond this test: any `bpy` script written against Blender 4.x
documentation will hit these.

---

## 1 · `scene.render.engine` under-reports via RNA

**Symptom:** the script renders in EEVEE while reporting success.

RNA lists only the built-in engine, because engines registered by add-ons are
not enum items:

```python
[i.identifier for i in scene.render.bl_rna.properties['engine'].enum_items]
# -> ['BLENDER_EEVEE']        ... on a build where Cycles is enabled and works
```

Yet direct assignment succeeds:

```python
scene.render.engine = 'CYCLES'   # -> OK
```

**The trap:** a "defensive" membership check before assigning silently skips the
value you want. This cost a whole render pass — caught only because the
manifest printed `engine: BLENDER_EEVEE`.

**Do:** assign directly inside `try/except TypeError`. Never gate an engine
assignment on a membership test.

---

## 2 · Geometry Nodes modifier inputs are no longer ID properties

**Symptom:**

```
TypeError: bpy_struct[key] = val: id properties not supported for this type
```

The Blender 4.x idiom is gone:

```python
mod[socket_id] = value            # 4.x — raises on 5.2
```

**Do:**

```python
getattr(mod.properties.inputs, socket_id).value = value
```

Socket ids are `Socket_0`, `Socket_1`, … taken from
`node_group.interface.new_socket(...).identifier`. The path is four levels deep
(`properties` → `GeometryNodesModifierInterface` → `.inputs` → per-socket
struct → `.value`) and took four probes to find.

---

## 3 · You cannot hide a Geometry Nodes source with any visibility flag

Not an API change as such, but the highest-cost trap found. GN instances
**inherit the source object's render visibility**, so every flag-based approach
fails — two of them without any error:

| Method | Instances | Render |
| --- | --- | --- |
| `collection.hide_viewport = True` | **0** | — |
| `collection.hide_render = True` | 3,124 | **empty** |
| `object.hide_render = True` | 3,124 | **empty** |
| `object.visible_camera = False` | 3,124 | translucent ghosts |
| `collection.instance_offset` | 3,124 | **correct** |

**Do:** park the source objects far out of frame and set
`collection.instance_offset` to the same offset, so `CollectionInfo`
re-centres the instanced geometry. Touch no visibility flags.

Each case above was rendered during testing to confirm it; the table is the
conclusion, not a guess.

---

## 4 · `Action.fcurves` is gone — slotted, layered actions

**Symptom:**

```
AttributeError: 'Action' object has no attribute 'fcurves'
```

Blender 4.4+ replaced the flat list. **Do:**

```python
ad  = obj.animation_data
act = ad.action
cb  = act.layers[0].strips[0].channelbag(ad.action_slot)
fcurves = cb.fcurves
```

A version-tolerant accessor is in
`07-animation/source/lid_animation.py` (`action_fcurves`).

---

## 5 · Video output is gated behind `image_settings.media_type`

**Symptom:**

```
TypeError: enum "FFMPEG" not found in ('AVIF','JPEG','OPEN_EXR','PNG', ...)
```

Misleading — it reads as if FFMPEG support is missing. The `file_format` enum
lists only *image* codecs until the media type is switched:

```python
scene.render.image_settings.media_type  = 'VIDEO'    # must come first
scene.render.image_settings.file_format = 'FFMPEG'
```

`media_type` accepts `IMAGE`, `MULTI_LAYER_IMAGE`, `VIDEO`.

---

## Two non-API gotchas from the same session

**glTF export does not preserve the scene frame range.** Authored 1–48 and
1–50 both came back as **1–250** on re-import. Confirmed three times. Always
re-check the range after import, and verify an exported animation
*functionally* — import it and measure a moving part — rather than counting
actions.

**The Skin modifier leaves edgeless stray vertices.** They are invisible in
renders but count as separate mesh shells and ship in the export. Delete loose
vertices after applying it. Subdivision also insets the surface enough to lose
~4–6% of height, so enlarge extremities locally rather than rescaling, which
would unbind a rig.

---

## And one PowerShell trap, for completeness

A copy script written during this work silently failed on 121 of 167 files on
its first run. Cause: **PowerShell variable names are case-insensitive**, so

```powershell
$T = "C:\long\scratchpad\path"
foreach ($t in @("a","b","c")) { ... }   # $t IS $T
```

The loop overwrote the root path, and every subsequent path became relative and
"missing". Renaming the loop variable fixed it. Worth knowing before trusting a
copy script's success count.
