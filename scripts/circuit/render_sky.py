"""
Renders the sky over the APEX Shanghai circuit in Blender.

A physically based atmosphere (Blender's multiple-scattering sky) with fair-
weather cumulus drawn on a cloud deck, the sun placed exactly where the game's
sun light shines from. Rendered with Cycles as an equirectangular panorama and
remapped to three.js's panorama orientation, so the sun in the picture and the
sun that casts the shadows agree.

Run with Blender's Python (the bpy module) or Blender itself:
  python scripts/circuit/render_sky.py
  blender --background --python scripts/circuit/render_sky.py

Writes work/track-build/sky.png (4096 x 2048) and prints the horizon colour
for the fog that should melt into it.
"""

import math
import os
from pathlib import Path

import bpy  # first: the bpy module makes mathutils importable
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'work' / 'track-build'
WIDTH, HEIGHT = (int(v) for v in os.environ.get('SKY_SIZE', '4096x2048').split('x'))

# The game's sun (src/scene/Environment.tsx), in game coordinates, +Y up.
SUN_GAME = Vector((620.0, 780.0, 420.0)).normalized()


def game_to_blender(v):
    return Vector((v.x, -v.z, v.y))


SUN = game_to_blender(SUN_GAME)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.render.film_transparent = False
    camera_data = bpy.data.cameras.new('panorama')
    camera_data.type = 'PANO'
    camera_data.panorama_type = 'EQUIRECTANGULAR'
    camera = bpy.data.objects.new('panorama', camera_data)
    camera.rotation_euler = (math.pi / 2, 0.0, 0.0)  # level, looking along +Y
    scene.collection.objects.link(camera)
    scene.camera = camera
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    scene.world = world
    return scene, world


def render(scene, width, height, samples, path, file_format='PNG'):
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.render.image_settings.file_format = file_format
    if file_format == 'OPEN_EXR':
        scene.render.image_settings.color_depth = '32'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)[::-1]  # rows top-down
    bpy.data.images.remove(image)
    return pixels


def clear(world):
    nodes = world.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new('ShaderNodeOutputWorld')
    background = nodes.new('ShaderNodeBackground')
    world.node_tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    return nodes, world.node_tree.links, background


def direction_map(scene, world, width, height):
    """Which way each pixel of the panorama looks, as Blender directions."""
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = 0.0
    nodes, links, background = clear(world)
    coords = nodes.new('ShaderNodeTexCoord')
    links.new(coords.outputs['Generated'], background.inputs['Color'])
    background.inputs['Strength'].default_value = 1.0
    pixels = render(scene, width, height, 1, BUILD / 'sky-directions.exr', 'OPEN_EXR')
    dirs = pixels[..., :3]
    return dirs / np.linalg.norm(dirs, axis=-1, keepdims=True)


