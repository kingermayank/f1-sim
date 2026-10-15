"""
Builds the APEX Shanghai circuit in Blender.

Everything around the racing surface is made here, from the layout the game
itself derives from its centreline (scripts/circuit/export-shanghai-layout.mjs):
terrain and a lake, run-off, gravel and kerbs, barriers with debris fencing,
grandstands full of people, the pit building with team garages and the pit
wall, the start gantry, bridges, a control tower and big screens, marshal
posts, braking, DRS and turn boards, billboards, trees and a distant skyline.
The printed graphics are APEX's own (scripts/circuit/render-posters.mjs).

Run with Blender's Python, either the bpy module or Blender itself:
  python scripts/circuit/build_shanghai_circuit.py
  blender --background --python scripts/circuit/build_shanghai_circuit.py

Writes work/track-build/shanghai-apex.blend and work/track-build/shanghai-apex.glb.
Game coordinates are metres with +Y up; Blender's are +Z up, so a game point
(x, y, z) is placed at (x, -z, y) and the glTF exporter turns it back.

Lateral offsets follow the layout: positive towards (-t.z, t.x) from the
tangent t, which the layout calls "left" (it is the driver's right).
"""

import json
import math
import random
from pathlib import Path

import bpy  # first: the bpy module makes bmesh and mathutils importable
import bmesh
import numpy as np
from mathutils import Vector, kdtree

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'work' / 'track-build'
LAYOUT = json.loads((BUILD / 'shanghai-layout.json').read_text())
POSTERS = BUILD / 'posters'

RNG = random.Random(2026)
N = LAYOUT['rows']
STEP = LAYOUT['step']
CHUNK = 100  # rows per chunk: about 200 m, so the game can cull what it cannot see
STANDOFF = LAYOUT['barrierStandoff']
CENTRE = LAYOUT['centre']
PIT = LAYOUT['pit']
PIT_SIDE = LAYOUT['pitSide']
PIT_HALF = LAYOUT['pitHalfWidth']
SIDES = {1: 'left', -1: 'right'}
UP = Vector((0.0, 1.0, 0.0))

BILLBOARDS = ['billboard-apex', 'billboard-shanghai', 'billboard-podium', 'billboard-driver', 'billboard-legible', 'billboard-grid']
TEAM_COLOURS = ['#dc0000', '#ff8000', '#1e41ff', '#2b4562', '#0090ff', '#005aff', '#006f62', '#ffb82e']


def wrap(index):
    return int(index) % N


def row_of(fraction):
    return wrap(round(fraction * N))


def frame(index):
    """Centre point, unit tangent and the lateral axis at a row."""
    x, y, z, tx, tz = CENTRE[wrap(index)]
    return (x, y, z), (tx, tz), (-tz, tx)


def at(index, lateral, lift=0.0):
    (x, y, z), _, (nx, nz) = frame(index)
    return (x + nx * lateral, y + lift, z + nz * lateral)


def lerp_at(position, lateral, lift=0.0):
    """A point at a fractional row, for detail finer than the 2 m rows."""
    i = math.floor(position)
    t = position - i
    a = at(i, lateral, lift)
    b = at(i + 1, lateral, lift)
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def tangent(index):
    _, (tx, tz), _ = frame(index)
    return Vector((tx, 0.0, tz))


def normal(index):
    _, _, (nx, nz) = frame(index)
    return Vector((nx, 0.0, nz))


def wall(side, index):
    return LAYOUT['wall'][SIDES[side]][wrap(index)]


def kerbed(side, index):
    return LAYOUT['kerb'][SIDES[side]][wrap(index)] == '1'


def runoff(side, index):
    return LAYOUT['runoff'][SIDES[side]][wrap(index)]


def clearance(side, index):
    value = LAYOUT['clearance'][SIDES[side]][wrap(index)]
    return 90.0 if value is None else value


def tecpro(side, index):
    return runoff(side, index) in ('a', 'r')


def barrier_back(side, index):
    """Lateral distance to the back of the barrier."""
    return wall(side, index) + STANDOFF + (1.0 if tecpro(side, index) else 0.0) + 0.5


def srgb(hex_colour, alpha=1.0):
    value = int(hex_colour.lstrip('#'), 16)
    channel = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    linear = [((c / 255 + 0.055) / 1.055) ** 2.4 if c / 255 > 0.04045 else (c / 255) / 12.92 for c in channel]
    return (linear[0], linear[1], linear[2], alpha)


def scale_colour(colour, factor):
    return (min(1.0, colour[0] * factor), min(1.0, colour[1] * factor), min(1.0, colour[2] * factor), colour[3])


def approach_normal(index, side, turn=0.35):
    """Horizontal direction a trackside board faces: back towards the cars
    coming, turned a little towards the track."""
    towards_track = -normal(index) * side
    return (-tangent(index) * math.cos(turn) + towards_track * math.sin(turn)).normalized()


# --------------------------------------------------------------- scene ------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    return scene


MATERIALS = {}


