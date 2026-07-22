"""Build Surfscape's articulated surfer asset with Blender.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-surfer-model.py
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "public" / "models" / "surfer-premium.glb"
PREVIEW_PATH = Path("/tmp/surfscape-surfer-preview.png")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
    specular: float = 0.45,
    clearcoat: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Specular"].default_value = specular
    if "Clearcoat" in shader.inputs:
        shader.inputs["Clearcoat"].default_value = clearcoat
    return mat


def empty(name: str, parent: bpy.types.Object | None, location: tuple[float, float, float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.055
    if parent:
        obj.parent = parent
    obj.location = location
    return obj


def smooth(obj: bpy.types.Object, bevel: float = 0.0) -> None:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Micro bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2


def ellipsoid(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    segments: int = 28,
    rings: int = 18,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def torus(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    major: float,
    minor: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=32,
        minor_segments=10,
        location=(0, 0, 0),
        major_radius=major,
        minor_radius=minor,
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def cube(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.03,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
    smooth(obj, bevel)
    return obj


def build_surfer() -> bpy.types.Object:
    wetsuit = material("Wetsuit neoprene", (0.012, 0.025, 0.032, 1), 0.66, specular=0.48)
    panel = material("Wetsuit ocean panels", (0.014, 0.095, 0.105, 1), 0.61, specular=0.5)
    seam = material("Heat welded seams", (0.11, 0.56, 0.55, 1), 0.38, specular=0.52)
    skin = material("Sun warmed skin", (0.48, 0.235, 0.13, 1), 0.67, specular=0.32)
    skin_light = material("Skin highlights", (0.62, 0.34, 0.21, 1), 0.65, specular=0.32)
    hair = material("Wet dark hair", (0.012, 0.008, 0.006, 1), 0.42, specular=0.52)
    eye_white = material("Eyes", (0.92, 0.88, 0.8, 1), 0.32, specular=0.5)
    iris = material("Iris", (0.025, 0.08, 0.07, 1), 0.3, specular=0.68)
    mouth = material("Mouth", (0.23, 0.055, 0.04, 1), 0.68, specular=0.25)
    boot = material("Reef boot", (0.018, 0.021, 0.023, 1), 0.72, specular=0.38)

    rig = empty("SurferRig", None, (0, 0, 0))
    pelvis = empty("Pelvis", rig, (0, 0, 0))
    torso = empty("Torso", pelvis, (0, 0, 0.19))
    head = empty("Head", torso, (0, 0, 0.73))
    upper_arm_l = empty("UpperArm.L", torso, (-0.36, 0, 0.52))
    lower_arm_l = empty("LowerArm.L", upper_arm_l, (0, 0, -0.49))
    hand_l = empty("Hand.L", lower_arm_l, (0, 0, -0.43))
    upper_arm_r = empty("UpperArm.R", torso, (0.36, 0, 0.52))
    lower_arm_r = empty("LowerArm.R", upper_arm_r, (0, 0, -0.49))
    hand_r = empty("Hand.R", lower_arm_r, (0, 0, -0.43))
    upper_leg_l = empty("UpperLeg.L", pelvis, (-0.16, 0, -0.09))
    lower_leg_l = empty("LowerLeg.L", upper_leg_l, (0, 0, -0.58))
    foot_l = empty("Foot.L", lower_leg_l, (0, 0, -0.53))
    upper_leg_r = empty("UpperLeg.R", pelvis, (0.16, 0, -0.09))
    lower_leg_r = empty("LowerLeg.R", upper_leg_r, (0, 0, -0.58))
    foot_r = empty("Foot.R", lower_leg_r, (0, 0, -0.53))

    # Core anatomy and fitted wetsuit shell.
    ellipsoid("Pelvis.mesh", pelvis, (0, 0, 0), (0.27, 0.2, 0.22), wetsuit)
    ellipsoid("Torso.mesh", torso, (0, 0.015, 0.33), (0.34, 0.22, 0.45), wetsuit)
    ellipsoid("Chest.panel", torso, (0, -0.205, 0.36), (0.215, 0.022, 0.285), panel, 30, 18)
    ellipsoid("Back.panel", torso, (0, 0.205, 0.32), (0.19, 0.018, 0.245), panel, 28, 16)
    torus("Collar.seam", torso, (0, 0, 0.69), 0.15, 0.018, seam)
    torus("Waist.seam", torso, (0, 0, 0.02), 0.245, 0.012, seam)
    ellipsoid("Chest.mark", torso, (0, -0.244, 0.39), (0.055, 0.009, 0.085), seam, 18, 10)

    # Head, facial structure, and wet hair silhouette.
    ellipsoid("Neck.mesh", head, (0, 0, -0.05), (0.105, 0.11, 0.17), skin)
    ellipsoid("Head.mesh", head, (0, -0.005, 0.22), (0.145, 0.15, 0.198), skin_light, 36, 24)
    ellipsoid("Nose", head, (0, -0.154, 0.215), (0.026, 0.034, 0.05), skin_light, 18, 12)
    for side, x in (("L", -0.064), ("R", 0.064)):
        ellipsoid(f"EyeWhite.{side}", head, (x, -0.145, 0.275), (0.025, 0.012, 0.017), eye_white, 18, 12)
        ellipsoid(f"Iris.{side}", head, (x, -0.157, 0.274), (0.008, 0.006, 0.009), iris, 14, 10)
        ellipsoid(f"Brow.{side}", head, (x, -0.161, 0.315), (0.046, 0.009, 0.009), hair, 16, 8)
        ellipsoid(f"Ear.{side}", head, ((-0.158 if side == "L" else 0.158), 0, 0.225), (0.025, 0.034, 0.055), skin, 16, 10)
    ellipsoid("Mouth", head, (0, -0.153, 0.15), (0.041, 0.009, 0.01), mouth, 18, 8)
    ellipsoid("Hair.cap", head, (0, 0.018, 0.365), (0.151, 0.157, 0.098), hair, 34, 18)
    for index, x in enumerate((-0.13, -0.085, -0.035, 0.02, 0.075, 0.13)):
        ellipsoid(f"Hair.lock.{index}", head, (x, -0.13 + abs(x) * 0.3, 0.385 - abs(x) * 0.35), (0.033, 0.03, 0.07), hair, 16, 10)

    # Articulated arms with shoulder and elbow definition.
    for side, upper, lower, hand, sign in (
        ("L", upper_arm_l, lower_arm_l, hand_l, -1),
        ("R", upper_arm_r, lower_arm_r, hand_r, 1),
    ):
        ellipsoid(f"Shoulder.{side}", upper, (0, 0, -0.035), (0.118, 0.112, 0.13), wetsuit)
        ellipsoid(f"UpperArm.mesh.{side}", upper, (0, 0, -0.25), (0.105, 0.097, 0.285), wetsuit)
        ellipsoid(f"Arm.panel.{side}", upper, (sign * 0.075, -0.035, -0.25), (0.022, 0.055, 0.17), panel, 20, 12)
        ellipsoid(f"Elbow.{side}", lower, (0, 0, 0), (0.105, 0.1, 0.11), wetsuit)
        ellipsoid(f"LowerArm.mesh.{side}", lower, (0, 0, -0.225), (0.09, 0.085, 0.25), wetsuit)
        ellipsoid(f"Hand.mesh.{side}", hand, (0, -0.015, -0.055), (0.085, 0.055, 0.13), skin, 24, 14)
        for finger in range(3):
            ellipsoid(
                f"Finger.{side}.{finger}",
                hand,
                ((finger - 1) * 0.035, -0.045, -0.15),
                (0.018, 0.024, 0.07),
                skin,
                14,
                8,
            )

    # Articulated legs, knees, ankles, and grippy surf booties.
    for side, upper, lower, foot in (
        ("L", upper_leg_l, lower_leg_l, foot_l),
        ("R", upper_leg_r, lower_leg_r, foot_r),
    ):
        ellipsoid(f"Thigh.mesh.{side}", upper, (0, 0, -0.31), (0.155, 0.175, 0.35), wetsuit)
        ellipsoid(f"Thigh.panel.{side}", upper, (0, -0.145, -0.31), (0.065, 0.022, 0.215), panel, 22, 14)
        ellipsoid(f"Knee.{side}", lower, (0, -0.015, 0), (0.14, 0.15, 0.14), wetsuit)
        ellipsoid(f"Shin.mesh.{side}", lower, (0, 0.015, -0.28), (0.115, 0.125, 0.31), wetsuit)
        ellipsoid(f"Ankle.{side}", foot, (0, 0, 0), (0.105, 0.105, 0.12), boot)
        ellipsoid(f"Foot.mesh.{side}", foot, (0, -0.115, -0.075), (0.12, 0.235, 0.09), boot, 28, 16)
        cube(f"Foot.grip.{side}", foot, (0, -0.13, -0.155), (0.105, 0.19, 0.018), seam, 0.012)

    return rig


def merge_joint_meshes(root: bpy.types.Object) -> None:
    """Collapse each rigid joint's decorative meshes while preserving articulation."""
    joints = [root, *[obj for obj in root.children_recursive if obj.type == "EMPTY"]]
    for joint in joints:
        meshes = [child for child in joint.children if child.type == "MESH"]
        if len(meshes) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for mesh in meshes:
            mesh.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        merged = bpy.context.object
        merged.name = f"{joint.name}.render"


