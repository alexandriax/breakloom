"""Build Surfscape's production surfer from a CC0 anatomical base mesh.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-surfer-model.py

The source body is the CC0 Male Base Mesh by orange-juice-games, vendored at
assets/models/male-base-mesh-cc0.glb. Surfscape adds the materials, wetsuit,
face, hair, naming contract, origin, and runtime-ready articulation.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "models" / "male-base-mesh-cc0.glb"
MODEL_PATH = ROOT / "public" / "models" / "surfer-premium.glb"
PREVIEW_PATH = Path("/tmp/surfscape-surfer-preview.png")
COLD_PREVIEW_PATH = Path("/tmp/surfscape-surfer-cold-preview.png")
PELVIS_HEIGHT = 0.0


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
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    segments: int = 28,
    rings: int = 18,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def torus(
    name: str,
    location: tuple[float, float, float],
    major: float,
    minor: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=36,
        minor_segments=10,
        location=location,
        major_radius=major,
        minor_radius=minor,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    smooth(obj)
    return obj


def cube(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.01,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(obj, bevel)
    return obj


def tube_curve(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(f"{name}.curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 3
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bezier, point in zip(spline.bezier_points, points):
        bezier.co = point
        bezier.handle_left_type = "AUTO"
        bezier.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    smooth(obj)
    return obj


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    return joined


def rename_bones(armature: bpy.types.Object, body: bpy.types.Object) -> None:
    names = {
        "spine": "Pelvis",
        "spine.002": "Torso",
        "spine.005": "Head",
        "upper_arm.L": "UpperArm.L",
        "forearm.L": "LowerArm.L",
        "hand.L": "Hand.L",
        "upper_arm.R": "UpperArm.R",
        "forearm.R": "LowerArm.R",
        "hand.R": "Hand.R",
        "thigh.L": "UpperLeg.L",
        "shin.L": "LowerLeg.L",
        "foot.L": "Foot.L",
        "thigh.R": "UpperLeg.R",
        "shin.R": "LowerLeg.R",
        "foot.R": "Foot.R",
    }
    for current, replacement in names.items():
        bone = armature.data.bones.get(current)
        if bone:
            bone.name = replacement
        group = body.vertex_groups.get(current)
        if group:
            group.name = replacement


def apply_anatomical_smoothing(body: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    modifier = body.modifiers.new("Anatomical smoothing", "SUBSURF")
    modifier.subdivision_type = "CATMULL_CLARK"
    modifier.levels = 1
    modifier.render_levels = 1
    while body.modifiers.find(modifier.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=modifier.name)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    smooth(body)


def assign_body_materials(
    body: bpy.types.Object,
    wetsuit: bpy.types.Material,
    panel: bpy.types.Material,
    knee: bpy.types.Material,
    skin: bpy.types.Material,
    rashguard: bpy.types.Material | None = None,
    boardshort: bpy.types.Material | None = None,
    variant: str = "full",
) -> None:
    body.data.materials.clear()
    for mat in (wetsuit, panel, knee, skin, rashguard, boardshort):
        if mat is None:
            continue
        body.data.materials.append(mat)

    hand_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.startswith(("Hand.", "f_", "thumb."))
    }
    foot_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.startswith(("Foot.", "toe.", "heel."))
    }
    lower_arm_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.startswith(("LowerArm.", "Hand.", "f_", "thumb."))
    }
    lower_leg_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.startswith(("LowerLeg.", "Foot.", "toe.", "heel."))
    }

    def group_weight(polygon: bpy.types.MeshPolygon, group_ids: set[int]) -> float:
        weight = 0.0
        for vertex_index in polygon.vertices:
            weight += sum(
                assignment.weight
                for assignment in body.data.vertices[vertex_index].groups
                if assignment.group in group_ids
            )
        return weight / len(polygon.vertices)

    for polygon in body.data.polygons:
        center = polygon.center
        x, y, z = center.x, center.y, center.z
        bare_head = z > 1.64
        bare_hand = group_weight(polygon, hand_groups) > .32
        bare_foot = group_weight(polygon, foot_groups) > .4
        bare_forearm = group_weight(polygon, lower_arm_groups) > .32
        bare_calf = group_weight(polygon, lower_leg_groups) > .34
        if variant == "cold":
            polygon.material_index = 3 if bare_head else 0
        elif variant == "tropical":
            if bare_head or bare_hand or bare_foot:
                polygon.material_index = 3
            elif 1.02 < z < 1.64:
                polygon.material_index = 4
            elif .66 < z <= 1.02:
                polygon.material_index = 5
            else:
                polygon.material_index = 3
        elif variant == "spring" and (bare_head or bare_hand or bare_foot or bare_forearm or bare_calf):
            polygon.material_index = 3
        elif bare_head or bare_hand or bare_foot:
            polygon.material_index = 3
        else:
            polygon.material_index = 0


def create_head_details(
    skin: bpy.types.Material,
    eye_white: bpy.types.Material,
    iris: bpy.types.Material,
    pupil: bpy.types.Material,
    lip: bpy.types.Material,
    hair: bpy.types.Material,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    face_details: list[bpy.types.Object] = []
    hair_details: list[bpy.types.Object] = []
    for side, x in (("L", 0.036), ("R", -0.036)):
        angle = -0.045 if side == "L" else 0.045
        face_details.append(ellipsoid(f"EyeWhite.{side}", (x, -0.154, 1.825), (.0175, .0038, .0068), eye_white, 24, 12, (0, 0, angle)))
        face_details.append(ellipsoid(f"Iris.{side}", (x, -0.1575, 1.8245), (.0052, .0023, .0052), iris, 18, 10))
        face_details.append(ellipsoid(f"Pupil.{side}", (x, -0.1593, 1.8245), (.0022, .0015, .0025), pupil, 14, 8))
        face_details.append(ellipsoid(f"UpperLid.{side}", (x, -0.157, 1.831), (.019, .0028, .0042), skin, 20, 10, (0, 0, angle)))
        hair_details.append(ellipsoid(f"Brow.{side}", (x, -0.157, 1.852), (.026, .0032, .004), hair, 20, 8, (0, 0, angle)))

    face_details.extend([
        ellipsoid("Nose.bridge", (0, -0.158, 1.796), (.0115, .0105, .036), skin, 22, 14, (-.06, 0, 0)),
        ellipsoid("Nose.tip", (0, -0.166, 1.768), (.015, .0115, .011), skin, 22, 12),
        ellipsoid("Nostril.L", (.0065, -.1762, 1.764), (.0022, .0012, .0015), pupil, 12, 8),
        ellipsoid("Nostril.R", (-.0065, -.1762, 1.764), (.0022, .0012, .0015), pupil, 12, 8),
        ellipsoid("Upper.lip", (0, -0.156, 1.73), (.021, .003, .0035), lip, 20, 8),
        ellipsoid("Lower.lip", (0, -0.155, 1.722), (.02, .0034, .004), lip, 20, 8),
        ellipsoid("Ear.L", (.102, -.002, 1.817), (.008, .006, .022), skin, 18, 10, (.03, 0, -.02)),
        ellipsoid("Ear.R", (-.102, -.002, 1.817), (.008, .006, .022), skin, 18, 10, (.03, 0, .02)),
    ])
    hair_details.extend([
        ellipsoid("Hair.cap", (0, .026, 1.916), (.105, .101, .058), hair, 40, 22, (.025, 0, 0)),
        ellipsoid("Hair.crown", (-.012, -.025, 1.935), (.084, .066, .032), hair, 34, 18, (.08, -.04, -.05)),
        ellipsoid("Hair.back", (0, .086, 1.874), (.087, .034, .061), hair, 30, 16, (.04, 0, 0)),
        ellipsoid("Hair.temple.L", (.101, .008, 1.869), (.011, .026, .046), hair, 20, 12, (.04, 0, .06)),
        ellipsoid("Hair.temple.R", (-.101, .008, 1.869), (.011, .026, .046), hair, 20, 12, (.04, 0, -.06)),
        ellipsoid("Hair.sideburn.L", (.101, -.02, 1.838), (.007, .012, .025), hair, 16, 10, (.08, 0, .04)),
        ellipsoid("Hair.sideburn.R", (-.101, -.02, 1.838), (.007, .012, .025), hair, 16, 10, (.08, 0, -.04)),
    ])
    for index, x in enumerate((-.078, -.058, -.036, -.012, .014, .038, .061, .079)):
        hair_details.append(ellipsoid(
            f"Hair.lock.{index}",
            (x, -.093 + abs(x) * .18, 1.91 - abs(x) * .12 - (index % 3) * .003),
            (.0065 + (index % 2) * .0015, .006, .018 + (index % 3) * .004),
            hair,
            16,
            8,
            (.08, (index - 3.5) * .01, -(index - 3.5) * .018),
        ))
    head_details = join_objects(face_details, "Head.details")
    hair = join_objects(hair_details, "Hair.details")
    return head_details, hair


def create_wetsuit_details(
    seam: bpy.types.Material,
    reflective: bpy.types.Material,
    cuff: bpy.types.Material,
    knee: bpy.types.Material,
) -> list[bpy.types.Object]:
    collar = torus("Collar.seam", (0, -.005, 1.635), .091, .007, seam)
    logo = cube("Chest.logo", (.105, -.163, 1.48), (.021, .006, .021), reflective, .003, (0, math.pi / 4, 0))
    leash_cuff = torus("Leash.cuff", (-.066, .004, .155), .053, .012, cuff)
    leash_tab = cube("Leash.cuff.tab", (-.119, -.002, .155), (.018, .014, .026), reflective, .004)
    wrist_details: list[bpy.types.Object] = []
    shoulder_details: list[bpy.types.Object] = []
    for side, sign in (("L", 1), ("R", -1)):
        arm_direction = Vector((.137 * sign, -.039, -.193)).normalized()
        rotation = Vector((0, 0, 1)).rotation_difference(arm_direction).to_euler()
        wrist_details.append(torus(
            f"Wrist.seam.{side}",
            (.509 * sign, -.031, 1.116),
            .044,
            .0055,
            seam,
            tuple(rotation),
        ))
        shoulder_details.append(torus(
            f"Shoulder.seam.{side}",
            (.285 * sign, -.03, 1.44),
            .071,
            .0045,
            seam,
            tuple(rotation),
        ))
    ankle_details = [
        torus(f"Ankle.seam.{side}", (.068 * sign, .016, .155), .051, .005, seam)
        for side, sign in (("L", 1), ("R", -1))
    ]
    torso_seams = [
        tube_curve(
            f"Torso.seam.{side}",
            [
                (.055 * sign, -.108, 1.62),
                (.145 * sign, -.135, 1.49),
                (.16 * sign, -.14, 1.34),
                (.095 * sign, -.108, 1.08),
            ],
            .0032,
            seam,
        )
        for side, sign in (("L", 1), ("R", -1))
    ]
    knee_patches = [
        ellipsoid(
            f"Knee.patch.{side}",
            (.085 * sign, -.063, .51),
            (.056, .0045, .105),
            knee,
            28,
            16,
            (-.04, sign * .025, 0),
        )
        for side, sign in (("L", 1), ("R", -1))
    ]
    return [
        collar,
        logo,
        leash_cuff,
        leash_tab,
        *wrist_details,
        *shoulder_details,
        *ankle_details,
        *torso_seams,
        *knee_patches,
    ]


def create_cold_water_details(neoprene: bpy.types.Material) -> list[bpy.types.Object]:
    hood_parts = [
        ellipsoid("Cold.Hood.back", (0, .052, 1.862), (.112, .091, .142), neoprene, 36, 22),
        ellipsoid("Cold.Hood.crown", (0, .004, 1.928), (.108, .078, .058), neoprene, 34, 18, (.04, 0, 0)),
        ellipsoid("Cold.Hood.temple.L", (.098, .008, 1.844), (.016, .038, .098), neoprene, 24, 16, (.03, 0, .025)),
        ellipsoid("Cold.Hood.temple.R", (-.098, .008, 1.844), (.016, .038, .098), neoprene, 24, 16, (.03, 0, -.025)),
    ]
    hood = join_objects(hood_parts, "Cold.Hood")
    hood.data.name = "Cold.Hood.mesh"

    gloves = [
        ellipsoid(
            f"Cold.Glove.{side}",
            (.548 * sign, -.034, 1.047),
            (.061, .049, .091),
            neoprene,
            28,
            16,
            (.04, sign * .055, sign * -.035),
        )
        for side, sign in (("L", 1), ("R", -1))
    ]
    booties = [
        ellipsoid(
            f"Cold.Bootie.{side}",
            (.071 * sign, -.052, .067),
            (.064, .137, .049),
            neoprene,
            30,
            16,
            (.02, 0, sign * -.015),
        )
        for side, sign in (("L", 1), ("R", -1))
    ]
    for detail in (*gloves, *booties):
        detail.data.name = f"{detail.name}.mesh"
    cold_details = [hood, *gloves, *booties]
    for detail in cold_details:
        bpy.ops.object.select_all(action="DESELECT")
        detail.select_set(True)
        bpy.context.view_layer.objects.active = detail
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return cold_details


def build_surfer() -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Missing CC0 base mesh: {SOURCE_PATH}")
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_PATH))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "mesh")
    for obj in list(bpy.context.scene.objects):
        if obj not in (armature, body):
            bpy.data.objects.remove(obj, do_unlink=True)

    armature.name = "SurferArmature"
    armature.data.name = "SurferArmature.rig"
    body.name = "SurferBody.Full"
    body.data.name = "SurferBody.Full.mesh"
    rename_bones(armature, body)
    armature.data.pose_position = "REST"
    apply_anatomical_smoothing(body)

    wetsuit = material("Japanese limestone neoprene", (.012, .018, .021, 1), .54, specular=.5, sheen=.05)
    panel = material("Graphite stretch panels", (.025, .036, .039, 1), .48, specular=.54, clearcoat=.04)
    knee = material("Abrasion knee panels", (.018, .022, .024, 1), .7, specular=.28)
    seam = material("Liquid sealed seams", (.025, .39, .39, 1), .4, specular=.56, clearcoat=.1)
    skin = material("Sun warmed skin", (.37, .15, .064, 1), .62, specular=.34, subsurface=.09)
    eye_white = material("Natural sclera", (.64, .61, .55, 1), .3, specular=.54)
    iris = material("Hazel iris", (.012, .04, .027, 1), .23, specular=.68, clearcoat=.13)
    pupil = material("Pupil", (.001, .001, .001, 1), .2, specular=.72)
    lip = material("Natural lip", (.25, .057, .04, 1), .6, specular=.28)
    hair = material("Wet dark hair", (.004, .003, .002, 1), .35, specular=.58, clearcoat=.12)
    reflective = material("Surfscape reflective mark", (.08, .62, .58, 1), .24, metallic=.18, specular=.72, clearcoat=.32)
    cuff = material("Leash ankle cuff", (.012, .019, .022, 1), .36, specular=.62, clearcoat=.16)
    rashguard = material("Thermal UV rashguard", (.02, .18, .2, 1), .46, specular=.46, sheen=.08)
    boardshort = material("Hydrophobic performance boardshort", (.018, .052, .065, 1), .52, specular=.4, clearcoat=.03)
    thermal_accessory = material("Thermal neoprene accessories", (.009, .014, .017, 1), .5, specular=.52, sheen=.05)

    assign_body_materials(body, wetsuit, panel, knee, skin)
    cold_body = body.copy()
    cold_body.data = body.data.copy()
    cold_body.name = "SurferBody.Cold"
    cold_body.data.name = "SurferBody.Cold.mesh"
    bpy.context.scene.collection.objects.link(cold_body)
    assign_body_materials(cold_body, wetsuit, panel, knee, skin, variant="cold")

    spring_body = body.copy()
    spring_body.data = body.data.copy()
    spring_body.name = "SurferBody.Spring"
    spring_body.data.name = "SurferBody.Spring.mesh"
    bpy.context.scene.collection.objects.link(spring_body)
    assign_body_materials(spring_body, wetsuit, panel, knee, skin, variant="spring")

    tropical_body = body.copy()
    tropical_body.data = body.data.copy()
    tropical_body.name = "SurferBody.Tropical"
    tropical_body.data.name = "SurferBody.Tropical.mesh"
    bpy.context.scene.collection.objects.link(tropical_body)
    assign_body_materials(
        tropical_body,
        wetsuit,
        panel,
        knee,
        skin,
        rashguard,
        boardshort,
        variant="tropical",
    )
    head_details, hair_details = create_head_details(skin, eye_white, iris, pupil, lip, hair)
    details = create_wetsuit_details(seam, reflective, cuff, knee)
    cold_details = create_cold_water_details(thermal_accessory)
    # The CC0 glTF carries its bind rotation and translation on the armature object.
    # Static detail meshes are authored in armature space, so give them that complete
    # transform before runtime attaches each piece to its matching joint.
    bind_matrix = armature.matrix_world.copy()
    for detail in (head_details, hair_details, *details, *cold_details):
        detail.matrix_world = bind_matrix @ detail.matrix_world
    bpy.context.view_layer.update()

    root = bpy.data.objects.new("SurferRig", None)
    bpy.context.scene.collection.objects.link(root)
    for articulated in (armature, body, cold_body, spring_body, tropical_body):
        world = articulated.matrix_world.copy()
        articulated.parent = root
        articulated.matrix_world = world
    for detail in (head_details, hair_details, *details, *cold_details):
        detail_world = detail.matrix_world.copy()
        detail.parent = root
        detail.matrix_world = detail_world
    root.location.z = -PELVIS_HEIGHT
    return root, [
        root,
        armature,
        body,
        cold_body,
        spring_body,
        tropical_body,
        head_details,
        hair_details,
        *details,
        *cold_details,
    ]


def setup_preview(root: bpy.types.Object, export_objects: list[bpy.types.Object]) -> None:
    for obj in export_objects:
        if obj.name.startswith(("SurferBody.Cold", "SurferBody.Spring", "SurferBody.Tropical", "Cold.")):
            obj.hide_render = True
    bpy.context.view_layer.update()
    bounds = [
        obj.matrix_world @ Vector(corner)
        for obj in export_objects
        if obj.type == "MESH"
        for corner in obj.bound_box
    ]
    ground_z = min(point.z for point in bounds) - .015
    model_mid = (min(point.z for point in bounds) + max(point.z for point in bounds)) * .5

    ground_mat = material("Preview ground", (.025, .035, .04, 1), .88)
    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, ground_z))
    bpy.context.object.data.materials.append(ground_mat)

    bpy.ops.object.light_add(type="AREA", location=(3.5, -4.5, 5.1))
    key = bpy.context.object
    key.data.energy = 880
    key.data.shape = "DISK"
    key.data.size = 4.5
    key.data.color = (.78, .94, 1)

    bpy.ops.object.light_add(type="AREA", location=(-4, -1.5, 2.6))
    fill = bpy.context.object
    fill.data.energy = 560
    fill.data.size = 3.2
    fill.data.color = (1, .55, .36)

    bpy.ops.object.light_add(type="AREA", location=(0, 4, 3.8))
    rim = bpy.context.object
    rim.data.energy = 740
    rim.data.size = 3
    rim.data.color = (.35, .9, .88)

    bpy.ops.object.camera_add(location=(2.45, -4.3, model_mid + .28))
    camera = bpy.context.object
    camera.data.lens = 72
    direction = Vector((0, 0, model_mid + .02)) - camera.location
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
    scene.world.color = (.012, .02, .026)
    bpy.ops.render.render(write_still=True)

    for obj in export_objects:
        if obj.name == "SurferBody.Full":
            obj.hide_render = True
        elif obj.name == "SurferBody.Cold":
            obj.hide_render = False
        elif obj.name == "Hair.details":
            obj.hide_render = True
        elif obj.name.startswith("Cold."):
            obj.hide_render = False
    scene.render.filepath = str(COLD_PREVIEW_PATH)
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)


def main() -> None:
    reset_scene()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    root, export_objects = build_surfer()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
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

    setup_preview(root, export_objects)
    print(f"SURFSCAPE_MODEL={MODEL_PATH}")
    print(f"SURFSCAPE_PREVIEW={PREVIEW_PATH}")
    print(f"SURFSCAPE_COLD_PREVIEW={COLD_PREVIEW_PATH}")


if __name__ == "__main__":
    main()