def material(name, colour='#808080', roughness=0.8, metallic=0.0, emission=None, strength=0.0,
             image=None, alpha=None, vertex_colours=False):
    """A Principled material. Names are what the game recognises and restyles."""
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb(colour)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    texture = None
    if image is not None:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(image))
        texture.interpolation = 'Linear'
    if vertex_colours:
        attribute = nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        if texture is not None:
            mix = nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            links.new(texture.outputs['Color'], mix.inputs['A'])
            links.new(attribute.outputs['Color'], mix.inputs['B'])
            links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
    elif texture is not None:
        links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    if texture is not None and name == 'apex_crowd':
        links.new(texture.outputs['Alpha'], bsdf.inputs['Alpha'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = srgb(emission)
        bsdf.inputs['Emission Strength'].default_value = strength
        if texture is not None:
            links.new(texture.outputs['Color'], bsdf.inputs['Emission Color'])
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
    if (alpha is not None or name == 'apex_crowd') and hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'BLENDED'
    MATERIALS[name] = mat
    return mat


def make_crowd_atlas(path):
    """Sixteen spectators, 64 x 128 px each, in two rows of eight. Shirts are
    grey with alpha 0.78 so the game can tint them per person; skin, hair and
    caps are opaque and keep their colour."""
    width, height = 512, 256
    pixels = np.zeros((height, width, 4), dtype=np.float32)
    skins = ['#f1c7a5', '#e0ac8a', '#c68863', '#a86b47', '#8d5a3b', '#6b4029', '#f5d0b5', '#b98262']
    hairs = ['#1c1410', '#3b2617', '#6b4a2b', '#a9875a', '#2a2a2a', '#d9c39a', '#4a2c1a', '#141414']
    caps = ['#ffb82e', '#dc0000', '#ff8000', '#1e41ff', '#ffffff', '#151515']
    yy, xx = np.mgrid[0:128, 0:64].astype(np.float32)

    def tone(hex_colour):
        # A byte image keeps the display (sRGB) values it is given.
        value = int(hex_colour.lstrip('#'), 16)
        return np.array([(value >> 16) & 255, (value >> 8) & 255, value & 255], dtype=np.float32) / 255

    for cell in range(16):
        col, row = cell % 8, cell // 8
        rng = random.Random(cell * 31 + 7)
        skin = tone(skins[cell % 8])
        hair = tone(hairs[(cell * 3) % 8])
        tile = np.zeros((128, 64, 4), dtype=np.float32)
        # Image rows run bottom-up in Blender, so y = 0 is the person's waist.
        shoulder = 76 + rng.uniform(-3, 3)
        half_top = 21 + rng.uniform(-3, 3)
        half_bottom = half_top - 4
        torso = (yy < shoulder) & (np.abs(xx - 32) < half_bottom + (half_top - half_bottom) * (yy / shoulder))
        corner = (yy > shoulder - 8) & (np.abs(xx - 32) > half_top - 8)
        corner &= ((np.abs(xx - 32) - (half_top - 8)) ** 2 + (yy - (shoulder - 8)) ** 2) > 64
        torso &= ~corner
        shade = 0.62 + 0.3 * (1 - np.abs(xx - 32) / 26) - 0.12 * (yy < 10)
        tile[torso] = np.stack([shade, shade, shade, np.full_like(shade, 0.78)], -1)[torso]
        if cell >= 12 or rng.random() < 0.15:
            for direction in (-1, 1):
                x0 = 32 + direction * (half_top - 3)
                for t in np.linspace(0, 1, 60):
                    disk = (xx - (x0 + direction * 9 * t)) ** 2 + (yy - (shoulder - 6 + 46 * t)) ** 2 < 16
                    tile[disk] = [0.7, 0.7, 0.7, 0.78] if t < 0.3 else [*skin, 1.0]
        neck = (np.abs(xx - 32) < 6) & (yy >= shoulder - 4) & (yy < shoulder + 6)
        tile[neck] = [*(skin * 0.8), 1.0]
        head_y = shoulder + 18 + rng.uniform(-2, 2)
        rx, ry = 11 + rng.uniform(-1, 1.5), 14 + rng.uniform(-1, 1)
        head = ((xx - 32) / rx) ** 2 + ((yy - head_y) / ry) ** 2 < 1
        tile[head] = [*skin, 1.0]
        top_of_head = head & (yy > head_y + ry * 0.25)
        if rng.random() < 0.35:
            cap = tone(caps[rng.randrange(len(caps))])
            brim = (np.abs(xx - 36) < rx + 3) & (np.abs(yy - (head_y + ry * 0.3)) < 2.2)
            tile[top_of_head | brim] = [*cap, 1.0]
        else:
            long_hair = rng.random() < 0.4
            sides = long_hair & (np.abs(xx - 32) < rx + 2) & (np.abs(xx - 32) > rx - 3) & (yy > head_y - ry * 1.1) & (yy < head_y + ry * 0.5)
            tile[top_of_head | sides] = [*hair, 1.0]
        pixels[row * 128:(row + 1) * 128, col * 64:(col + 1) * 64] = tile
    image = bpy.data.images.new('crowd_atlas', width, height, alpha=True)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)


def define_materials():
    material('apex_ground', '#4c6b2c', 0.95)
    material('apex_grass', '#557a30', 0.95)
    material('apex_road', '#2b2c2e', 0.9)
    material('apex_pitlane', '#34363a', 0.85)
    material('apex_runoff', '#3a3b3d', 0.9)
    material('apex_gravel', '#b7a688', 1.0)
    material('apex_paint', '#ffffff', 0.7, vertex_colours=True)
    material('apex_kerb', '#ffffff', 0.6, vertex_colours=True)
    material('apex_concrete', '#c9ccd1', 0.85)
    material('apex_concrete_dark', '#7d838c', 0.9)
    material('apex_steel', '#9aa1aa', 0.35, 0.85)
    material('apex_graphite', '#1d232c', 0.55, 0.3)
    material('apex_white', '#e8ebef', 0.5)
    material('apex_glass', '#22303f', 0.06, 0.65)
    material('apex_interior', '#0b0d10', 0.9)
    material('apex_led_amber', '#ffb454', 0.4, emission='#ffb454', strength=4.0)
    material('apex_led_white', '#f4f7ff', 0.4, emission='#f4f7ff', strength=3.0)
    material('apex_tecpro', '#ffffff', 0.7, vertex_colours=True)
    material('apex_fence', '#c7ccd3', 0.5, 0.6, alpha=0.35)
    material('apex_seat', '#ffffff', 0.75, vertex_colours=True)
    material('apex_trim', '#ffffff', 0.6, vertex_colours=True)
    material('apex_trunk', '#4a3a2a', 0.95)
    material('apex_leaves', '#ffffff', 0.9, vertex_colours=True)
    material('apex_city', '#ffffff', 0.7, 0.2, vertex_colours=True)
    material('apex_water', '#1d3a4a', 0.05, 0.2)
    material('apex_marshal_light', '#2bff7a', 0.5, emission='#2bff7a', strength=2.5)
    for light in range(1, 6):
        material(f'apex_gantry_light_{light}', '#2a0505', 0.4, emission='#ff1a12', strength=0.0)
    for poster in sorted(POSTERS.glob('*.png')):
        emissive = poster.stem == 'screen'
        material(f'poster_{poster.stem}', '#ffffff', 0.55, image=poster,
                 emission='#ffffff' if emissive else None, strength=1.6 if emissive else 0.0)
    make_crowd_atlas(BUILD / 'crowd.png')
    material('apex_crowd', '#ffffff', 0.9, image=BUILD / 'crowd.png', vertex_colours=True)


# ---------------------------------------------------------- mesh builder ----
GROUPS = {}


def group(name):
    """An empty that parents one kind of scenery, so the game can find it."""
    if name not in GROUPS:
        empty = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(empty)
        GROUPS[name] = empty
    return GROUPS[name]


class MeshBuilder:
    """Accumulates faces in game coordinates, then makes one Blender object."""

    def __init__(self, name, materials, parent='scenery'):
        self.name = name
        self.materials = list(materials)
        self.parent = parent
        self.verts = []
        self.faces = []
        self.mats = []
        self.uvs = []
        self.cols = []

    def mat(self, name):
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def vertex(self, point):
        x, y, z = point
        self.verts.append((x, -z, y))
        return len(self.verts) - 1

    def face(self, points, mat=0, uv=None, colour=None, facing=None):
        """A polygon from game-space points. `facing` (a game-space direction)
        flips the winding if needed so the face points that way."""
        points = list(points)
        uv = list(uv) if uv else [(0.0, 0.0)] * len(points)
        if isinstance(mat, str):
            mat = self.mat(mat)
        if facing is not None:
            a, b, c = (Vector(p) for p in points[:3])
            n = (b - a).cross(c - a)
            if n.length_squared < 1e-12 and len(points) > 3:
                n = (c - a).cross(Vector(points[3]) - a)
            if n.dot(Vector(facing)) < 0:
                points.reverse()
                uv.reverse()
        indices = [self.vertex(p) for p in points]
        self.faces.append(indices)
        self.mats.append(mat)
        self.uvs.extend(uv)
        colour = colour or (1.0, 1.0, 1.0, 1.0)
        self.cols.extend([colour] * len(points))

    def quad(self, a, b, c, d, mat=0, uv=None, colour=None, facing=None):
        self.face((a, b, c, d), mat, uv or ((0, 0), (1, 0), (1, 1), (0, 1)), colour, facing)

    def box(self, centre, size, yaw=0.0, mat=0, colour=None, faces='all'):
        """An oriented box. `yaw` turns its length about the game's up axis
        (yaw = atan2(t.z, t.x) lines it up with a tangent); `size` is
        (along, up, across)."""
        cx, cy, cz = centre
        sx, sy, sz = (s / 2 for s in size)
        cos_y, sin_y = math.cos(yaw), math.sin(yaw)

        def p(u, v, w):
            return (cx + u * cos_y - w * sin_y, cy + v, cz + u * sin_y + w * cos_y)

        corners = {(i, j, k): p(i * sx, j * sy, k * sz) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)}
        sides = {
            'top': ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)),
            'bottom': ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)),
            'front': ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
            'back': ((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)),
            'left': ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)),
            'right': ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)),
        }
        centre_v = Vector(centre)
        for key, quad in sides.items():
            if faces != 'all' and key not in faces:
                continue
            points = [corners[q] for q in quad]
            middle = sum((Vector(q) for q in points), Vector()) / 4
            self.face(points, mat, None, colour, facing=middle - centre_v)

    def beam(self, p0, p1, width, mat=0, colour=None, depth=None):
        """A square-section bar between two points."""
        p0, p1 = Vector(p0), Vector(p1)
        axis = (p1 - p0).normalized()
        side = UP if abs(axis.y) < 0.95 else Vector((1.0, 0.0, 0.0))
        u = axis.cross(side).normalized() * (width / 2)
        v = axis.cross(u).normalized() * ((depth or width) / 2)
        ring0 = [p0 + u + v, p0 - u + v, p0 - u - v, p0 + u - v]
        ring1 = [p1 + u + v, p1 - u + v, p1 - u - v, p1 + u - v]
        for k in range(4):
            a, b = ring0[k], ring0[(k + 1) % 4]
            self.quad(a, b, ring1[(k + 1) % 4], ring1[k], mat, colour=colour, facing=(a + b) / 2 - p0)
        self.face(ring1, mat, colour=colour, facing=axis)
        self.face(ring0, mat, colour=colour, facing=-axis)

    def prism(self, centre, radius, y0, y1, sides=8, mat=0, colour=None, top=True, radius_top=None):
        cx, _, cz = centre
        rt = radius if radius_top is None else radius_top
        ring0 = [(cx + math.cos(k / sides * math.tau) * radius, y0, cz + math.sin(k / sides * math.tau) * radius) for k in range(sides)]
        ring1 = [(cx + math.cos(k / sides * math.tau) * rt, y1, cz + math.sin(k / sides * math.tau) * rt) for k in range(sides)]
        for k in range(sides):
            a, b = ring0[k], ring0[(k + 1) % sides]
            out = Vector(((a[0] + b[0]) / 2 - cx, 0.0, (a[2] + b[2]) / 2 - cz))
            self.quad(a, b, ring1[(k + 1) % sides], ring1[k], mat, colour=colour, facing=out)
        if top and rt > 0:
            self.face(ring1, mat, colour=colour, facing=UP)

    def board(self, centre, facing, width, height, mat, uv=(0.0, 0.0, 1.0, 1.0), back='apex_graphite', colour=None):
        """A flat sign: the image on the side facing `facing`, plain behind."""
        n = Vector(facing).normalized()
        right = UP.cross(n).normalized() * (width / 2)
        up = UP * (height / 2)
        c = Vector(centre)
        u0, v0, u1, v1 = uv
        points = (c - right - up, c + right - up, c + right + up, c - right + up)
        self.face(points, mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), colour, facing=n)
        if back is not None:
            self.face(points, back, None, None, facing=-n)

    def build(self, smooth=False):
        if not self.faces:
            return None
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.verts, [], self.faces)
        for name in self.materials:
            mesh.materials.append(MATERIALS[name])
        mesh.polygons.foreach_set('material_index', self.mats)
        uv_layer = mesh.uv_layers.new(name='UVMap')
        uv_layer.data.foreach_set('uv', [c for uv in self.uvs for c in uv])
        colours = mesh.color_attributes.new(name='Col', type='BYTE_COLOR', domain='CORNER')
        colours.data.foreach_set('color', [c for colour in self.cols for c in colour])
        # Weld coincident corners; each face keeps its own UVs and colours.
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set('use_smooth', [smooth] * len(mesh.polygons))
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = group(self.parent)
        return obj