def setup_preview(model: bpy.types.Object) -> None:
    ground_mat = material("Preview ground", (0.025, 0.035, 0.04, 1), 0.88)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, -1.18))
    ground = bpy.context.object
    ground.data.materials.append(ground_mat)

    bpy.ops.object.light_add(type="AREA", location=(3.5, -4.5, 6.5))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 4.5
    key.data.color = (0.78, 0.94, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(-4, -1.5, 3.2))
    fill = bpy.context.object
    fill.data.energy = 620
    fill.data.size = 3.2
    fill.data.color = (1.0, 0.55, 0.36)

    bpy.ops.object.light_add(type="AREA", location=(0, 4, 4.8))
    rim = bpy.context.object
    rim.data.energy = 780
    rim.data.size = 3
    rim.data.color = (0.35, 0.9, 0.88)

    bpy.ops.object.camera_add(location=(3.3, -5.8, 2.25))
    camera = bpy.context.object
    camera.data.lens = 58
    direction = Vector((0, 0, 0.05)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3
    scene.eevee.gtao_factor = 1.35
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.view_settings.look = "Medium High Contrast"
    scene.world.color = (0.012, 0.02, 0.026)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    reset_scene()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model = build_surfer()
    merge_joint_meshes(model)

    bpy.ops.object.select_all(action="DESELECT")
    model.select_set(True)
    for child in model.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = model
    bpy.ops.export_scene.gltf(
        filepath=str(MODEL_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )

    setup_preview(model)
    print(f"SURFSCAPE_MODEL={MODEL_PATH}")
    print(f"SURFSCAPE_PREVIEW={PREVIEW_PATH}")


if __name__ == "__main__":
    main()