def build_sky(world, sun_rotation):
    nodes, links, background = clear(world)
    sky = nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_disc = True
    sky.sun_size = math.radians(0.75)
    sky.sun_intensity = 0.35
    sky.sun_elevation = math.asin(SUN.z)
    sky.sun_rotation = sun_rotation
    sky.altitude = 40.0
    sky.air_density = 1.0
    sky.aerosol_density = 1.2  # a little haze, as over a city
    sky.ozone_density = 1.0

    coords = nodes.new('ShaderNodeTexCoord')
    split = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coords.outputs['Generated'], split.inputs['Vector'])
    # The atmosphere is black below the horizon: look it up just above instead,
    # so the haze carries on down until the ground takes over.
    raised = nodes.new('ShaderNodeCombineXYZ')
    links.new(split.outputs['X'], raised.inputs['X'])
    links.new(split.outputs['Y'], raised.inputs['Y'])
    floor_z = nodes.new('ShaderNodeMath')
    floor_z.operation = 'MAXIMUM'
    floor_z.inputs[1].default_value = 0.004
    links.new(split.outputs['Z'], floor_z.inputs[0])
    links.new(floor_z.outputs[0], raised.inputs['Z'])
    unit = nodes.new('ShaderNodeVectorMath')
    unit.operation = 'NORMALIZE'
    links.new(raised.outputs['Vector'], unit.inputs[0])
    links.new(unit.outputs[0], sky.inputs[0])

    def math_node(operation, a, b=None, value_b=None):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        links.new(a, node.inputs[0])
        if b is not None:
            links.new(b, node.inputs[1])
        elif value_b is not None:
            node.inputs[1].default_value = value_b
        return node.outputs[0]

    # Project the view direction onto a cloud deck overhead.
    lift = math_node('ADD', split.outputs['Z'], value_b=0.07)
    px = math_node('DIVIDE', split.outputs['X'], lift)
    py = math_node('DIVIDE', split.outputs['Y'], lift)
    deck = nodes.new('ShaderNodeCombineXYZ')
    links.new(px, deck.inputs['X'])
    links.new(py, deck.inputs['Y'])
    deck.inputs['Z'].default_value = 0.37

    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '3D'
    noise.inputs['Scale'].default_value = 1.1
    noise.inputs['Detail'].default_value = 9.0
    noise.inputs['Roughness'].default_value = 0.58
    noise.inputs['Distortion'].default_value = 0.25
    links.new(deck.outputs['Vector'], noise.inputs['Vector'])
    coverage = nodes.new('ShaderNodeMapRange')
    coverage.interpolation_type = 'SMOOTHSTEP'
    coverage.inputs['From Min'].default_value = 0.51
    coverage.inputs['From Max'].default_value = 0.68
    links.new(noise.outputs['Fac'], coverage.inputs['Value'])

    # Fade the deck out towards the horizon, where it would be hazed away.
    horizon = nodes.new('ShaderNodeMapRange')
    horizon.interpolation_type = 'SMOOTHSTEP'
    horizon.inputs['From Min'].default_value = 0.015
    horizon.inputs['From Max'].default_value = 0.22
    links.new(split.outputs['Z'], horizon.inputs['Value'])
    density = math_node('MULTIPLY', coverage.outputs['Result'], horizon.outputs['Result'])
    density = math_node('MULTIPLY', density, value_b=0.92)

    # Clouds: bright tops, greyer where thick, brightest round the sun.
    detail = nodes.new('ShaderNodeTexNoise')
    detail.inputs['Scale'].default_value = 4.5
    detail.inputs['Detail'].default_value = 6.0
    links.new(deck.outputs['Vector'], detail.inputs['Vector'])
    shade = nodes.new('ShaderNodeMapRange')
    shade.inputs['From Min'].default_value = 0.3
    shade.inputs['From Max'].default_value = 0.75
    shade.inputs['To Min'].default_value = 0.62
    shade.inputs['To Max'].default_value = 1.0
    links.new(detail.outputs['Fac'], shade.inputs['Value'])
    towards_sun = nodes.new('ShaderNodeVectorMath')
    towards_sun.operation = 'DOT_PRODUCT'
    towards_sun.inputs[1].default_value = tuple(SUN)
    links.new(coords.outputs['Generated'], towards_sun.inputs[0])
    glow = nodes.new('ShaderNodeMapRange')
    glow.inputs['From Min'].default_value = 0.6
    glow.inputs['From Max'].default_value = 1.0
    glow.inputs['To Min'].default_value = 1.0
    glow.inputs['To Max'].default_value = 1.6
    links.new(towards_sun.outputs['Value'], glow.inputs['Value'])
    brightness = math_node('MULTIPLY', shade.outputs['Result'], glow.outputs['Result'])
    brightness = math_node('MULTIPLY', brightness, value_b=CLOUD_LEVEL)
    cloud = nodes.new('ShaderNodeCombineColor')
    for channel, scale in (('Red', 1.0), ('Green', 0.985), ('Blue', 0.96)):
        links.new(math_node('MULTIPLY', brightness, value_b=scale), cloud.inputs[channel])

    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    links.new(density, mix.inputs['Factor'])
    links.new(sky.outputs['Color'], mix.inputs['A'])
    links.new(cloud.outputs['Color'], mix.inputs['B'])
    # Below the horizon: the haze, then a dull ground for the cars to reflect.
    below = nodes.new('ShaderNodeMapRange')
    below.interpolation_type = 'SMOOTHSTEP'
    below.inputs['From Min'].default_value = 0.0
    below.inputs['From Max'].default_value = -0.14
    links.new(split.outputs['Z'], below.inputs['Value'])
    ground = nodes.new('ShaderNodeMix')
    ground.data_type = 'RGBA'
    links.new(below.outputs['Result'], ground.inputs['Factor'])
    links.new(mix.outputs['Result'], ground.inputs['A'])
    ground.inputs['B'].default_value = (GROUND_LEVEL * 0.42, GROUND_LEVEL * 0.47, GROUND_LEVEL * 0.38, 1.0)
    links.new(ground.outputs['Result'], background.inputs['Color'])
    background.inputs['Strength'].default_value = 1.0
    return sky


CLOUD_LEVEL = float(os.environ.get('SKY_CLOUDS', '15'))
SATURATION = float(os.environ.get('SKY_SATURATION', '1.3'))
GROUND_LEVEL = float(os.environ.get('SKY_GROUND', '3'))


def tone_map(scene):
    # AgX rolls the bright horizon and the sun's glow off gently instead of clipping them.
    scene.view_settings.view_transform = 'AgX'
    looks = [item.identifier for item in type(scene.view_settings).bl_rna.properties['look'].enum_items]
    scene.view_settings.look = next((look for look in looks if 'Punchy' in look), 'None')
    scene.view_settings.exposure = EXPOSURE