def chunked(prefix, materials, parent):
    """One builder per chunk of rows."""
    return {chunk: MeshBuilder(f'{prefix}_{chunk:02d}', materials, parent) for chunk in range((N + CHUNK - 1) // CHUNK)}


def build_all(builders, smooth=False):
    for builder in builders.values():
        builder.build(smooth)


# Space taken by buildings, so trees and other things stay clear of them.
CELL = 6.0
OCCUPIED = set()


def occupy(x, z, radius):
    r = int(math.ceil(radius / CELL))
    cx, cz = int(math.floor(x / CELL)), int(math.floor(z / CELL))
    for i in range(cx - r, cx + r + 1):
        for j in range(cz - r, cz + r + 1):
            OCCUPIED.add((i, j))


def is_free(x, z):
    return (int(math.floor(x / CELL)), int(math.floor(z / CELL))) not in OCCUPIED


# --------------------------------------------------------------- terrain ----
CENTRE_TREE = kdtree.KDTree(N)
for index, (x, y, z, _tx, _tz) in enumerate(CENTRE):
    CENTRE_TREE.insert((x, z, 0.0), index)
CENTRE_TREE.balance()
MEAN_Y = sum(row[1] for row in CENTRE) / N

xs = [row[0] for row in CENTRE]
zs = [row[2] for row in CENTRE]
MIDDLE = ((min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2)
BOUNDS = (min(xs) - 420, max(xs) + 420, min(zs) - 420, max(zs) + 420)


def nearest_row(x, z):
    (_, index, distance) = CENTRE_TREE.find((x, z, 0.0))
    return index, distance


def side_of(x, z):
    """Nearest row, which side of it the point is on, and how far out."""
    index, _ = nearest_row(x, z)
    (cx, _, cz), _, (nx, nz) = frame(index)
    lateral = (x - cx) * nx + (z - cz) * nz
    return index, (1 if lateral >= 0 else -1), abs(lateral)


def room_out(row, side, start, limit=260.0):
    """How far out from the centreline, on one side of a row, the ground stays
    clear of every other part of the circuit (keeping 30 m from it)."""
    d = start
    while d < limit:
        x, _, z = at(row, side * d)
        index, distance = nearest_row(x, z)
        if abs(((index - wrap(row)) + N // 2) % N - N // 2) > 40 and distance < 30:
            return max(start, d - 30)
        if not (BOUNDS[0] + 60 < x < BOUNDS[1] - 60 and BOUNDS[2] + 60 < z < BOUNDS[3] - 60):
            return d
        d += 4.0
    return limit


def ground_height(x, z):
    """Terrain height: the track's own level near it, easing to the mean far away."""
    index, distance = nearest_row(x, z)
    near = CENTRE[index][1]
    blend = min(1.0, max(0.0, (distance - 160.0) / 300.0))
    blend = blend * blend * (3 - 2 * blend)
    undulation = 1.6 * math.sin(x * 0.006 + 1.3) * math.sin(z * 0.005 + 0.4) * blend
    return near + (MEAN_Y - near) * blend + undulation - 0.18


LAKE = None


def find_lake():
    """The widest open space inside the circuit's bounds."""
    best = (0.0, None)
    for gx in range(int(min(xs)), int(max(xs)), 20):
        for gz in range(int(min(zs)), int(max(zs)), 20):
            d = nearest_row(gx, gz)[1]
            if d > best[0]:
                best = (d, (gx, gz))
    distance, centre = best
    radius = min(140.0, distance - 70.0)
    return (centre[0], centre[1], radius) if radius > 35 else None


def lake_shore(angle):
    return LAKE[2] * (1 + 0.14 * math.sin(angle * 3 + 1.1) + 0.06 * math.sin(angle * 7 + 0.3))


def lake_depth(x, z):
    if LAKE is None:
        return 0.0
    d = math.hypot(x - LAKE[0], z - LAKE[1])
    shore = lake_shore(math.atan2(z - LAKE[1], x - LAKE[0]))
    return 2.4 * min(1.0, max(0.0, (shore + 12 - d) / 30))


def build_terrain():
    cell = 10.0
    x0, x1, z0, z1 = BOUNDS
    nx = int((x1 - x0) / cell) + 1
    nz = int((z1 - z0) / cell) + 1
    tiles = 4  # per side, so the game culls what is behind the camera
    builders = {(a, b): MeshBuilder(f'terrain_{a}{b}', ['apex_ground'], 'ground') for a in range(tiles) for b in range(tiles)}
    heights = {}
    for i in range(nx):
        for j in range(nz):
            x = x0 + i * cell
            z = z0 + j * cell
            edge = min(i, j, nx - 1 - i, nz - 1 - j)
            y = ground_height(x, z) - lake_depth(x, z)
            if edge < 4:
                y -= (4 - edge) * 2.5  # fall away under the horizon plane
            heights[(i, j)] = (x, y, z)
    for i in range(nx - 1):
        for j in range(nz - 1):
            tile = builders[(min(tiles - 1, i * tiles // (nx - 1)), min(tiles - 1, j * tiles // (nz - 1)))]
            tile.quad(heights[(i, j)], heights[(i + 1, j)], heights[(i + 1, j + 1)], heights[(i, j + 1)], facing=UP)
    for builder in builders.values():
        builder.build(smooth=True)

    # The plain beyond, out to the skyline.
    horizon = MeshBuilder('horizon', ['apex_ground'], 'ground')
    level = MEAN_Y - 3.0
    inner = [(x0 + 30, level, z0 + 30), (x1 - 30, level, z0 + 30), (x1 - 30, level, z1 - 30), (x0 + 30, level, z1 - 30)]
    cx, cz = MIDDLE
    outer = [(cx + (p[0] - cx) * 9, level - 6, cz + (p[2] - cz) * 9) for p in inner]
    for k in range(4):
        horizon.quad(inner[k], inner[(k + 1) % 4], outer[(k + 1) % 4], outer[k], facing=UP)
    horizon.build()

    if LAKE is not None:
        water = MeshBuilder('lake', ['apex_water'], 'ground')
        cx, cz, _ = LAKE
        level = ground_height(cx, cz) - 0.55
        steps = 72
        for k in range(steps):
            a0 = k / steps * math.tau
            a1 = (k + 1) / steps * math.tau
            r0, r1 = lake_shore(a0) + 8, lake_shore(a1) + 8
            water.face(((cx, level, cz), (cx + math.cos(a0) * r0, level, cz + math.sin(a0) * r0),
                        (cx + math.cos(a1) * r1, level, cz + math.sin(a1) * r1)), facing=UP)
        water.build()
        occupy(cx, cz, LAKE[2] + 14)


# ----------------------------------------------------------- road & verges --
def build_road():
    """The asphalt under the generated racing surface."""
    builders = chunked('road', ['apex_road'], 'track')
    for i in range(N):
        b = builders[i // CHUNK]
        b.quad(at(i, -7.6, -0.02), at(i, 7.6, -0.02), at(i + 1, 7.6, -0.02), at(i + 1, -7.6, -0.02), facing=UP)
    build_all(builders)


def pit_frame(k):
    x, y, z, tx, tz, _ = PIT[max(0, min(len(PIT) - 1, int(k)))]
    return Vector((x, y, z)), Vector((tx, 0.0, tz)), Vector((-tz, 0.0, tx)) * PIT_SIDE


def pit_at(k, lateral, lift=0.0):
    """A point beside the pit lane: positive lateral is away from the track."""
    p, _, away = pit_frame(k)
    return tuple(p + away * lateral + UP * lift)


def pit_lerp(position, lateral, lift=0.0):
    k = math.floor(position)
    t = position - k
    a, b = Vector(pit_at(k, lateral, lift)), Vector(pit_at(k + 1, lateral, lift))
    return tuple(a + (b - a) * t)


def build_pit_lane():
    lane = MeshBuilder('pit_lane', ['apex_pitlane', 'apex_paint'], 'track')
    half = PIT_HALF + 0.6
    white = srgb('#f2f2ee')
    amber = srgb('#ffb82e')
    for k in range(len(PIT) - 1):
        lane.quad(pit_at(k, -half, -0.035), pit_at(k, half, -0.035), pit_at(k + 1, half, -0.035), pit_at(k + 1, -half, -0.035), 0, facing=UP)
        # Edge lines, and the line between the fast lane and the working lane.
        for lateral, width in ((-half + 0.35, 0.2), (half - 0.35, 0.2), (0.4, 0.15)):
            lane.quad(pit_at(k, lateral - width / 2, -0.028), pit_at(k, lateral + width / 2, -0.028),
                      pit_at(k + 1, lateral + width / 2, -0.028), pit_at(k + 1, lateral - width / 2, -0.028), 1, colour=white, facing=UP)
    # Pit entry and exit lines across the lane, in amber.
    for k in (PIT_SEPARATED[0], PIT_SEPARATED[-1]):
        lane.quad(pit_at(k, -half, -0.026), pit_at(k, half, -0.026), pit_lerp(k + 0.3, half, -0.026),
                  pit_lerp(k + 0.3, -half, -0.026), 1, colour=amber, facing=UP)
    lane.build()


def build_kerbs():
    """Red and white kerbs in one-metre blocks with a raised profile."""
    builders = chunked('kerb', ['apex_kerb'], 'track')
    profile = ((6.8, 0.0), (7.05, 0.035), (7.6, 0.05), (7.85, 0.03), (8.0, 0.0))
    red, white = srgb('#c8102e'), srgb('#f3f3f0')
    for side in (1, -1):
        for i in range(N):
            if not kerbed(side, i):
                continue
            b = builders[i // CHUNK]
            for half in (0, 1):
                position = i + half * 0.5
                colour = red if (i * 2 + half) % 2 == 0 else white
                for k in range(len(profile) - 1):
                    (l0, h0), (l1, h1) = profile[k], profile[k + 1]
                    b.quad(lerp_at(position, side * l0, h0), lerp_at(position, side * l1, h1),
                           lerp_at(position + 0.5, side * l1, h1), lerp_at(position + 0.5, side * l0, h0),
                           colour=colour, facing=UP)
    build_all(builders)


def build_verges():
    """Grass, asphalt run-off with a painted band, and gravel traps, from the
    kerb (or road edge) out to the barrier."""
    builders = chunked('verge', ['apex_grass', 'apex_runoff', 'apex_gravel', 'apex_paint'], 'track')
    amber, graphite = srgb('#ffb82e'), srgb('#20252d')
    for side in (1, -1):
        for i in range(N):
            b = builders[i // CHUNK]
            kind = runoff(side, i)
            inner0 = 8.0 if kerbed(side, i) else 7.6
            inner1 = 8.0 if kerbed(side, i + 1) else 7.6
            outer0 = wall(side, i) + STANDOFF + 0.3
            outer1 = wall(side, i + 1) + STANDOFF + 0.3

            def strip(l0a, l0b, l1a, l1b, mat, lift=-0.03, colour=None):
                b.quad(at(i, side * l0a, lift), at(i, side * l1a, lift), at(i + 1, side * l1b, lift), at(i + 1, side * l0b, lift),
                       mat, colour=colour, facing=UP)

            if kind == 'o':
                strip(inner0, inner1, outer0 + 4, outer1 + 4, 1, -0.06)
            elif kind in ('a', 'p'):
                band = min(1.2, outer0 - inner0 - 0.5)
                # A painted run-off band in APEX amber and graphite, 4 m blocks.
                strip(inner0, inner1, inner0 + band, inner1 + band, 3, -0.025, amber if (i // 2) % 2 == 0 else graphite)
                strip(inner0 + band, inner1 + band, outer0, outer1, 1)
            elif kind == 'r':
                strip(inner0, inner1, inner0 + 3.0, inner1 + 3.0, 1)
                strip(inner0 + 3.0, inner1 + 3.0, outer0, outer1, 2, -0.09)
            else:
                strip(inner0, inner1, outer0, outer1, 0)
    build_all(builders)


# ---------------------------------------------------------------- barriers --
WRAP_LENGTH = 8.8  # metres per banner image (8:1 at 1.1 m tall)


def build_barriers():
    """Concrete walls carrying APEX banners, amber and graphite energy-absorbing
    blocks in front of them where cars arrive fast, steel posts and debris
    fencing above. The pit wall is the same wall with a taller fence."""
    wraps = ['poster_wrap-navy', 'poster_wrap-white', 'poster_wrap-amber']
    walls = chunked('barrier', ['apex_concrete', 'apex_tecpro', 'apex_steel', *wraps], 'barriers')
    fences = chunked('fence', ['apex_fence'], 'fences')
    amber, graphite = srgb('#ffb82e'), srgb('#1d232c')
    for side in (1, -1):
        along = 0.0
        for i in range(N):
            if runoff(side, i) == 'o' or runoff(side, i + 1) == 'o':
                along += STEP
                continue
            b = walls[i // CHUNK]
            f = fences[i // CHUNK]
            face0 = wall(side, i) + STANDOFF
            face1 = wall(side, i + 1) + STANDOFF
            inward = tuple(-normal(i) * side)
            outward = tuple(normal(i) * side)
            blocks = tecpro(side, i)
            if blocks:
                colour = amber if i % 2 == 0 else graphite
                top = 1.0
                b.quad(at(i, side * face0, -0.2), at(i + 1, side * face1, -0.2), at(i + 1, side * face1, top), at(i, side * face0, top),
                       1, colour=colour, facing=inward)
                b.quad(at(i, side * face0, top), at(i + 1, side * face1, top), at(i + 1, side * (face1 + 1.0), top), at(i, side * (face0 + 1.0), top),
                       1, colour=scale_colour(colour, 0.85), facing=UP)
                if not tecpro(side, i + 1):
                    b.quad(at(i + 1, side * face1, -0.2), at(i + 1, side * (face1 + 1.0), -0.2), at(i + 1, side * (face1 + 1.0), top),
                           at(i + 1, side * face1, top), 1, colour=colour, facing=tuple(tangent(i)))
                if not tecpro(side, i - 1):
                    b.quad(at(i, side * face0, -0.2), at(i, side * (face0 + 1.0), -0.2), at(i, side * (face0 + 1.0), top),
                           at(i, side * face0, top), 1, colour=colour, facing=tuple(-tangent(i)))
                wall0, wall1 = face0 + 1.0, face1 + 1.0
            else:
                wall0, wall1 = face0, face1
            height = 1.1
            thick = 0.5
            u0 = -side * along / WRAP_LENGTH
            u1 = -side * (along + STEP) / WRAP_LENGTH
            wrap_mat = 3 + (int(along // (WRAP_LENGTH * 4)) + (0 if side > 0 else 1)) % 3
            b.quad(at(i, side * wall0, -0.4), at(i + 1, side * wall1, -0.4), at(i + 1, side * wall1, height), at(i, side * wall0, height),
                   0 if blocks else wrap_mat, uv=((u0, -0.3), (u1, -0.3), (u1, 1.0), (u0, 1.0)), facing=inward)
            b.quad(at(i, side * wall0, height), at(i + 1, side * wall1, height), at(i + 1, side * (wall1 + thick), height),
                   at(i, side * (wall0 + thick), height), 0, facing=UP)
            b.quad(at(i, side * (wall0 + thick), -0.4), at(i + 1, side * (wall1 + thick), -0.4), at(i + 1, side * (wall1 + thick), height),
                   at(i, side * (wall0 + thick), height), 0, facing=outward)
            fence_height = 4.2 if runoff(side, i) == 'p' else 3.2
            f.quad(at(i, side * (wall0 + 0.3), height), at(i + 1, side * (wall1 + 0.3), height),
                   at(i + 1, side * (wall1 + 0.3), height + fence_height), at(i, side * (wall0 + 0.3), height + fence_height),
                   uv=((along, 0.0), (along + STEP, 0.0), (along + STEP, fence_height), (along, fence_height)))
            if i % 2 == 0:
                base = Vector(at(i, side * (wall0 + 0.36), height))
                top_point = base + UP * fence_height - normal(i) * side * 0.45
                b.beam(base, base + UP * (fence_height - 0.4), 0.09, 2)
                b.beam(base + UP * (fence_height - 0.4), top_point, 0.08, 2)
            along += STEP
    build_all(walls)
    build_all(fences)


# -------------------------------------------------------------- grandstands --
STAND_PALETTES = {
    'main': ['#16213f', '#eef0f3', '#16213f'],
    'corner': ['#ffb82e', '#1d232c', '#ffb82e'],
}
SHIRTS = [('#d4002b', 14), ('#ff8000', 10), ('#1e2a5a', 10), ('#3e8ede', 8), ('#f2f2f2', 14), ('#151515', 12),
          ('#1f7a4d', 5), ('#f5c400', 6), ('#f58cc4', 3), ('#8a8f99', 6), ('#ffb82e', 8), ('#00a19c', 4)]
SHIRT_POOL = [colour for colour, weight in SHIRTS for _ in range(weight)]


def stand_profile(tiers, depth):
    """Section through a grandstand: (distance back from the front, height)
    points along the seating surface, the seat rows, and which segments are
    fascias between tiers."""
    points = [(0.0, -0.5), (0.0, 2.0)]
    rows = []
    fascias = set()
    d, h = 0.0, 2.0
    tier_depth = depth / tiers
    for k in range(tiers):
        rise = 0.36 + 0.09 * k
        tread = 0.85
        if k == 0:
            d += 0.9
            points.append((d, h))
        count = max(3, int((tier_depth - (0.9 if k == 0 else 0.0)) / tread))
        for r in range(count):
            points.append((d, h + rise))
            h += rise
            rows.append((d, h, k, len(rows)))
            points.append((d + tread, h))
            d += tread
        if k < tiers - 1:
            fascias.add(len(points) - 1)  # segment from this point up
            points.append((d, h + 2.6))
            h += 2.6
            points.append((d + 1.2, h))  # concourse
            d += 1.2
    return points, rows, fascias, d, h


def smooth_series(values, reach):
    peak = [max(values[max(0, k - reach):k + reach + 1]) for k in range(len(values))]
    out = []
    for k in range(len(peak)):
        window = peak[max(0, k - reach):k + reach + 1]
        out.append(sum(window) / len(window))
    return out


def build_stands():
    built = []
    for stand in LAYOUT['grandstands']:
        side = stand['side']
        start = row_of(stand['from'])
        count = (row_of(stand['to']) - start) % N
        main = stand['id'] == 'main'
        front = [barrier_back(side, start + k) + stand['setback'] for k in range(count + 1)]
        front = [max(front)] * len(front) if main else smooth_series(front, 12)
        room = min(clearance(side, start + k) - front[k] for k in range(count + 1))
        depth = min(stand['depth'], room - 6)
        if depth < 9:
            print(f"  stand {stand['id']}: no room ({room:.0f} m)")
            continue
        points, rows, fascias, back, top = stand_profile(stand['tiers'], depth)
        palette = [srgb(c) for c in STAND_PALETTES['main' if main else 'corner']]
        b = MeshBuilder(f"stand_{stand['id']}", ['apex_concrete', 'apex_seat', 'poster_wrap-navy', 'poster_wrap-amber',
                                                'poster_stand-back', 'apex_concrete_dark', 'apex_white', 'apex_graphite',
                                                'apex_led_amber', 'apex_steel'], 'stands')

        def F(position):
            k = max(0.0, min(float(count), position - start))
            k0 = int(math.floor(k))
            k1 = min(count, k0 + 1)
            return front[k0] + (front[k1] - front[k0]) * (k - k0)

        def P(position, d, h):
            return lerp_at(position, side * (F(position) + d), h)

        samples = list(range(start, start + count, 2)) + [start + count]
        seat_rows = {(d, h): (k, n) for d, h, k, n in rows}
        for s in range(len(samples) - 1):
            r0, r1 = samples[s], samples[s + 1]
            along0 = (r0 - start) * STEP
            along1 = (r1 - start) * STEP
            inward = tuple(-normal(r0) * side)
            for j in range(len(points) - 1):
                (d0, h0), (d1, h1) = points[j], points[j + 1]
                quad = (P(r0, d0, h0), P(r1, d0, h0), P(r1, d1, h1), P(r0, d1, h1))
                vertical = abs(d1 - d0) < 1e-6
                if j == 0 or j in fascias:
                    # Front wall and tier fascias carry banners.
                    span = h1 - h0
                    wl = span * 8
                    uv = ((-side * along0 / wl, 0.0), (-side * along1 / wl, 0.0), (-side * along1 / wl, 1.0), (-side * along0 / wl, 1.0))
                    b.quad(*quad, 2 if j == 0 else 3, uv=uv, facing=inward)
                elif vertical:
                    k, n = seat_rows.get((d1, h1), (0, 1))
                    colour = palette[min(k, len(palette) - 1)]
                    if n % 6 == 0:
                        colour = srgb('#ffb82e') if main else srgb('#eef0f3')
                    b.quad(*quad, 1, colour=colour, facing=inward)
                else:
                    b.quad(*quad, 0, facing=UP)
            # Back wall: the stand's outside face carries APEX artwork.
            wl = (top + 0.5) * 4
            uv = ((side * along0 / wl, 0.0), (side * along1 / wl, 0.0), (side * along1 / wl, 1.0), (side * along0 / wl, 1.0))
            b.quad(P(r0, back, -0.5), P(r1, back, -0.5), P(r1, back, top), P(r0, back, top), 4, uv=uv, facing=tuple(normal(r0) * side))
            b.quad(P(r0, back, top), P(r1, back, top), P(r1, back + 0.4, top), P(r0, back + 0.4, top), 5, facing=UP)
        # End walls follow the section.
        for end, facing in ((start, -tangent(start)), (start + count, tangent(start + count))):
            outline = [P(end, d, h) for d, h in points] + [P(end, back, top), P(end, back, -0.5)]
            b.face(outline, 5, facing=tuple(facing))
        roof_stand(b, stand, side, start, count, samples, P, back, top, depth)
        b.build()
        crowd_stand(stand, side, start, count, rows, F)
        for k in range(0, count + 1, 3):
            c = at(start + k, side * (front[k] + back / 2))
            occupy(c[0], c[2], back / 2 + 8)
        built.append(stand['id'])
    print('  stands:', ', '.join(built))


def roof_stand(b, stand, side, start, count, samples, P, back, top, depth):
    white, graphite, led, steel = 6, 7, 8, 9
    if stand['roof'] == 'wing':
        # A cantilevered blade on masts, rising towards the track.
        rear, front_d = back + 2.0, depth * 0.08
        h_rear, h_front, thick = top + 4.5, top + 7.0, 0.8
        for s in range(len(samples) - 1):
            r0, r1 = samples[s], samples[s + 1]
            top_q = (P(r0, front_d, h_front), P(r1, front_d, h_front), P(r1, rear, h_rear), P(r0, rear, h_rear))
            bottom_q = (P(r0, front_d, h_front - thick), P(r1, front_d, h_front - thick), P(r1, rear, h_rear - thick), P(r0, rear, h_rear - thick))
            b.quad(*top_q, white, facing=UP)
            b.quad(*bottom_q, 0, facing=-UP)
            b.quad(top_q[0], top_q[1], bottom_q[1], bottom_q[0], led, facing=tuple(-normal(r0) * side))
            b.quad(top_q[3], top_q[2], bottom_q[2], bottom_q[3], graphite, facing=tuple(normal(r0) * side))
        for end, facing in ((start, -tangent(start)), (start + count, tangent(start + count))):
            b.quad(P(end, front_d, h_front), P(end, rear, h_rear), P(end, rear, h_rear - thick), P(end, front_d, h_front - thick),
                   graphite, facing=tuple(facing))
        for k in range(0, count + 1, 12):
            r = start + k
            base = Vector(P(r, back + 1.0, -0.5))
            mast_top = Vector(P(r, back + 1.0, h_rear + 10))
            b.beam(base, mast_top, 0.7, steel)
            b.beam(mast_top, Vector(P(r, depth * 0.3, h_front - (h_front - h_rear) * 0.3)), 0.18, steel)
            b.beam(mast_top, Vector(P(r, back + 14, -0.3)), 0.18, steel)
    else:
        # A curved shell on columns along the back.
        front_d, rear = depth * 0.12, back + 1.0
        h_front, h_rear, bulge, thick = top + 2.2, top + 3.4, 2.8, 0.45
        steps = 8

        def arc(t, lower):
            d = front_d + (rear - front_d) * t
            h = h_front + (h_rear - h_front) * t + bulge * math.sin(math.pi * t) - (thick if lower else 0)
            return d, h

        for s in range(len(samples) - 1):
            r0, r1 = samples[s], samples[s + 1]
            for k in range(steps):
                (da, ha), (db, hb) = arc(k / steps, False), arc((k + 1) / steps, False)
                b.quad(P(r0, da, ha), P(r1, da, ha), P(r1, db, hb), P(r0, db, hb), white, facing=UP)
                (da, ha), (db, hb) = arc(k / steps, True), arc((k + 1) / steps, True)
                b.quad(P(r0, da, ha), P(r1, da, ha), P(r1, db, hb), P(r0, db, hb), 0, facing=-UP)
            (da, ha), (da2, ha2) = arc(0, False), arc(0, True)
            b.quad(P(r0, da, ha), P(r1, da, ha), P(r1, da2, ha2), P(r0, da2, ha2), led, facing=tuple(-normal(r0) * side))
        for k in range(0, count + 1, 6):
            r = start + k
            d, h = arc(1.0, True)
            b.beam(Vector(P(r, back + 0.6, -0.5)), Vector(P(r, back + 0.6, h)), 0.5, steel)


def crowd_stand(stand, side, start, count, rows, F):
    """People: one card each, facing the track, about three in four seats taken."""
    b = MeshBuilder(f"crowd_{stand['id']}", ['apex_crowd'], 'crowd')
    length = count * STEP
    spacing = 0.56
    half = 0.27 / STEP
    for (d, h, k, n) in rows:
        m = 0.4
        while m < length - 0.4:
            if (m % 24.0) < 1.4:  # aisles
                m += spacing
                continue
            if RNG.random() < 0.78:
                position = start + m / STEP
                lateral = side * (F(position) + d + 0.35)
                standing = RNG.random() < 0.12
                base = h + (0.25 if standing else 0.1)
                card = 1.35 if standing else 1.12
                cell = RNG.randrange(16)
                u0, u1 = (cell % 8) / 8 + 0.002, (cell % 8 + 1) / 8 - 0.002
                v0, v1 = (cell // 8) / 2 + 0.002, (cell // 8 + 1) / 2 - 0.002
                if RNG.random() < 0.5:
                    u0, u1 = u1, u0  # mirror half the people
                jitter = RNG.uniform(-0.06, 0.06) / STEP
                shirt = srgb(RNG.choice(SHIRT_POOL))
                # The viewer's left, seen from the track, is along +side * tangent.
                left = lerp_at(position + side * half + jitter, lateral, base)
                right = lerp_at(position - side * half + jitter, lateral, base)
                b.quad(left, right, (right[0], right[1] + card, right[2]), (left[0], left[1] + card, left[2]),
                       0, uv=((u0, v0), (u1, v0), (u1, v1), (u0, v1)), colour=shirt, facing=tuple(-normal(int(position)) * side))
            m += spacing + RNG.uniform(-0.04, 0.04)
    b.build()


# ------------------------------------------------------------ pit building --
# The lane runs straight between ramps from the track edge; build along the straight part.
PIT_SEPARATED = [k for k, sample in enumerate(PIT) if sample[5]]
PIT_FIRST, PIT_LAST = PIT_SEPARATED[0] + 14, PIT_SEPARATED[-1] - 14
LANE_EDGE = PIT_HALF + 0.9
BUILDING_DEPTH = 24.0
TEAMS = 8
BAY = 6  # segments per team: pillar, door, door, pillar, door, door
GARAGE_FIRST = PIT_FIRST + (PIT_LAST - PIT_FIRST - TEAMS * BAY) // 2
DOOR_SLOTS = (1, 2, 4, 5)


def build_pit_building():
    """Team garages along the pit lane, offices and hospitality above and a
    canopy roof over the pit lane, its edge lit."""
    first, last = PIT_FIRST, PIT_LAST
    lane_edge, depth = LANE_EDGE, BUILDING_DEPTH
    b = MeshBuilder('pit_building', ['apex_white', 'apex_interior', 'apex_glass', 'apex_graphite', 'apex_led_amber',
                                     'apex_led_white', 'poster_garages', 'apex_concrete', 'apex_trim', 'apex_steel'], 'pit')
    white, interior, glass, graphite, led, led_white, signs, concrete, trim, steel = range(10)

    def towards_lane(k):
        return tuple(-pit_frame(k)[2])

    def away(k):
        return tuple(pit_frame(k)[2])

    def Q(k0, k1, l0, l1, h0, h1):
        """A vertical quad between two pit samples at laterals l0/l1 past the lane edge."""
        return (pit_at(k0, lane_edge + l0, h0), pit_at(k1, lane_edge + l1, h0), pit_at(k1, lane_edge + l1, h1), pit_at(k0, lane_edge + l0, h1))

    for k in range(first, last):
        g = k - GARAGE_FIRST
        in_garages = 0 <= g < TEAMS * BAY
        slot = g % BAY if in_garages else -1
        door = slot in DOOR_SLOTS
        if in_garages:
            team = g // BAY
            if door:
                b.quad(*Q(k, k + 1, 1.0, 1.0, 0.0, 4.6), interior, facing=towards_lane(k))
                b.quad(*Q(k, k + 1, 0.95, 0.95, 4.3, 4.6), led_white, facing=towards_lane(k))
                b.quad(pit_at(k, lane_edge, 4.6), pit_at(k + 1, lane_edge, 4.6), pit_at(k + 1, lane_edge + 1.0, 4.6),
                       pit_at(k, lane_edge + 1.0, 4.6), white, facing=-UP)
                # Reveals where a door meets a pillar.
                for edge, neighbour, direction in ((k, slot - 1, 1), (k + 1, slot + 1, -1)):
                    if neighbour not in DOOR_SLOTS:
                        b.quad(pit_at(edge, lane_edge, 0.0), pit_at(edge, lane_edge + 1.0, 0.0), pit_at(edge, lane_edge + 1.0, 4.6),
                               pit_at(edge, lane_edge, 4.6), white, facing=tuple(pit_frame(edge)[1] * direction))
            else:
                b.quad(*Q(k, k + 1, 0.0, 0.0, 0.0, 4.6), white, facing=towards_lane(k))
            b.quad(*Q(k, k + 1, 0.0, 0.0, 4.6, 7.2), white, facing=towards_lane(k))
            if 1 <= slot <= 4:
                col, row = team % 2, team // 2
                cu0, cu1 = col / 2, (col + 1) / 2
                cv0, cv1 = 1 - (row + 1) / 4, 1 - row / 4
                t0, t1 = (slot - 1) / 4, slot / 4
                if PIT_SIDE > 0:
                    t0, t1 = 1 - t0, 1 - t1
                b.quad(*Q(k, k + 1, -0.06, -0.06, 4.9, 6.9), signs,
                       uv=((cu0 + (cu1 - cu0) * t0, cv0), (cu0 + (cu1 - cu0) * t1, cv0), (cu0 + (cu1 - cu0) * t1, cv1), (cu0 + (cu1 - cu0) * t0, cv1)),
                       facing=towards_lane(k))
            # A team-coloured line along the foot of each garage.
            b.quad(*Q(k, k + 1, -0.02, -0.02, 0.0, 0.25), trim, colour=srgb(TEAM_COLOURS[team]), facing=towards_lane(k))
        else:
            b.quad(*Q(k, k + 1, 0.0, 0.0, 0.0, 4.6), glass, facing=towards_lane(k))
            b.quad(*Q(k, k + 1, 0.0, 0.0, 4.6, 7.2), white, facing=towards_lane(k))
        # First floor: glass between white slab edges.
        b.quad(*Q(k, k + 1, 0.0, 0.0, 7.2, 7.8), white, facing=towards_lane(k))
        b.quad(*Q(k, k + 1, 0.0, 0.0, 7.8, 11.4), glass, facing=towards_lane(k))
        b.quad(*Q(k, k + 1, 0.0, 0.0, 11.4, 12.0), white, facing=towards_lane(k))
        # Terrace and second floor set back.
        b.quad(pit_at(k, lane_edge, 12.0), pit_at(k + 1, lane_edge, 12.0), pit_at(k + 1, lane_edge + 3.0, 12.0),
               pit_at(k, lane_edge + 3.0, 12.0), concrete, facing=UP)
        b.quad(*Q(k, k + 1, 0.05, 0.05, 12.0, 13.1), glass, facing=towards_lane(k))
        b.quad(*Q(k, k + 1, 3.0, 3.0, 12.0, 16.0), glass, facing=towards_lane(k))
        # Canopy roof reaching out over the pit lane.
        b.quad(pit_at(k, lane_edge - 4.5, 16.8), pit_at(k + 1, lane_edge - 4.5, 16.8), pit_at(k + 1, lane_edge + depth + 1, 16.8),
               pit_at(k, lane_edge + depth + 1, 16.8), white, facing=UP)
        b.quad(pit_at(k, lane_edge - 4.5, 16.0), pit_at(k + 1, lane_edge - 4.5, 16.0), pit_at(k + 1, lane_edge + depth + 1, 16.0),
               pit_at(k, lane_edge + depth + 1, 16.0), graphite, facing=-UP)
        b.quad(*Q(k, k + 1, -4.5, -4.5, 16.0, 16.8), led, facing=towards_lane(k))
        b.quad(*Q(k, k + 1, depth + 1, depth + 1, 16.0, 16.8), graphite, facing=away(k))
        # Back face to the paddock.
        b.quad(*Q(k, k + 1, depth, depth, -0.5, 7.5), white, facing=away(k))
        b.quad(*Q(k, k + 1, depth, depth, 7.5, 14.5), glass, facing=away(k))
        b.quad(*Q(k, k + 1, depth, depth, 14.5, 16.0), white, facing=away(k))
        if k % 3 == 0:
            for lift in (7.8, 12.0):
                b.beam(pit_at(k, lane_edge - 0.05, lift), pit_at(k, lane_edge - 0.05, lift + (3.6 if lift < 10 else 1.1)), 0.14, steel)
    # End walls.
    for k, sign in ((first, -1), (last, 1)):
        outline = [pit_at(k, lane_edge, -0.5), pit_at(k, lane_edge + depth, -0.5), pit_at(k, lane_edge + depth, 16.0), pit_at(k, lane_edge, 16.0)]
        b.face(outline, white, facing=tuple(pit_frame(k)[1] * sign))
    b.build()
    for k in range(first, last, 3):
        c = pit_at(k, lane_edge + depth / 2)
        occupy(c[0], c[2], depth / 2 + 6)


def build_pit_wall_stands():
    """Each team's stand on the pit wall, opposite its garage."""
    b = MeshBuilder('pit_wall_stands', ['apex_graphite', 'apex_trim', 'apex_steel', 'apex_glass', 'apex_white'], 'pit')
    side = PIT_SIDE
    for team in range(TEAMS):
        k = GARAGE_FIRST + team * BAY + BAY // 2
        p = pit_at(k, 0.0)
        row, _ = nearest_row(p[0], p[2])
        # Standing on the pit wall itself, so the fast lane stays clear.
        deep = 1.3
        start = wall(side, row) + STANDOFF + 0.25 - deep / 2
        centre = Vector(at(row, side * (start + deep / 2), 0.0))
        t, n = tangent(row), normal(row)
        yaw = math.atan2(t.z, t.x)
        b.box(tuple(centre + UP * 2.25), (6.0, 2.1, deep), yaw, 0)
        b.box(tuple(centre + UP * 3.45), (6.6, 0.25, deep + 0.6), yaw, 4)
        b.box(tuple(centre + UP * 1.12), (6.0, 0.16, deep), yaw, 1, colour=srgb(TEAM_COLOURS[team]))
        for u in (-2.6, 2.6):
            leg = centre + t * u
            b.beam(tuple(leg), tuple(leg + UP * 1.2), 0.12, 2)
        towards = -n * side
        b.board(tuple(centre + UP * 2.5 + towards * (deep / 2 + 0.02)), tuple(towards), 5.0, 0.9, 3, back=None)
    b.build()


def build_paddock():
    """Team hospitality units and the race control tower behind the pits, and
    a big screen on the pit roof facing the main grandstand."""
    first, last = PIT_FIRST, PIT_LAST
    back = LANE_EDGE + BUILDING_DEPTH
    b = MeshBuilder('paddock', ['apex_runoff', 'apex_white', 'apex_glass', 'apex_graphite', 'apex_trim', 'apex_led_amber',
                                'apex_steel', 'poster_screen'], 'pit')
    asphalt, white, glass, graphite, trim, led, steel, screen = range(8)
    paddock_depth = 66.0
    for k in range(first, last, 2):
        k1 = min(k + 2, last)
        b.quad(pit_at(k, back, 0.05), pit_at(k1, back, 0.05), pit_at(k1, back + paddock_depth, 0.05),
               pit_at(k, back + paddock_depth, 0.05), asphalt, facing=UP)
    unit = 13
    n = 0
    for k in range(first + 3, last - unit, unit + 2):
        mid = k + unit // 2
        _, t, _ = pit_frame(mid)
        yaw = math.atan2(t.z, t.x)
        for row, offset in enumerate((back + 16.0, back + 46.0)):
            centre = Vector(pit_at(mid, offset, 0.0))
            colour = srgb(TEAM_COLOURS[(n * 2 + row) % len(TEAM_COLOURS)])
            length = unit * 2 - 4
            b.box(tuple(centre + UP * 2.0), (length, 4.0, 13.0), yaw, glass)
            b.box(tuple(centre + UP * 4.3), (length + 1, 0.6, 14.0), yaw, white)
            b.box(tuple(centre + UP * 6.5), (length - 1, 3.8, 11.0), yaw, glass)
            b.box(tuple(centre + UP * 8.7), (length + 2, 0.6, 15.0), yaw, white)
            b.box(tuple(centre + UP * 8.25), (length + 2.1, 0.3, 15.1), yaw, trim, colour=colour)
            b.box(tuple(centre + UP * 9.05), (length + 1.9, 0.1, 15.05), yaw, led, faces=('front', 'back', 'left', 'right'))
            occupy(centre.x, centre.z, 16)
        n += 1
    # Race control tower, in the middle of the paddock.
    k = (first + last) // 2
    base = Vector(pit_at(k, back + 31.0, 0.0))
    b.prism(tuple(base), 4.2, -0.5, 30.0, 8, white)
    b.prism(tuple(base), 4.5, 6.0, 6.6, 8, graphite)
    b.prism(tuple(base), 8.5, 30.0, 31.0, 12, white, radius_top=9.0)
    b.prism(tuple(base), 9.0, 31.0, 36.5, 12, glass, top=False, radius_top=9.6)
    b.prism(tuple(base), 9.6, 36.5, 37.6, 12, white, radius_top=9.0)
    b.prism(tuple(base), 9.65, 36.9, 37.2, 12, led, top=False, radius_top=9.65)
    b.beam(tuple(base + UP * 37.6), tuple(base + UP * 52.0), 0.5, steel)
    occupy(base.x, base.z, 14)
    # Big screen on the pit roof, facing the main grandstand.
    middle = (first + last) // 2 + 20
    _, t, away = pit_frame(middle)
    p = Vector(pit_at(middle, LANE_EDGE + 6.0, 16.8))
    facing = -away
    yaw = math.atan2(t.z, t.x)
    for u in (-6.0, 6.0):
        leg = p + t * u
        b.beam(tuple(leg), tuple(leg + UP * 3.4), 0.4, steel)
    centre = p + UP * 8.4
    b.box(tuple(centre - facing * 0.45), (17.2, 10.6, 0.8), yaw, graphite)
    b.board(tuple(centre), tuple(facing), 16.0, 9.0, screen, back=None)
    b.build()
    for k in range(first, last, 4):
        c = pit_at(k, back + paddock_depth / 2)
        occupy(c[0], c[2], paddock_depth / 2 + 4)


def build_pit_signs():
    b = MeshBuilder('pit_signs', ['poster_pit-signs', 'apex_graphite', 'apex_steel'], 'signage')
    entries = ((PIT_SEPARATED[0] + 1, 0.0, 0.5, 6.0, 1.5), (PIT_SEPARATED[0] + 8, 0.5, 0.75, 1.6, 1.6), (PIT_SEPARATED[-1] - 2, 0.75, 1.0, 3.0, 3.0))
    for k, u0, u1, width, height in entries:
        _, t, away = pit_frame(k)
        base = Vector(pit_at(k, LANE_EDGE + 0.8, 0.0))
        facing = (-t * 0.9 - away * 0.3).normalized()
        b.board(tuple(base + UP * (2.6 + height / 2)), tuple(facing), width, height, 0, uv=(u0, 0.0, u1, 1.0), back=1)
        b.beam(tuple(base), tuple(base + UP * 2.6), 0.14, 2)
    b.build()


def build_pit_outer_wall():
    """A low wall on the far side of the pit lane where there is no building."""
    b = MeshBuilder('pit_outer_wall', ['poster_wrap-white', 'apex_concrete'], 'barriers')
    lateral = LANE_EDGE
    along = 0.0
    for k in list(range(PIT_SEPARATED[0], PIT_FIRST)) + list(range(PIT_LAST, PIT_SEPARATED[-1])):
        u0, u1 = -PIT_SIDE * along / WRAP_LENGTH, -PIT_SIDE * (along + 2) / WRAP_LENGTH
        b.quad(pit_at(k, lateral, -0.4), pit_at(k + 1, lateral, -0.4), pit_at(k + 1, lateral, 1.1), pit_at(k, lateral, 1.1), 0,
               uv=((u0, -0.3), (u1, -0.3), (u1, 1.0), (u0, 1.0)), facing=tuple(-pit_frame(k)[2]))
        b.quad(pit_at(k, lateral, 1.1), pit_at(k + 1, lateral, 1.1), pit_at(k + 1, lateral + 0.5, 1.1), pit_at(k, lateral + 0.5, 1.1), 1, facing=UP)
        b.quad(pit_at(k, lateral + 0.5, -0.4), pit_at(k + 1, lateral + 0.5, -0.4), pit_at(k + 1, lateral + 0.5, 1.1),
               pit_at(k, lateral + 0.5, 1.1), 1, facing=tuple(pit_frame(k)[2]))
        along += 2
    b.build()


# -------------------------------------------------------------- structures --
def build_gantry():
    """The start gantry over the grid, with its five columns of lights."""
    row = row_of(LAYOUT['gantry']['fraction'])
    b = MeshBuilder('start_gantry', ['apex_graphite', 'apex_steel', 'poster_wrap-navy', 'apex_led_amber',
                                     *[f'apex_gantry_light_{n}' for n in range(1, 6)]], 'gantry')
    t, n = tangent(row), normal(row)
    yaw = math.atan2(t.z, t.x)
    left = wall(1, row) + STANDOFF + 0.9
    right = -(wall(-1, row) + STANDOFF + 0.9)
    for lateral in (left, right):
        b.box(at(row, lateral, 3.4), (1.0, 7.8, 1.0), yaw, 0)
    span = left - right
    span_centre = Vector(at(row, (left + right) / 2, 7.4))
    b.box(tuple(span_centre), (1.0, 1.4, span + 1.0), yaw, 0)
    b.box(tuple(span_centre + UP * 0.75), (1.1, 0.1, span + 1.1), yaw, 3)
    for direction in (-1, 1):
        b.board(tuple(span_centre + t * direction * 0.52), tuple(t * direction), span - 0.4, 1.2, 2,
                uv=(0.0, 0.0, span / (1.2 * 8), 1.0), back=None)
    # Light pods: light 1 on the drivers' left, which is the negative lateral side.
    for light in range(5):
        lateral = -2.8 + 1.4 * light
        pod = Vector(at(row, lateral, 5.6))
        b.box(tuple(pod), (0.5, 1.9, 0.75), yaw, 0)
        b.beam(tuple(pod + UP * 0.95), tuple(pod + UP * 1.12), 0.2, 1)
        for lamp in range(4):
            centre = pod - t * 0.26 + UP * (0.66 - lamp * 0.44)
            ring = [tuple(centre + n * (math.cos(a) * 0.17) + UP * (math.sin(a) * 0.17)) for a in (k / 12 * math.tau for k in range(12))]
            b.face(ring, 4 + light, facing=tuple(-t))
    b.build()
    for lateral in (left, right):
        p = at(row, lateral)
        occupy(p[0], p[2], 4)


def build_bridges():
    b = MeshBuilder('bridges', ['apex_white', 'apex_graphite', 'poster_bridge', 'apex_led_amber', 'apex_glass', 'apex_steel'], 'bridges')
    for bridge in LAYOUT['bridges']:
        row = row_of(bridge['fraction'])
        t = tangent(row)
        yaw = math.atan2(t.z, t.x)
        left = barrier_back(1, row) + 7.0
        right = -(barrier_back(-1, row) + 7.0)
        span = left - right
        centre = Vector(at(row, (left + right) / 2, 7.9))
        b.box(tuple(centre), (4.2, 1.4, span), yaw, 0)
        b.box(tuple(centre + UP * 0.75), (4.0, 0.1, span), yaw, 1, faces=('top',))
        for direction in (-1, 1):
            panel = centre + UP * 1.75 + t * direction * 2.12
            b.board(tuple(panel), tuple(t * direction), span, 2.1, 2, uv=(0.0, 0.0, span / 16.8, 1.0), back=4)
            b.box(tuple(centre - UP * 0.72 + t * direction * 2.05), (0.12, 0.08, span), yaw, 3, faces=('front', 'back', 'bottom'))
        # Stair towers at both ends.
        for lateral in (left - 3.0, right + 3.0):
            tower = Vector(at(row, lateral, 0.0))
            b.box(tuple(tower + UP * 4.6), (6.0, 10.2, 6.0), yaw, 0)
            b.box(tuple(tower + UP * 9.8), (6.4, 0.3, 6.4), yaw, 1)
            b.box(tuple(tower + UP * 5.0 - t * 3.02), (0.04, 8.0, 3.6), yaw, 4)
            occupy(tower.x, tower.z, 8)
    b.build()


def build_marshal_posts():
    b = MeshBuilder('marshal_posts', ['apex_white', 'apex_graphite', 'apex_marshal_light', 'apex_steel', 'apex_glass'], 'trackside')
    for post in LAYOUT['marshals']:
        row = row_of(post['fraction'])
        side = post['side']
        if runoff(side, row) in ('o', 'p'):
            side = -side  # not in the pit lane
        t, n = tangent(row), normal(row)
        yaw = math.atan2(t.z, t.x)
        c = Vector(at(row, side * (barrier_back(side, row) + 2.2), 0.0))
        towards = -n * side
        b.box(tuple(c + UP * 1.3), (2.4, 2.6, 2.0), yaw, 0)
        b.box(tuple(c + UP * 2.7), (2.9, 0.2, 2.5), yaw, 1)
        b.board(tuple(c + UP * 1.7 + towards * 1.02), tuple(towards), 1.8, 0.8, 4, back=None)
        b.board(tuple(c + UP * 3.25 + towards * 0.9), tuple(towards), 0.9, 0.5, 2, back=1)
        b.beam(tuple(c + UP * 2.8 + towards * 0.9), tuple(c + UP * 3.0 + towards * 0.9), 0.1, 3)
        occupy(c.x, c.z, 4)
    b.build()


def build_billboards():
    b = MeshBuilder('billboards', ['apex_steel', 'apex_graphite', *[f'poster_{name}' for name in BILLBOARDS]], 'signage')
    for board in LAYOUT['billboards']:
        row = row_of(board['fraction'])
        side = board['side']
        facing = approach_normal(row, side, 0.5)
        for shift in (0, -15, 15, -30, 30, -45):
            base = Vector(at(row + shift, side * (barrier_back(side, row + shift) + 7.0), 0.0))
            if is_free(base.x, base.z) and is_free(*(lambda p: (p[0], p[2]))(at(row + shift, side * (barrier_back(side, row + shift) + 14.0)))):
                row += shift
                break
        else:
            continue  # grandstands all round here
        facing = approach_normal(row, side, 0.5)
        right = UP.cross(facing).normalized()
        for u in (-4.0, 4.0):
            leg = base + right * u
            b.beam(tuple(leg - UP * 0.5), tuple(leg + UP * 9.0), 0.35, 0)
        centre = base + UP * 6.0
        b.box(tuple(centre - facing * 0.25), (12.4, 6.4, 0.4), math.atan2(right.z, right.x), 1)
        b.board(tuple(centre), tuple(facing), 12.0, 6.0, 2 + board['poster'] % len(BILLBOARDS), back=None)
        occupy(base.x, base.z, 8)
    b.build()


def build_trackside_boards():
    """Braking distance boards, DRS boards and corner numbers."""
    b = MeshBuilder('trackside_boards', ['poster_distance', 'poster_drs', 'poster_turns', 'apex_graphite', 'apex_steel'], 'signage')

    def mounted(row, side, mat, uv, width, height, lift=1.15):
        if runoff(side, row) == 'o':
            return  # no wall to stand on at the pit entry and exit
        facing = approach_normal(row, side, 0.25)
        base = Vector(at(row, side * (wall(side, row) + STANDOFF + (1.0 if tecpro(side, row) else 0.0) + 0.25), 0.0))
        b.beam(tuple(base + UP * lift), tuple(base + UP * (lift + 0.4)), 0.1, 4)
        b.board(tuple(base + UP * (lift + 0.4 + height / 2)), tuple(facing), width, height, mat, uv=uv, back=3)

    for board in LAYOUT['brakingBoards']:
        row = row_of(board['fraction'])
        for k in range(3):  # 300, 200, 100
            mounted(row - 50 * (2 - k), board['side'], 0, (k / 3, 0.0, (k + 1) / 3, 1.0), 1.7, 1.7)
    for zone in LAYOUT['zones']:
        mounted(row_of(zone['start']), -1, 1, (0.0, 0.0, 1.0, 1.0), 3.0, 1.5)
    for corner in LAYOUT['corners']:
        number = corner['number']
        col, line = (number - 1) % 5, (number - 1) // 5
        mounted(row_of(corner['fraction']) - 22, -corner['side'], 2, (col / 5, 1 - (line + 1) / 4, (col + 1) / 5, 1 - line / 4), 2.2, 2.2)
    b.build()


def build_screens():
    """A big screen across the track from each corner grandstand."""
    b = MeshBuilder('screens', ['apex_steel', 'apex_graphite', 'poster_screen'], 'signage')
    for stand in LAYOUT['grandstands']:
        if stand['id'] == 'main':
            continue
        start = row_of(stand['from'])
        count = (row_of(stand['to']) - start) % N
        row = wrap(start + count // 2)
        side = -stand['side']
        if clearance(side, row) - barrier_back(side, row) < 26:
            continue
        base = Vector(at(row, side * (barrier_back(side, row) + 9.0), 0.0))
        if not is_free(base.x, base.z):
            continue
        facing = -normal(row) * side
        right = UP.cross(facing).normalized()
        for u in (-4.5, 4.5):
            leg = base + right * u
            b.beam(tuple(leg - UP * 0.5), tuple(leg + UP * 7.0), 0.4, 0)
        centre = base + UP * 10.5
        b.box(tuple(centre - facing * 0.4), (13.0, 8.0, 0.7), math.atan2(right.z, right.x), 1)
        b.board(tuple(centre), tuple(facing), 12.0, 6.75, 2, back=None)
        occupy(base.x, base.z, 9)
    b.build()


def build_camera_towers():
    """Scaffold towers for the TV cameras, on the outside of each corner."""
    b = MeshBuilder('camera_towers', ['apex_steel', 'apex_white', 'apex_graphite'], 'trackside')
    for corner in LAYOUT['corners']:
        side = -corner['side']
        row = row_of(corner['fraction']) + 12
        base = Vector(at(row, side * (barrier_back(side, row) + 5.0), 0.0))
        if not is_free(base.x, base.z):
            continue
        t, n = tangent(row), normal(row)
        yaw = math.atan2(t.z, t.x)
        corners = [base + t * u + n * w for u, w in ((-1.1, -1.1), (1.1, -1.1), (1.1, 1.1), (-1.1, 1.1))]
        for k, c in enumerate(corners):
            b.beam(tuple(c - UP * 0.3), tuple(c + UP * 9.6), 0.12, 0)
            nxt = corners[(k + 1) % 4]
            for lift in (0.4, 3.6, 6.8):
                b.beam(tuple(c + UP * lift), tuple(nxt + UP * (lift + 3.2)), 0.06, 0)
        b.box(tuple(base + UP * 7.0), (2.6, 0.2, 2.6), yaw, 1)
        b.box(tuple(base + UP * 9.7), (2.9, 0.15, 2.9), yaw, 1)
        towards = -n * side
        b.box(tuple(base + UP * 7.95 + towards * 0.4), (0.45, 0.5, 0.9), math.atan2(towards.z, towards.x), 2)
        occupy(base.x, base.z, 3)
    b.build()


def build_marquees():
    """Hospitality marquees behind each corner grandstand."""
    b = MeshBuilder('marquees', ['apex_white', 'apex_trim', 'apex_graphite'], 'stands')
    amber = srgb('#ffb82e')
    for stand in LAYOUT['grandstands']:
        if stand['id'] == 'main':
            continue
        side = stand['side']
        start = row_of(stand['from'])
        count = (row_of(stand['to']) - start) % N
        for k in (count // 5, count // 2, 4 * count // 5):
            row = start + k
            lateral = barrier_back(side, row) + stand['setback'] + stand['depth'] + 22
            if clearance(side, row) - lateral < 10:
                continue
            c = Vector(at(row, side * lateral, 0.0))
            if not is_free(c.x, c.z):
                continue
            t = tangent(row)
            yaw = math.atan2(t.z, t.x)
            b.box(tuple(c + UP * 1.4), (12.0, 3.2, 10.0), yaw, 0)
            b.box(tuple(c + UP * 3.05), (12.1, 0.18, 10.1), yaw, 1, colour=amber, faces=('front', 'back', 'left', 'right'))
            # A peaked roof.
            n = normal(row)
            apex = c + UP * 6.4
            eaves = [c + UP * 3.0 + t * u + n * w for u, w in ((-6.3, -5.3), (6.3, -5.3), (6.3, 5.3), (-6.3, 5.3))]
            for e in range(4):
                b.face((tuple(eaves[e]), tuple(eaves[(e + 1) % 4]), tuple(apex)), 0, facing=tuple((eaves[e] + eaves[(e + 1) % 4]) / 2 - c))
            occupy(c.x, c.z, 9)
    b.build()


def build_spectator_banks():
    """Grass banks for general admission, on the outside of corners with room
    to spare, with people standing on them."""
    bank = MeshBuilder('spectator_banks', ['apex_grass'], 'ground')
    people = MeshBuilder('crowd_banks', ['apex_crowd'], 'crowd')
    profile = ((0.0, -0.3), (2.0, 0.2), (12.0, 3.6), (16.0, 3.8), (21.0, -0.3))
    made = 0
    taken = []
    # Search the lap for open ground on either side, a few hundred metres apart.
    for first, side in ((r, sd) for r in range(0, N, 30) for sd in (1, -1)):
        if made >= 7 or any(abs(((first - t) + N // 2) % N - N // 2) < 220 for t in taken):
            continue
        rows = list(range(first, first + 55))
        if any(runoff(side, r) in ('p', 'o') for r in rows):
            continue
        # Behind the billboards and marshal posts that stand just past the barrier.
        lateral0 = [barrier_back(side, r) + 15.0 for r in rows]
        room = min(room_out(r, side, lateral0[k]) - lateral0[k] for k, r in enumerate(rows) if k % 6 == 0)
        if room < 24:
            continue
        blocked = sum(not is_free(*(lambda p: (p[0], p[2]))(at(r, side * (lateral0[k] + d)))) for k, r in enumerate(rows) if k % 6 == 0 for d in (4.0, 10.0, 17.0))
        if blocked:
            continue
        taken.append(first)
        front = smooth_series(lateral0, 8)
        for k in range(len(rows) - 1):
            r0, r1 = rows[k], rows[k + 1]
            for j in range(len(profile) - 1):
                (d0, h0), (d1, h1) = profile[j], profile[j + 1]
                bank.quad(at(r0, side * (front[k] + d0), h0), at(r1, side * (front[k + 1] + d0), h0),
                          at(r1, side * (front[k + 1] + d1), h1), at(r0, side * (front[k] + d1), h1), facing=UP)
        # People on the slope facing the track.
        for k in range(len(rows) - 1):
            for d in np.arange(2.6, 12.0, 0.95):
                m = 0.0
                while m < STEP:
                    if RNG.random() < 0.55:
                        position = rows[k] + (m + RNG.uniform(-0.15, 0.15)) / STEP
                        f = front[k]
                        h = 0.2 + (d - 2.0) / 10.0 * 3.4
                        lateral = side * (f + d + RNG.uniform(-0.2, 0.2))
                        cell = RNG.randrange(16)
                        u0, u1 = (cell % 8) / 8 + 0.002, (cell % 8 + 1) / 8 - 0.002
                        v0, v1 = (cell // 8) / 2 + 0.002, (cell // 8 + 1) / 2 - 0.002
                        half = 0.27 / STEP
                        left = lerp_at(position + side * half, lateral, h)
                        right = lerp_at(position - side * half, lateral, h)
                        card = RNG.uniform(1.55, 1.8)
                        people.quad(left, right, (right[0], right[1] + card, right[2]), (left[0], left[1] + card, left[2]), 0,
                                    uv=((u0, v0), (u1, v0), (u1, v1), (u0, v1)), colour=srgb(RNG.choice(SHIRT_POOL)),
                                    facing=tuple(-normal(rows[k]) * side))
                    m += 0.7
        for r in rows[::4]:
            p = at(r, side * (front[0] + 10.0))
            occupy(p[0], p[2], 13)
        made += 1
    bank.build(smooth=True)
    people.build()
    print(f'  spectator banks: {made}')


def build_car_park():
    """A car park behind the main grandstand."""
    stand = next((s for s in LAYOUT['grandstands'] if s['id'] == 'main'), None)
    if stand is None:
        return
    side = stand['side']
    start = row_of(stand['from'])
    count = (row_of(stand['to']) - start) % N
    rows = list(range(start + 6, start + count - 6))
    near = max(barrier_back(side, r) for r in rows) + stand['setback'] + stand['depth'] + 26
    far = min(min(room_out(r, side, near) for r in rows[::10]) - 8, near + 70)
    if far - near < 24:
        print('  car park: no room')
        return
    b = MeshBuilder('car_park', ['apex_runoff', 'apex_paint', 'apex_trim', 'apex_glass'], 'scenery')
    white = srgb('#e8e8e4')
    paints = [srgb(c) for c in ('#f2f2f2', '#1b1b1b', '#9aa1aa', '#3a3f47', '#b0181e', '#1d3f8a', '#c9c3b8', '#5c6670', '#ffffff', '#0f2a1d')]
    for k in range(0, len(rows) - 2, 2):
        r0, r1 = rows[k], rows[k + 2]
        b.quad(at(r0, side * near, 0.04), at(r1, side * near, 0.04), at(r1, side * far, 0.04), at(r0, side * far, 0.04), 0, facing=UP)
    # Bays in double rows, 5 m deep, with a 7 m aisle between each pair.
    lane = near + 4.0
    while lane + 10 < far:
        for bay_row in (0, 1):
            depth0 = lane + bay_row * 5.0
            position = rows[0] + 1.0
            while position < rows[-1] - 1:
                b.quad(lerp_at(position, side * depth0, 0.05), lerp_at(position + 0.06, side * depth0, 0.05),
                       lerp_at(position + 0.06, side * (depth0 + 5.0), 0.05), lerp_at(position, side * (depth0 + 5.0), 0.05),
                       1, colour=white, facing=UP)
                if RNG.random() < 0.72:
                    centre = Vector(lerp_at(position + 0.65, side * (depth0 + 2.5), 0.0))
                    t = tangent(int(position))
                    yaw = math.atan2(t.z, t.x) + math.pi / 2 + RNG.uniform(-0.04, 0.04)
                    paint = RNG.choice(paints)
                    b.box(tuple(centre + UP * 0.7), (4.4, 0.8, 1.8), yaw, 2, colour=paint)
                    b.box(tuple(centre + UP * 1.35), (2.4, 0.55, 1.6), yaw, 3)
                position += 2.6 / STEP
        lane += 17.0
    b.build()
    for r in rows[::4]:
        p = at(r, side * (near + far) / 2)
        occupy(p[0], p[2], (far - near) / 2 + 4)
    print(f'  car park: {far - near:.0f} m deep')


# ------------------------------------------------------------------ nature --
def unit_icosphere():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    verts = [tuple(v.co) for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def build_trees():
    sphere_verts, sphere_faces = unit_icosphere()
    greens = [srgb(c) for c in ('#3f6b2a', '#4d7a31', '#5a8a3a', '#355c27', '#6b8f3e', '#2f5234')]
    x0, x1, z0, z1 = BOUNDS
    tile_size = 500.0
    tiles = {}

    def tile_of(x, z):
        key = (int((x - x0) // tile_size), int((z - z0) // tile_size))
        if key not in tiles:
            tiles[key] = (MeshBuilder(f'trees_{key[0]}{key[1]}', ['apex_leaves', 'apex_trunk'], 'nature'),)
        return tiles[key][0]
    placed = 0
    attempts = 0
    while placed < 2600 and attempts < 200000:
        attempts += 1
        x = RNG.uniform(x0 + 40, x1 - 40)
        z = RNG.uniform(z0 + 40, z1 - 40)
        # Woods and copses where two slow patterns agree; a few lone trees elsewhere.
        pattern = (math.sin(x * 0.011 + 0.7) * math.sin(z * 0.009 + 2.1) + 0.6 * math.sin(x * 0.027 - z * 0.019 + 1.3)) / 1.6
        density = min(1.0, max(0.0, (pattern - 0.05) / 0.35))
        if RNG.random() > density * 0.95 + 0.012:
            continue
        index, side, lateral = side_of(x, z)
        if lateral < barrier_back(side, index) + 9 or nearest_row(x, z)[1] < 18:
            continue
        if not is_free(x, z) or lake_depth(x, z) > 0:
            continue
        y = ground_height(x, z)
        height = RNG.uniform(6.0, 13.0) * (1.25 if nearest_row(x, z)[1] > 220 else 1.0)
        trunk_r = 0.18 + height * 0.015
        canopies = trunks = tile_of(x, z)
        if RNG.random() < 0.65:
            # Broadleaf: a lumpy round crown.
            radius = height * RNG.uniform(0.32, 0.42)
            crown_y = y + height - radius
            trunks.prism((x, y, z), trunk_r, y - 0.3, crown_y, 6, 1, top=False, radius_top=trunk_r * 0.7)
            colour = RNG.choice(greens)
            seed = RNG.random() * 100
            squash = RNG.uniform(0.8, 1.0)
            points = []
            for vx, vy, vz in sphere_verts:
                wobble = 1 + 0.13 * math.sin(vx * 5.1 + seed) * math.sin(vy * 4.3 + seed * 0.7) + 0.07 * math.sin(vz * 7.7 + seed)
                points.append((x + vx * radius * wobble, crown_y + vz * radius * squash * wobble, z + vy * radius * wobble))
            for face in sphere_faces:
                tri = [points[k] for k in face]
                mid_y = sum(p[1] for p in tri) / 3
                light = 0.75 + 0.4 * (mid_y - crown_y + radius) / (2 * radius)
                centroid = sum((Vector(p) for p in tri), Vector()) / 3
                canopies.face(tri, 0, colour=scale_colour(colour, light), facing=tuple(centroid - Vector((x, crown_y, z))))
        else:
            # Conifer-like: stacked cones.
            radius = height * RNG.uniform(0.2, 0.26)
            trunks.prism((x, y, z), trunk_r, y - 0.3, y + height * 0.3, 6, 1, top=False)
            colour = scale_colour(RNG.choice(greens), 0.8)
            for tier in range(3):
                base_y = y + height * (0.22 + tier * 0.22)
                r = radius * (1 - tier * 0.25)
                tip = (x, base_y + height * 0.42, z)
                ring = [(x + math.cos(k / 9 * math.tau) * r, base_y, z + math.sin(k / 9 * math.tau) * r) for k in range(9)]
                for k in range(9):
                    a, c = ring[k], ring[(k + 1) % 9]
                    canopies.face((a, c, tip), 0, colour=scale_colour(colour, 0.9 + 0.2 * tier),
                                  facing=(a[0] + c[0] - 2 * x, 0.6, a[2] + c[2] - 2 * z))
                canopies.face(ring, 0, colour=scale_colour(colour, 0.6), facing=-UP)
        occupy(x, z, 2)
        placed += 1
    for (builder,) in tiles.values():
        builder.build(smooth=True)
    print(f'  trees: {placed} in {len(tiles)} tiles')


def build_skyline():
    """A city on the horizon in every direction, taller towards the east."""
    b = MeshBuilder('skyline', ['apex_city', 'apex_led_white', 'apex_led_amber'], 'skyline')
    tones = [srgb(c) for c in ('#9aa6b4', '#b8c0c8', '#7e8a99', '#c9c3b8', '#8d97a6', '#a7b3c2', '#6f7c8c')]
    cx, cz = MIDDLE
    base = MEAN_Y - 9
    for k in range(340):
        angle = RNG.uniform(0, math.tau)
        east = 0.5 + 0.5 * math.cos(angle - 0.4)
        distance = RNG.uniform(1700, 3300)
        height = min(360.0, 25 + RNG.paretovariate(2.2) * 30 * (0.6 + 1.4 * east))
        width = RNG.uniform(22, 60)
        deep = RNG.uniform(22, 60)
        x = cx + math.cos(angle) * distance
        z = cz + math.sin(angle) * distance
        yaw = RNG.uniform(0, math.pi)
        colour = RNG.choice(tones)
        b.box((x, base + height / 2, z), (width, height, deep), yaw, 0, colour=colour, faces=('top', 'front', 'back', 'left', 'right'))
        if height > 120:
            # A slimmer crown and a light on top.
            b.box((x, base + height + 8, z), (width * 0.6, 16, deep * 0.6), yaw, 0, colour=scale_colour(colour, 1.1),
                  faces=('top', 'front', 'back', 'left', 'right'))
            b.box((x, base + height + 16.75, z), (width * 0.2, 1.5, deep * 0.2), yaw, 1 if RNG.random() < 0.6 else 2)
    # A few landmark towers together in the east.
    for offset, height, radius in ((0, 470, 22), (140, 420, 26), (-160, 380, 20), (260, 300, 18)):
        angle = 0.4 + offset / 2600
        x = cx + math.cos(angle) * 2600
        z = cz + math.sin(angle) * 2600
        b.prism((x, 0, z), radius, base, base + height * 0.85, 8, 0, colour=tones[1], radius_top=radius * 0.65)
        b.prism((x, 0, z), radius * 0.65, base + height * 0.85, base + height, 8, 0, colour=tones[5], radius_top=radius * 0.15)
        b.prism((x, 0, z), radius * 0.75, base + height * 0.6, base + height * 0.61, 8, 1, top=False, radius_top=radius * 0.74)
    b.build()


# ------------------------------------------------------------------- main ---
def main():
    global LAKE
    reset_scene()
    define_materials()
    LAKE = find_lake()
    print('lake', LAKE)
    steps = [
        ('terrain', build_terrain), ('road', build_road), ('pit lane', build_pit_lane), ('kerbs', build_kerbs),
        ('verges', build_verges), ('barriers', build_barriers), ('pit building', build_pit_building),
        ('pit wall stands', build_pit_wall_stands), ('paddock', build_paddock), ('pit signs', build_pit_signs),
        ('pit outer wall', build_pit_outer_wall), ('stands', build_stands), ('gantry', build_gantry),
        ('bridges', build_bridges), ('marshal posts', build_marshal_posts), ('billboards', build_billboards),
        ('boards', build_trackside_boards), ('screens', build_screens), ('camera towers', build_camera_towers),
        ('marquees', build_marquees), ('spectator banks', build_spectator_banks), ('car park', build_car_park),
        ('trees', build_trees), ('skyline', build_skyline),
    ]
    for name, step in steps:
        print('building', name, flush=True)
        step()
    root = bpy.data.objects.new('apex_circuit', None)
    bpy.context.scene.collection.objects.link(root)
    for empty in GROUPS.values():
        empty.parent = root
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    faces = sum(len(o.data.polygons) for o in meshes)
    verts = sum(len(o.data.vertices) for o in meshes)
    print(f'objects {len(meshes)}, faces {faces}, vertices {verts}')
    bpy.ops.wm.save_as_mainfile(filepath=str(BUILD / 'shanghai-apex.blend'))
    bpy.ops.export_scene.gltf(
        filepath=str(BUILD / 'shanghai-apex.glb'),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_vertex_color='MATERIAL',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    print('wrote', BUILD / 'shanghai-apex.glb')


main()
