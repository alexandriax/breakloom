"""Build Surfscape's reusable rigged beach-visitor model.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-beach-visitor-model.py

The model derives from Surfscape's vendored CC0 anatomical base and adds a
casual layered outfit, shoes, face, hair, and an optional camera prop. Runtime
code recolors and poses clones for varied beach activity without duplicating
geometry in the browser.
"""

from __future__ import annotations

import math
import sys
import importlib.util
from pathlib import Path

import bpy
import bmesh


ROOT = Path(__file__).resolve().parents[1]
BASE_SCRIPT = ROOT / "scripts" / "build-surfer-model.py"
base_spec = importlib.util.spec_from_file_location("surfscape_surfer_builder", BASE_SCRIPT)
if base_spec is None or base_spec.loader is None:
    raise RuntimeError(f"Unable to load shared model helpers from {BASE_SCRIPT}")
base = importlib.util.module_from_spec(base_spec)
sys.modules[base_spec.name] = base
base_spec.loader.exec_module(base)


SOURCE_PATH = ROOT / "assets" / "models" / "male-base-mesh-cc0.glb"
MODEL_PATH = ROOT / "public" / "models" / "beach-visitor-premium.glb"
PREVIEW_PATH = Path("/tmp/surfscape-beach-visitor-preview.png")


def cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=28,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    base.smooth(obj, .002)
    return obj


def garment_from_body(
    body: bpy.types.Object,
    name: str,
    mat: bpy.types.Material,
    keep_face,
    thickness: float,
) -> bpy.types.Object:
    garment = body.copy()
    garment.data = body.data.copy()
    garment.name = name
    garment.data.name = f"{name}.mesh"
    bpy.context.collection.objects.link(garment)
    garment.data.materials.clear()
    garment.data.materials.append(mat)

    mesh = bmesh.new()
    mesh.from_mesh(garment.data)
    remove = [face for face in mesh.faces if not keep_face(face.calc_center_median())]
    bmesh.ops.delete(mesh, geom=remove, context="FACES")
    mesh.to_mesh(garment.data)
    mesh.free()
    for polygon in garment.data.polygons:
        polygon.material_index = 0

    bpy.ops.object.select_all(action="DESELECT")
    garment.select_set(True)
    bpy.context.view_layer.objects.active = garment
    tailoring = garment.modifiers.new("Tailored edge smoothing", "SUBSURF")
    tailoring.subdivision_type = "CATMULL_CLARK"
    tailoring.levels = 1
    tailoring.render_levels = 1
    while garment.modifiers.find(tailoring.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=tailoring.name)
    bpy.ops.object.modifier_apply(modifier=tailoring.name)
    layering = garment.modifiers.new("Garment layering", "SOLIDIFY")
    layering.thickness = thickness
    layering.offset = 1
    while garment.modifiers.find(layering.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=layering.name)
    bpy.ops.object.modifier_apply(modifier=layering.name)
    base.smooth(garment)
    return garment


def create_clothing(
    body: bpy.types.Object,
    shirt: bpy.types.Material,
    shorts: bpy.types.Material,
    shoes: bpy.types.Material,
    sole: bpy.types.Material,
) -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    shirt_body = garment_from_body(
        body,
        "VisitorShirt",
        shirt,
        lambda center: (
            abs(center.x) < .245 and .97 < center.z < 1.61
        ) or (
            .19 < abs(center.x) < .37 and 1.31 < center.z < 1.56
        ),
        .016,
    )
    shorts_body = garment_from_body(
        body,
        "VisitorShorts",
        shorts,
        lambda center: abs(center.x) < .22 and .68 < center.z < 1.1,
        .02,
    )

    shoe_objects: list[bpy.types.Object] = []
    for side, sign in (("L", 1), ("R", -1)):
        upper = base.ellipsoid(f"Shoe.upper.{side}", (.067 * sign, -.065, .07), (.074, .132, .052), shoes, 30, 18, (.08, 0, 0))
        outsole = base.cube(f"Shoe.sole.{side}", (.067 * sign, -.066, .036), (.077, .137, .014), sole, .009, (.08, 0, 0))
        shoe_objects.append(base.join_objects([upper, outsole], f"Foot.{side}.shoe"))

    return [shirt_body, shorts_body], shoe_objects


