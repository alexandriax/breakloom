"""Build Surfscape's animation-ready expedition van asset with Blender.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-van-model.py
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "public" / "models" / "surf-van-premium.glb"
PREVIEW_PATH = Path("/tmp/surfscape-van-preview.png")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
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
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    alpha: float = 1.0,
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
    if emission:
        emission_input = shader.inputs.get("Emission") or shader.inputs.get("Emission Color")
        strength_input = shader.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = emission
        if strength_input:
            strength_input.default_value = emission_strength
    if alpha < 1:
        shader.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
        mat.use_screen_refraction = True
        mat.show_transparent_back = False
    return mat


def empty(
    name: str,
    parent: bpy.types.Object | None,
    location: tuple[float, float, float],
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.09
    if parent:
        obj.parent = parent
    obj.location = location
    return obj


def smooth(obj: bpy.types.Object, bevel: float = 0.0, segments: int = 2) -> None:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Edge radii", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments


def cube(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.04,
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
    smooth(obj, bevel, 3 if bevel > 0.05 else 2)
    return obj


def cylinder(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
    vertices: int = 28,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj, 0.012)
    return obj


def torus(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    major: float,
    minor: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
    major_segments: int = 30,
    minor_segments: int = 10,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=major_segments,
        minor_segments=minor_segments,
        major_radius=major,
        minor_radius=minor,
        location=(0, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def ellipsoid(
    name: str,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
    segments: int = 28,
    rings: int = 16,
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


def build_wheel(
    root: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    rubber: bpy.types.Material,
    rim: bpy.types.Material,
    hub: bpy.types.Material,
    front: bool,
) -> None:
    parent = empty(f"Steer.{name}", root, location) if front else root
    wheel_location = (0, 0, 0) if front else location
    wheel = empty(f"Wheel.{name}", parent, wheel_location)
    torus(f"Tire.{name}", wheel, (0, 0, 0), 0.38, 0.17, rubber, (0, math.pi / 2, 0), 32, 12)
    cylinder(f"Rim.{name}", wheel, (0, 0, 0), 0.29, 0.31, rim, (0, math.pi / 2, 0), 24)
    cylinder(f"Hub.{name}", wheel, (0, 0, 0), 0.105, 0.34, hub, (0, math.pi / 2, 0), 20)
    for index in range(12):
        angle = (index / 12) * math.pi * 2
        cube(
            f"Tread.{name}.{index}",
            wheel,
            (0, math.sin(angle) * 0.53, math.cos(angle) * 0.53),
            (0.39, 0.14, 0.09),
            rubber,
            0.012,
            (angle, 0, 0),
        )
    for index in range(6):
        angle = (index / 6) * math.pi * 2
        cube(
            f"Spoke.{name}.{index}",
            wheel,
            (0, math.sin(angle) * 0.12, math.cos(angle) * 0.12),
            (0.335, 0.045, 0.16),
            hub,
            0.01,
            (angle, 0, 0),
        )


def build_van() -> bpy.types.Object:
    coral = material("Coral automotive paint", (0.64, 0.105, 0.055, 1), 0.26, 0.28, 0.54, 0.78)
    coral_dark = material("Coral shadow paint", (0.29, 0.035, 0.022, 1), 0.34, 0.22, 0.46, 0.48)
    cream = material("Warm ivory paint", (0.77, 0.61, 0.39, 1), 0.32, 0.12, 0.48, 0.62)
    dark = material("Powder coated trim", (0.012, 0.021, 0.024, 1), 0.55, 0.56, 0.44)
    underbody = material("Underbody", (0.009, 0.012, 0.013, 1), 0.72, 0.42, 0.34)
    rubber = material("All terrain rubber", (0.008, 0.009, 0.01, 1), 0.88, 0.02, 0.24)
    rim = material("Satin alloy rims", (0.22, 0.24, 0.24, 1), 0.3, 0.78, 0.56)
    chrome = material("Brushed stainless hardware", (0.5, 0.54, 0.52, 1), 0.2, 0.9, 0.62)
    glass = material("Ocean tinted safety glass", (0.012, 0.09, 0.11, 1), 0.13, 0.34, 0.7, 0.32, alpha=0.74)
    interior = material("Cabin charcoal", (0.014, 0.019, 0.021, 1), 0.71, 0.08, 0.34)
    leather = material("Weathered saddle seats", (0.19, 0.075, 0.035, 1), 0.67, 0.0, 0.32)
    headlamp = material("LED headlamps", (0.7, 0.79, 0.7, 1), 0.2, 0.08, 0.6, emission=(1, 0.76, 0.38, 1), emission_strength=2.4)
    indicator = material("Amber indicators", (0.77, 0.25, 0.025, 1), 0.24, 0.06, 0.55, emission=(1, 0.17, 0.01, 1), emission_strength=1.2)
    brake = material("Brake lens", (0.5, 0.012, 0.008, 1), 0.25, 0.08, 0.56, emission=(1, 0.005, 0.002, 1), emission_strength=0.28)
    aqua = material("Surfscape aqua detail", (0.015, 0.49, 0.51, 1), 0.3, 0.18, 0.55, 0.42)
    board_white = material("Apex board", (0.82, 0.76, 0.64, 1), 0.25, 0.04, 0.54, 0.7)
    board_aqua = material("Drift board", (0.02, 0.44, 0.49, 1), 0.27, 0.08, 0.55, 0.72)
    board_gold = material("Horizon board", (0.74, 0.48, 0.17, 1), 0.29, 0.05, 0.5, 0.65)

    rig = empty("VanRig", None, (0, 0, 0))
    body = empty("VanBody", rig, (0, 0, 0))

    # Chassis, suspension, and the two-tone monocoque body.
    cube("Chassis", body, (0, -0.05, 0.72), (2.86, 5.8, 0.28), underbody, 0.07)
    cube("LowerBody", body, (0, 0, 1.32), (3.18, 5.92, 1.45), coral, 0.24)
    cube("LowerBelt", body, (0, -0.06, 2.02), (3.23, 5.72, 0.22), coral_dark, 0.075)
    cube("UpperCabin", body, (0, -0.05, 2.72), (3.03, 5.48, 1.42), cream, 0.25)
    cube("Roof", body, (0, -0.08, 3.53), (3.17, 5.64, 0.23), cream, 0.12)
    cube("FrontNose", body, (0, 2.98, 1.38), (3.04, 0.22, 1.44), coral, 0.16)
    cube("RearPanel", body, (0, -3.0, 1.82), (3.03, 0.17, 2.25), cream, 0.1)
    cube("FrontBumper", body, (0, 3.18, 0.76), (3.32, 0.28, 0.27), chrome, 0.08)
    cube("RearBumper", body, (0, -3.18, 0.76), (3.26, 0.28, 0.27), chrome, 0.08)
    cube("FrontSkid", body, (0, 3.12, 0.51), (2.2, 0.22, 0.18), dark, 0.05, (0.12, 0, 0))

    # Windshield, side glass, cabin interior, mirrors, and door hardware.
    cube("Windshield.L", body, (-0.77, 2.71, 2.77), (1.35, 0.055, 0.94), glass, 0.08, (-0.09, 0, 0))
    cube("Windshield.R", body, (0.77, 2.71, 2.77), (1.35, 0.055, 0.94), glass, 0.08, (-0.09, 0, 0))
    cube("WindshieldDivider", body, (0, 2.75, 2.76), (0.085, 0.075, 1.03), dark, 0.022)
    for side, sign in (("L", -1), ("R", 1)):
        for index, y in enumerate((1.72, 0.38, -1.05)):
            width = 1.08 if index < 2 else 1.16
            cube(f"SideWindow.{side}.{index}", body, (sign * 1.53, y, 2.75), (0.05, width, 0.83), glass, 0.05)
        cube(f"DoorHandle.{side}", body, (sign * 1.58, 1.2, 2.02), (0.07, 0.34, 0.08), chrome, 0.022)
        cube(f"RockSlider.{side}", body, (sign * 1.68, -0.05, 0.72), (0.16, 5.0, 0.18), dark, 0.05)
        cube(f"MirrorArm.{side}", body, (sign * 1.73, 2.25, 2.64), (0.32, 0.055, 0.055), chrome, 0.02, (0, sign * 0.12, 0))
        ellipsoid(f"Mirror.{side}", body, (sign * 1.93, 2.27, 2.66), (0.16, 0.08, 0.24), dark, (0, sign * 0.18, 0), 20, 12)
    cube("Dashboard", body, (0, 2.18, 2.05), (2.65, 0.62, 0.24), interior, 0.08)
    for side, x in (("L", -0.72), ("R", 0.72)):
        cube(f"SeatBase.{side}", body, (x, 1.45, 1.55), (0.64, 0.68, 0.22), leather, 0.1)
        cube(f"SeatBack.{side}", body, (x, 1.67, 2.0), (0.65, 0.22, 0.78), leather, 0.12, (-0.12, 0, 0))
    torus("SteeringWheel", body, (-0.68, 2.2, 2.23), 0.23, 0.035, dark, (math.pi / 2.4, 0, 0), 24, 8)
    cylinder("SteeringColumn", body, (-0.68, 2.18, 2.05), 0.04, 0.42, dark, (math.pi / 2.4, 0, 0), 14)

    # Front and rear lighting clusters, grille, badging, and recovery points.
    headlights = empty("Headlights", body, (0, 0, 0))
    for side, x in (("L", -1.02), ("R", 1.02)):
        cylinder(f"Headlight.{side}", headlights, (x, 3.13, 1.42), 0.29, 0.08, headlamp, (math.pi / 2, 0, 0), 28)
        cylinder(f"Indicator.{side}", headlights, (x * 1.18, 3.14, 1.05), 0.11, 0.075, indicator, (math.pi / 2, 0, 0), 20)
    cube("Grille", body, (0, 3.135, 1.32), (1.22, 0.055, 0.47), dark, 0.04)
    for index in range(5):
        cube(f"GrilleBar.{index}", body, (-0.42 + index * 0.21, 3.17, 1.32), (0.035, 0.035, 0.39), chrome, 0.008)
    torus("FrontBadge", body, (0, 3.19, 1.85), 0.13, 0.028, aqua, (math.pi / 2, 0, 0), 22, 8)
    for x in (-0.95, 0.95):
        torus(f"RecoveryPoint.{x}", body, (x, 3.32, 0.65), 0.105, 0.028, coral, (math.pi / 2, 0, 0), 20, 8)
    brake_lights = empty("BrakeLights", body, (0, 0, 0))
    for side, x in (("L", -1.04), ("R", 1.04)):
        cube(f"BrakeLight.{side}", brake_lights, (x, -3.105, 1.55), (0.42, 0.06, 0.54), brake, 0.08)
    cube("RearPlate", body, (0, -3.12, 1.0), (0.92, 0.055, 0.32), cream, 0.035)

    # Expedition details: spare wheel, ladder, awning, and roof rack.
    torus("SpareTire", body, (0, -3.22, 1.74), 0.38, 0.17, rubber, (math.pi / 2, 0, 0), 32, 12)
    cylinder("SpareHub", body, (0, -3.26, 1.74), 0.24, 0.12, rim, (math.pi / 2, 0, 0), 24)
    for side in (-1, 1):
        cube(f"RearLadderRail.{side}", body, (side * 1.26, -3.18, 2.48), (0.06, 0.06, 1.55), chrome, 0.02)
    for index in range(4):
        cube(f"RearLadderStep.{index}", body, (0, -3.2, 1.92 + index * 0.38), (2.46, 0.055, 0.055), chrome, 0.018)
    cylinder("SideAwning", body, (1.72, -0.15, 3.55), 0.095, 4.2, dark, (math.pi / 2, 0, 0), 20)
    for x in (-1.4, 1.4):
        cube(f"RackRail.{x}", body, (x, -0.05, 3.88), (0.075, 5.05, 0.075), dark, 0.025)
    for index, y in enumerate((-1.85, -0.6, 0.65, 1.9)):
        cube(f"RackCrossbar.{index}", body, (0, y, 3.92), (3.25, 0.095, 0.095), chrome, 0.025)

    boards = (
        ("Apex", -0.72, -0.08, 1.34, 0.30, board_white, coral),
        ("Drift", 0.0, -0.18, 1.22, 0.35, board_aqua, cream),
        ("Horizon", 0.75, -0.12, 1.58, 0.34, board_gold, aqua),
    )
    for name, x, y, half_length, half_width, board_mat, accent_mat in boards:
        ellipsoid(f"Board.{name}", body, (x, y, 4.06), (half_width, half_length, 0.06), board_mat, segments=32, rings=14)
        ellipsoid(f"BoardStripe.{name}", body, (x, y + 0.03, 4.115), (half_width * 0.56, half_length * 0.72, 0.018), accent_mat, segments=24, rings=10)
    for index, y in enumerate((-0.88, 0.92)):
        cube(f"RackStrap.{index}", body, (0, y, 4.16), (2.55, 0.075, 0.04), aqua, 0.018)

    # Surfscape side mark: three inset wave bars on both flanks.
    for side, sign in (("L", -1), ("R", 1)):
        for index in range(3):
            cube(
                f"WaveMark.{side}.{index}",
                body,
                (sign * 1.61, -1.55 + index * 0.29, 1.58 + index * 0.05),
                (0.035, 0.48, 0.07),
                aqua,
                0.018,
                (0, 0, sign * (0.08 if index != 1 else -0.06)),
            )

    build_wheel(rig, "FL", (-1.58, 2.0, 0.64), rubber, rim, chrome, True)
    build_wheel(rig, "FR", (1.58, 2.0, 0.64), rubber, rim, chrome, True)
    build_wheel(rig, "RL", (-1.58, -2.08, 0.64), rubber, rim, chrome, False)
    build_wheel(rig, "RR", (1.58, -2.08, 0.64), rubber, rim, chrome, False)
    return rig


def merge_joint_meshes(root: bpy.types.Object) -> None:
    """Reduce draw nodes while preserving steering, suspension, and wheel joints."""
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
        bpy.context.object.name = f"{joint.name}.render"


def setup_preview() -> None:
    ground_mat = material("Preview asphalt", (0.025, 0.029, 0.03, 1), 0.9)
    bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 0, 0))
    bpy.context.object.data.materials.append(ground_mat)

    bpy.ops.object.light_add(type="AREA", location=(5.5, 5.5, 8))
    key = bpy.context.object
    key.data.energy = 1150
    key.data.shape = "DISK"
    key.data.size = 5.5
    key.data.color = (1.0, 0.74, 0.52)

    bpy.ops.object.light_add(type="AREA", location=(-5, 2, 5))
    fill = bpy.context.object
    fill.data.energy = 900
    fill.data.size = 4.5
    fill.data.color = (0.45, 0.82, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(1, -5.5, 6))
    rim = bpy.context.object
    rim.data.energy = 1050
    rim.data.size = 4
    rim.data.color = (0.2, 1.0, 0.85)

    bpy.ops.object.camera_add(location=(7.6, 9.1, 5.25))
    camera = bpy.context.object
    camera.data.lens = 61
    direction = Vector((0, 0, 1.75)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 4
    scene.eevee.gtao_factor = 1.25
    scene.eevee.use_soft_shadows = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.view_settings.look = "Medium High Contrast"
    scene.world.color = (0.008, 0.014, 0.018)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    reset_scene()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model = build_van()
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

    setup_preview()
    print(f"SURFSCAPE_VAN_MODEL={MODEL_PATH}")
    print(f"SURFSCAPE_VAN_PREVIEW={PREVIEW_PATH}")


if __name__ == "__main__":
    main()