def to_three(image, dirs):
    """Resample a Blender panorama into three.js's: u = atan2(z, x) / 2pi + 0.5
    and v = asin(y) / pi + 0.5 in game axes, top row looking straight up."""
    height, width = image.shape[:2]
    # Fit Blender's own mapping from the direction render: azimuth against column, elevation against row.
    equator = dirs[dirs.shape[0] // 2]
    azimuth = np.unwrap(np.arctan2(equator[:, 1], equator[:, 0]))
    columns = (np.arange(dirs.shape[1]) + 0.5) / dirs.shape[1]
    slope, offset = np.polyfit(columns, azimuth, 1)
    middle = dirs[:, dirs.shape[1] // 2]
    elevation = np.arcsin(np.clip(middle[:, 2], -1, 1))
    rows = (np.arange(dirs.shape[0]) + 0.5) / dirs.shape[0]
    e_slope, e_offset = np.polyfit(rows, elevation, 1)
    print(f'blender panorama: azimuth {slope:+.3f} u {offset:+.3f}, elevation {e_slope:+.3f} v {e_offset:+.3f}')
    # Every output pixel's direction, in game axes, then Blender's.
    u = (np.arange(width) + 0.5) / width
    v = (np.arange(height) + 0.5) / height
    theta = (u - 0.5) * 2 * math.pi  # atan2(z, x)
    phi = (0.5 - v) * math.pi  # elevation, top row up
    gx = np.cos(phi)[:, None] * np.cos(theta)[None, :]
    gz = np.cos(phi)[:, None] * np.sin(theta)[None, :]
    gy = np.repeat(np.sin(phi)[:, None], width, axis=1)
    bx, by, bz = gx, -gz, gy
    az = np.arctan2(by, bx)
    el = np.arcsin(np.clip(bz, -1, 1))
    source_u = ((az - offset) / slope) % 1.0
    source_v = np.clip((el - e_offset) / e_slope, 0, 1 - 1e-6)
    sx = np.clip((source_u * width).astype(int), 0, width - 1)
    sy = np.clip((source_v * height).astype(int), 0, height - 1)
    return image[sy, sx]


def main():
    scene, world = reset()
    dirs = direction_map(scene, world, 512, 256)
    tone_map(scene)

    # Find the sun rotation that puts the sun where the game has it: probe
    # two rotations to learn Blender's convention, then solve for the target.
    def sun_azimuth(rotation):
        build_sky(world, rotation)
        probe = render(scene, 512, 256, 1, BUILD / 'sky-probe.exr', 'OPEN_EXR')
        luminance = probe[..., :3].sum(-1)
        row, column = np.unravel_index(np.argmax(luminance), luminance.shape)
        return math.atan2(dirs[row, column, 1], dirs[row, column, 0])

    wrap_angle = lambda a: math.atan2(math.sin(a), math.cos(a))
    target = math.atan2(SUN.y, SUN.x)
    a0 = sun_azimuth(0.0)
    a1 = sun_azimuth(1.0)
    sense = 1.0 if wrap_angle(a1 - a0) > 0 else -1.0
    rotation = wrap_angle((target - a0) * sense)
    found = sun_azimuth(rotation)
    print(f'sun rotation {math.degrees(rotation):.1f}: azimuth {math.degrees(found):.1f}, target {math.degrees(target):.1f}')

    build_sky(world, rotation)
    full_dirs = direction_map(scene, world, WIDTH // 8, HEIGHT // 8)
    tone_map(scene)
    build_sky(world, rotation)
    image = render(scene, WIDTH, HEIGHT, 6, BUILD / 'sky-blender.png')
    zenith = image[:HEIGHT // 20, :, :3].mean((0, 1))
    print('zenith', np.round(zenith, 3), 'brightest cloud', np.round(np.percentile(image[: HEIGHT // 2, :, :3].mean(-1), 99), 3))
    three = to_three(image, full_dirs)
    # Below the horizon: the haze carries on down, then the dull ground the cars
    # reflect. Done here rather than in the world shader, whose atmosphere goes
    # dark just below the horizon.
    horizon_row = HEIGHT // 2
    haze = three[horizon_row - 4:horizon_row - 1].mean(0)
    for row in range(horizon_row, HEIGHT):
        elevation = (0.5 - (row + 0.5) / HEIGHT) * 180.0
        t = min(1.0, max(0.0, -elevation / 10.0))
        t = t * t * (3 - 2 * t)
        three[row] = haze * (1 - t) + np.array([0.24, 0.26, 0.21, 1.0]) * t
    # A touch more colour than AgX leaves: the clear blue of a dry afternoon.
    luma = (three[..., :3] * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    three[..., :3] = np.clip(luma + (three[..., :3] - luma) * SATURATION, 0, 1)
    out = bpy.data.images.new('sky', WIDTH, HEIGHT, alpha=False)
    out.pixels.foreach_set(np.ascontiguousarray(three[::-1]).ravel())
    out.filepath_raw = str(BUILD / 'sky.png')
    out.file_format = 'PNG'
    out.save()
    horizon = three[HEIGHT // 2 - HEIGHT // 60, :, :3].mean(0)
    print('horizon colour (sRGB):', '#' + ''.join(f'{int(round(c * 255)):02x}' for c in np.clip(horizon, 0, 1)))
    print('wrote', BUILD / 'sky.png')


EXPOSURE = float(os.environ.get('SKY_EXPOSURE', '-2.4'))

main()