def create_camera_prop(
    camera_mat: bpy.types.Material,
    lens_mat: bpy.types.Material,
    glass_mat: bpy.types.Material,
) -> bpy.types.Object:
    body = base.cube("Camera.body", (0, -.247, 1.49), (.12, .038, .078), camera_mat, .012)
    grip = base.cube("Camera.grip", (-.092, -.25, 1.445), (.03, .04, .052), camera_mat, .008)
    lens = cylinder("Camera.lens", (0, -.305, 1.49), .049, .052, lens_mat, (math.pi / 2, 0, 0))
    glass = cylinder("Camera.glass", (0, -.334, 1.49), .035, .006, glass_mat, (math.pi / 2, 0, 0))
    camera = base.join_objects([body, grip, lens, glass], "Camera.prop")
    return camera


def build_visitor() -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Missing CC0 base mesh: {SOURCE_PATH}")
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_PATH))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "mesh")
    for obj in list(bpy.context.scene.objects):
        if obj not in (armature, body):
            bpy.data.objects.remove(obj, do_unlink=True)

    armature.name = "VisitorArmature"
    armature.data.name = "VisitorArmature.rig"
    body.name = "VisitorBody"
    base.rename_bones(armature, body)
    armature.data.pose_position = "REST"
    base.apply_anatomical_smoothing(body)

    skin = base.material("Visitor skin", (.43, .21, .11, 1), .59, specular=.36, subsurface=.085)
    eye_white = base.material("Visitor sclera", (.72, .69, .63, 1), .32, specular=.52)
    iris = base.material("Visitor iris", (.025, .07, .045, 1), .24, specular=.66, clearcoat=.12)
    pupil = base.material("Visitor pupil", (.001, .001, .001, 1), .2, specular=.7)
    lip = base.material("Visitor lip", (.31, .09, .065, 1), .58, specular=.3)
    hair = base.material("Visitor hair", (.018, .009, .005, 1), .48, specular=.4, sheen=.05)
    shirt = base.material("Visitor shirt", (.72, .16, .1, 1), .72, specular=.28, sheen=.06)
    shorts = base.material("Visitor shorts", (.055, .12, .15, 1), .76, specular=.25)
    shoes = base.material("Visitor shoes", (.78, .76, .69, 1), .63, specular=.34)
    sole = base.material("Visitor shoe sole", (.055, .06, .06, 1), .84, specular=.2)
    camera_mat = base.material("Visitor camera body", (.018, .022, .024, 1), .35, metallic=.34, specular=.68)
    lens_mat = base.material("Visitor camera lens", (.025, .04, .045, 1), .2, metallic=.48, specular=.8, clearcoat=.3)
    glass_mat = base.material("Visitor camera glass", (.08, .26, .31, 1), .08, metallic=.12, specular=.9, clearcoat=.64)

    body.data.materials.clear()
    body.data.materials.append(skin)
    for polygon in body.data.polygons:
        polygon.material_index = 0

    head_details = base.create_head_details(skin, eye_white, iris, pupil, lip, hair)
    skinned_clothing, clothing_details = create_clothing(body, shirt, shorts, shoes, sole)
    camera = create_camera_prop(camera_mat, lens_mat, glass_mat)
    details = [head_details, *clothing_details, camera]

    bind_matrix = armature.matrix_world.copy()
    for detail in details:
        detail.matrix_world = bind_matrix @ detail.matrix_world
    bpy.context.view_layer.update()

    root = bpy.data.objects.new("VisitorRig", None)
    bpy.context.scene.collection.objects.link(root)
    for articulated in (armature, body, *skinned_clothing):
        world = articulated.matrix_world.copy()
        articulated.parent = root
        articulated.matrix_world = world
    for detail in details:
        world = detail.matrix_world.copy()
        detail.parent = root
        detail.matrix_world = world

    export_objects = [root, armature, body, *skinned_clothing, *details]
    return root, export_objects


def main() -> None:
    base.reset_scene()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    root, export_objects = build_visitor()

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

    base.PREVIEW_PATH = PREVIEW_PATH
    base.setup_preview(root, export_objects)
    print(f"SURFSCAPE_VISITOR_MODEL={MODEL_PATH}")
    print(f"SURFSCAPE_VISITOR_PREVIEW={PREVIEW_PATH}")


if __name__ == "__main__":
    main()
