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
    subsurface: float = 0.0,
    sheen: float = 0.0,
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
    if "Subsurface" in shader.inputs:
        shader.inputs["Subsurface"].default_value = subsurface
    if "Sheen" in shader.inputs:
        shader.inputs["Sheen"].default_value = sheen
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
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def tapered_form(
    name: str,
    parent: bpy.types.Object,
    rings: list[tuple[float, float, float, float]],
    mat: bpy.types.Material,
    segments: int = 28,
) -> bpy.types.Object:
    """Create an elliptical anatomical form from (z, radius_x, radius_y, y_offset) rings."""
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for z, radius_x, radius_y, y_offset in rings:
        for segment in range(segments):
            angle = math.tau * segment / segments
            vertices.append((math.cos(angle) * radius_x, y_offset + math.sin(angle) * radius_y, z))
    for ring in range(len(rings) - 1):
        start = ring * segments
        next_start = (ring + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((start + segment, start + following, next_start + following, next_start + segment))
    bottom_center = len(vertices)
    vertices.append((0, rings[0][3], rings[0][0]))
    top_center = len(vertices)
    vertices.append((0, rings[-1][3], rings[-1][0]))
    for segment in range(segments):
        following = (segment + 1) % segments
        faces.append((bottom_center, following, segment))
        top = (len(rings) - 1) * segments
        faces.append((top_center, top + segment, top + following))
    mesh = bpy.data.meshes.new(f"{name}.geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mat)
    smooth(obj, 0.008)
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
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj, bevel)
    return obj


def build_surfer() -> bpy.types.Object:
    wetsuit = material("Japanese limestone neoprene", (0.006, 0.012, 0.016, 1), 0.48, specular=0.58, sheen=0.08)
    panel = material("Graphite stretch panels", (0.018, 0.032, 0.037, 1), 0.42, specular=0.62, clearcoat=0.08)
    knee_panel = material("Abrasion knee panels", (0.025, 0.03, 0.032, 1), 0.72, specular=0.34)
    seam = material("Liquid sealed seams", (0.018, 0.15, 0.16, 1), 0.43, specular=0.54)
    skin = material("Sun warmed skin", (0.44, 0.19, 0.088, 1), 0.6, specular=0.34, subsurface=0.055)
    skin_light = material("Face skin", (0.49, 0.225, 0.12, 1), 0.58, specular=0.35, subsurface=0.065)
    skin_shadow = material("Skin shadow", (0.3, 0.1, 0.048, 1), 0.7, specular=0.25)
    hair = material("Wet dark hair", (0.006, 0.004, 0.003, 1), 0.3, specular=0.62, clearcoat=0.12)
    eye_white = material("Natural sclera", (0.72, 0.69, 0.62, 1), 0.27, specular=0.56)
    iris = material("Hazel iris", (0.018, 0.052, 0.035, 1), 0.22, specular=0.72, clearcoat=0.16)
    pupil = material("Pupil", (0.001, 0.001, 0.001, 1), 0.18, specular=0.78)
    mouth = material("Natural lip", (0.29, 0.075, 0.052, 1), 0.56, specular=0.3)
    nail = material("Fingernail", (0.54, 0.28, 0.19, 1), 0.5, specular=0.38)

    rig = empty("SurferRig", None, (0, 0, 0))
    pelvis = empty("Pelvis", rig, (0, 0, 0))
    torso = empty("Torso", pelvis, (0, 0, 0.17))
    head = empty("Head", torso, (0, 0, 0.69))
    head.scale = (0.86, 0.86, 0.86)
    upper_arm_l = empty("UpperArm.L", torso, (-0.325, 0, 0.53))
    lower_arm_l = empty("LowerArm.L", upper_arm_l, (0, 0, -0.47))
    hand_l = empty("Hand.L", lower_arm_l, (0, 0, -0.42))
    upper_arm_r = empty("UpperArm.R", torso, (0.325, 0, 0.53))
    lower_arm_r = empty("LowerArm.R", upper_arm_r, (0, 0, -0.47))
    hand_r = empty("Hand.R", lower_arm_r, (0, 0, -0.42))
    upper_leg_l = empty("UpperLeg.L", pelvis, (-0.145, 0, -0.1))
    lower_leg_l = empty("LowerLeg.L", upper_leg_l, (0, 0, -0.57))
    foot_l = empty("Foot.L", lower_leg_l, (0, 0, -0.52))
    upper_leg_r = empty("UpperLeg.R", pelvis, (0.145, 0, -0.1))
    lower_leg_r = empty("LowerLeg.R", upper_leg_r, (0, 0, -0.57))
    foot_r = empty("Foot.R", lower_leg_r, (0, 0, -0.52))

    # Athletic anatomy under a close-cut technical wetsuit.
    tapered_form(
        "Pelvis.mesh",
        pelvis,
        [(-0.22, 0.215, 0.16, 0.005), (-0.08, 0.255, 0.18, 0), (0.09, 0.265, 0.175, 0), (0.22, 0.225, 0.15, 0)],
        wetsuit,
        30,
    )
    tapered_form(
        "Torso.mesh",
        torso,
        [(-0.08, 0.215, 0.145, 0.01), (0.1, 0.245, 0.165, 0.005), (0.34, 0.3, 0.182, 0), (0.54, 0.335, 0.195, -0.005), (0.67, 0.18, 0.132, 0)],
        wetsuit,
        34,
    )
    ellipsoid("Chest.panel.L", torso, (-0.235, -0.146, 0.36), (0.044, 0.013, 0.22), panel, 24, 14, rotation=(0, 0.12, -0.06))
    ellipsoid("Chest.panel.R", torso, (0.235, -0.146, 0.36), (0.044, 0.013, 0.22), panel, 24, 14, rotation=(0, -0.12, 0.06))
    ellipsoid("Back.flex", torso, (0, 0.175, 0.35), (0.205, 0.018, 0.25), panel, 28, 16)
    torus("Collar.seam", torso, (0, 0, 0.665), 0.137, 0.011, seam)
    torus("Waist.seam", torso, (0, 0, -0.035), 0.222, 0.008, seam)
    cube("Chest.logo", torso, (-0.11, -0.202, 0.49), (0.026, 0.008, 0.026), seam, 0.004, rotation=(0, math.pi / 4, 0))
    cube("Back.zip", torso, (0, 0.191, 0.43), (0.011, 0.008, 0.2), seam, 0.003)

    # Proportional neck and an anatomical face with restrained, game-readable detail.
    tapered_form("Neck.mesh", head, [(-0.17, 0.093, 0.1, 0), (-0.02, 0.105, 0.108, 0), (0.07, 0.11, 0.11, 0)], skin, 26)
    tapered_form(
        "Head.mesh",
        head,
        [(0.0, 0.09, 0.105, -0.004), (0.07, 0.112, 0.13, -0.008), (0.17, 0.14, 0.148, -0.004), (0.31, 0.146, 0.151, 0.006), (0.405, 0.123, 0.13, 0.014), (0.44, 0.08, 0.09, 0.012)],
        skin_light,
        38,
    )
    ellipsoid("Chin", head, (0, -0.105, 0.055), (0.063, 0.036, 0.038), skin_light, 24, 14)
    ellipsoid("Nose.bridge", head, (0, -0.143, 0.238), (0.019, 0.024, 0.066), skin_light, 20, 14, rotation=(-0.08, 0, 0))
    ellipsoid("Nose.tip", head, (0, -0.167, 0.191), (0.026, 0.026, 0.022), skin_light, 20, 12)
    for side, x in (("L", -0.055), ("R", 0.055)):
        ellipsoid(f"EyeWhite.{side}", head, (x, -0.145, 0.274), (0.026, 0.0065, 0.012), eye_white, 20, 12)
        ellipsoid(f"Iris.{side}", head, (x, -0.1515, 0.273), (0.0085, 0.004, 0.0085), iris, 16, 10)
        ellipsoid(f"Pupil.{side}", head, (x, -0.155, 0.273), (0.0038, 0.0025, 0.0042), pupil, 12, 8)
        ellipsoid(f"Brow.{side}", head, (x, -0.15, 0.318), (0.043, 0.005, 0.007), hair, 18, 8, rotation=(0, 0, (-0.09 if side == "L" else 0.09)))
        ellipsoid(f"Cheek.{side}", head, (x * 1.25, -0.13, 0.19), (0.038, 0.004, 0.03), skin_light, 18, 10)
        ellipsoid(f"Ear.{side}", head, ((-0.149 if side == "L" else 0.149), 0.006, 0.235), (0.018, 0.027, 0.047), skin, 18, 12)
        ellipsoid(f"Nostril.{side}", head, (x * .35, -0.184, 0.188), (0.006, 0.003, 0.004), skin_shadow, 12, 8)
    ellipsoid("Upper.lip", head, (0, -0.148, 0.126), (0.039, 0.006, 0.007), mouth, 20, 8)
    ellipsoid("Lower.lip", head, (0, -0.145, 0.112), (0.034, 0.007, 0.008), mouth, 20, 8)
    ellipsoid("Jaw.shadow", head, (0, -0.126, 0.077), (0.085, 0.004, 0.037), skin_shadow, 22, 10)
    ellipsoid("Hair.cap", head, (0, 0.018, 0.392), (0.143, 0.148, 0.092), hair, 38, 22)
    ellipsoid("Hair.back", head, (0, 0.095, 0.318), (0.132, 0.065, 0.105), hair, 30, 18)
    for index, x in enumerate((-0.115, -0.078, -0.038, 0.006, 0.049, 0.09, 0.122)):
        sweep = (index - 3) * 0.025
        ellipsoid(
            f"Hair.lock.{index}",
            head,
            (x, -0.112 + abs(x) * .22, 0.381 - abs(x) * .19),
            (0.026, 0.024, 0.057 + (index % 2) * .008),
            hair,
            18,
            10,
            rotation=(0.05, sweep, -sweep),
        )

    # Tapered arms hide the mechanical joints while keeping the named rigid hierarchy.
    for side, upper, lower, hand, sign in (
        ("L", upper_arm_l, lower_arm_l, hand_l, -1),
        ("R", upper_arm_r, lower_arm_r, hand_r, 1),
    ):
        ellipsoid(f"Deltoid.{side}", upper, (0, 0, -.032), (.076, .073, .088), wetsuit, 24, 14)
        tapered_form(f"UpperArm.mesh.{side}", upper, [(.065, .018, .019, 0), (.035, .058, .058, 0), (-.04, .078, .075, 0), (-.12, .083, .079, 0), (-.3, .075, .072, 0), (-.42, .064, .064, 0), (-.465, .043, .046, 0), (-.49, .017, .02, 0)], wetsuit, 24)
        ellipsoid(f"Arm.panel.{side}", upper, (sign * .067, -0.01, -.22), (.009, .052, .14), panel, 18, 12)
        ellipsoid(f"Elbow.{side}", lower, (0, 0, .012), (.078, .076, .082), wetsuit, 22, 14)
        tapered_form(f"LowerArm.mesh.{side}", lower, [(.025, .071, .071, 0), (-.13, .083, .077, 0), (-.3, .066, .065, 0), (-.39, .055, .058, 0), (-.42, .043, .047, 0)], wetsuit, 24)
        cube(f"Wrist.seam.{side}", lower, (0, -0.056, -.39), (.052, .006, .008), seam, .002)
        tapered_form(f"Palm.{side}", hand, [(0.025, .057, .041, -.004), (-.07, .067, .045, -.012), (-.155, .053, .035, -.018)], skin, 22)
        finger_x = (-.045, -.022, .0, .022, .044)
        finger_lengths = (.092, .112, .12, .108, .082)
        for finger, (x, length) in enumerate(zip(finger_x, finger_lengths)):
            ellipsoid(
                f"Finger.{side}.{finger}",
                hand,
                (x, -0.028, -0.145 - length * .45),
                (0.0115, 0.014, length * .56),
                skin,
                14,
                8,
                rotation=(finger * .012 * sign, 0, -x * .7),
            )
            ellipsoid(f"Nail.{side}.{finger}", hand, (x, -0.042, -0.178 - length * .62), (.008, .003, .011), nail, 12, 6)

    # Long athletic legs, reinforced knees, tapered ankles, and articulated bare feet.
    for side, upper, lower, foot, sign in (
        ("L", upper_leg_l, lower_leg_l, foot_l, -1),
        ("R", upper_leg_r, lower_leg_r, foot_r, 1),
    ):
        tapered_form(f"Thigh.mesh.{side}", upper, [(0.055, .13, .14, 0), (-.17, .14, .15, 0), (-.38, .115, .12, 0), (-.56, .095, .1, 0)], wetsuit, 28)
        ellipsoid(f"Thigh.panel.{side}", upper, (sign * .085, -.075, -.29), (.02, .066, .21), panel, 20, 12)
        tapered_form(f"Shin.mesh.{side}", lower, [(0.045, .108, .112, -.008), (-.12, .115, .12, 0), (-.29, .102, .105, .008), (-.51, .067, .073, .004)], wetsuit, 26)
        ellipsoid(f"Knee.panel.{side}", lower, (0, -.105, -.035), (.068, .014, .096), knee_panel, 22, 14)
        cube(f"Ankle.seam.{side}", lower, (0, -.068, -.475), (.066, .006, .008), seam, .002)
        tapered_form(f"Ankle.{side}", foot, [(.035, .064, .07, 0), (-.09, .061, .067, -.006), (-.145, .07, .075, -.025)], skin, 22)
        ellipsoid(f"Foot.mesh.{side}", foot, (0, -.12, -.14), (.078, .168, .062), skin, 28, 16, rotation=(-.06, 0, 0))
        toe_x = (-.052, -.028, -.003, .023, .047)
        toe_sizes = (.019, .022, .025, .021, .017)
        for toe, (x, size) in enumerate(zip(toe_x, toe_sizes)):
            ellipsoid(f"Toe.{side}.{toe}", foot, (x, -.278 + abs(x) * .1, -.144), (size, .036 - abs(x) * .07, .022), skin, 14, 8)
            ellipsoid(f"Toenail.{side}.{toe}", foot, (x, -.309 + abs(x) * .12, -.133), (size * .58, .007, .009), nail, 12, 6)

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
    # Pose only after export so the preview reads naturally without changing the runtime rest pose.
    bpy.data.objects["UpperArm.L"].rotation_euler[1] = 0.12
    bpy.data.objects["UpperArm.R"].rotation_euler[1] = -0.12
    bpy.data.objects["LowerArm.L"].rotation_euler[1] = 0.045
    bpy.data.objects["LowerArm.R"].rotation_euler[1] = -0.045
    bpy.data.objects["UpperLeg.L"].rotation_euler[1] = -0.025
    bpy.data.objects["UpperLeg.R"].rotation_euler[1] = 0.025
    bpy.context.view_layer.update()
    bounds = [obj.matrix_world @ Vector(corner) for obj in model.children_recursive if obj.type == "MESH" for corner in obj.bound_box]
    ground_z = min(point.z for point in bounds) - 0.015
    model_mid = (min(point.z for point in bounds) + max(point.z for point in bounds)) * 0.5

    ground_mat = material("Preview ground", (0.025, 0.035, 0.04, 1), 0.88)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, ground_z))
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

    bpy.ops.object.camera_add(location=(2.8, -5.15, model_mid + 0.46))
    camera = bpy.context.object
    camera.data.lens = 67
    direction = Vector((0, 0, model_mid + 0.06)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3
    scene.eevee.gtao_factor = 1.35
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 1400
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
