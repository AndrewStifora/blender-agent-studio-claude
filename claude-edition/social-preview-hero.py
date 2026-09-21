"""Render the hero object for the social preview card, on a transparent background.

    blender -b --factory-startup --python-exit-code 1 \
        --python claude-edition/social-preview-hero.py -- \
        --blend <some.blend> --out claude-edition/social-preview-hero.png

Frames whatever meshes the .blend contains by their bounding sphere, so it works
on any subject without hand-tuning the camera. The committed hero is the
validation crate produced by the modeling skill; that .blend is generated output
and is not tracked here, so re-running this needs you to build the crate first.

Blender 5.2 notes that matter for this script:
  - scene.render.engine under-reports via RNA, so CYCLES is assigned directly
    inside try/except TypeError rather than checked against enum_items.
  - Cycles with view transform Standard blows out at these light powers; AgX is
    what the studio skills use.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--samples", type=int, default=160)
ap.add_argument("--res", type=int, nargs=2, default=[1100, 1200])
ap.add_argument("--azimuth", type=float, default=38.0)
ap.add_argument("--elevation", type=float, default=23.0)
args = ap.parse_args(argv)

# bpy resolves relative paths against Blender's cwd, not the project.
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.blend))

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh objects in the .blend")
print("SCENE_MESHES", len(meshes))

# ---------------------------------------------------------------- framing
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for ob in meshes:
    for corner in ob.bound_box:
        p = ob.matrix_world @ Vector(corner)
        lo = Vector((min(lo[i], p[i]) for i in range(3)))
        hi = Vector((max(hi[i], p[i]) for i in range(3)))
center = (lo + hi) / 2.0
size = hi - lo
radius = size.length / 2.0
print("BOUNDS", tuple(round(v, 4) for v in size), "radius", round(radius, 4))

for ob in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
    bpy.data.objects.remove(ob, do_unlink=True)

scene = bpy.context.scene

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("HeroCam")
cam_data.lens = 85.0            # long enough to keep the perspective calm
cam_data.sensor_fit = "HORIZONTAL"
cam_data.sensor_width = 36.0
cam = bpy.data.objects.new("HeroCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

az = math.radians(args.azimuth)
el = math.radians(args.elevation)
direction = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))

aspect = args.res[0] / args.res[1]
half_fov = min(math.atan((cam_data.sensor_width / 2) / cam_data.lens),
               math.atan((cam_data.sensor_width / aspect / 2) / cam_data.lens))
distance = radius / math.sin(half_fov) * 1.16  # >1 leaves air around the subject

target = center + Vector((0, 0, size.z * 0.02))
cam.location = target + direction * distance
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")

# ---------------------------------------------------------------- lighting
def area(name, loc, energy, sz, aim, color=(1.0, 1.0, 1.0)):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = energy
    d.size = sz
    d.shape = "SQUARE"
    d.color = color
    ob = bpy.data.objects.new(name, d)
    ob.location = Vector(loc)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (Vector(aim) - ob.location).to_track_quat("-Z", "Y")
    scene.collection.objects.link(ob)
    return ob


s = max(size)
# Warm key from upper front-left, cool rim from behind-left, so the silhouette
# edge facing the card's text catches the brighter line.
area("Key", center + Vector((-s * 1.5, -s * 1.7, s * 2.1)), 240.0, s * 2.4, center,
     color=(1.0, 0.94, 0.86))
area("Fill", center + Vector((s * 2.4, -s * 1.0, s * 0.4)), 22.0, s * 3.0, center,
     color=(0.78, 0.85, 1.0))
area("Rim", center + Vector((-s * 2.0, s * 2.3, s * 1.5)), 700.0, s * 1.2, center,
     color=(0.84, 0.90, 1.0))

# Grounds the subject without putting a visible floor in frame: with a
# transparent film the catcher writes its shadow into the alpha channel.
bpy.ops.mesh.primitive_plane_add(size=s * 14.0, location=(center.x, center.y, lo.z))
floor = bpy.context.active_object
floor.name = "ShadowCatcher"
floor.is_shadow_catcher = True

world = scene.world or bpy.data.worlds.new("HeroWorld")
scene.world = world
bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
if bg:
    bg.inputs["Color"].default_value = (0.05, 0.055, 0.07, 1.0)
    bg.inputs["Strength"].default_value = 0.55

# ---------------------------------------------------------------- render
try:
    scene.render.engine = "CYCLES"
except TypeError as exc:
    raise SystemExit(f"CYCLES unavailable: {exc}")

scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    scene.cycles.device = "GPU"
except Exception as exc:  # falls back to CPU, still correct
    print("GPU_UNAVAILABLE", exc)

scene.render.resolution_x, scene.render.resolution_y = args.res
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.render.filepath = os.path.abspath(args.out)

bpy.ops.render.render(write_still=True)
print("RENDER_DONE", scene.render.filepath, scene.render.engine, scene.cycles.device)
