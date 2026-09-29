"""Regenerate the two editable skin atlases (requires Pillow).

The heroine follows the accepted concept; enemy and machinery remain placeholders.
Keep frame sizes and ground anchors stable when replacing them with final art.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw
from draw_hero_v1 import ANCHOR, POSES, draw_hero


ROOT = Path(__file__).resolve().parents[1] / "public" / "skins"
ATLAS_SIZE = (1024, 256)
FRAMES = {}


def register(name, x, y, width, height):
    FRAMES[name] = [x, y, width, height]


for index, pose in enumerate(POSES):
    register(f"girl_{pose}", index * 96, 0, 96, 80)
for index, pose in enumerate(("walk_0", "walk_1", "ready", "hit", "defeated")):
    register(f"robot_{pose}", index * 64, 80, 64, 80)
register("machine_idle", 0, 160, 80, 64)
register("machine_active", 80, 160, 80, 64)
register("bar", 160, 160, 20, 10)
register("tray", 192, 160, 40, 8)
register("floor", 0, 240, 320, 16)


PALETTES = {
    "mint": {
        "outline": "#213d58", "coat": "#66c9b7", "hair": "#445270",
        "skin": "#f6dfbe", "blush": "#f6a9a0", "mouth": "#a75668",
        "shoe": "#f5b66b", "metal": "#5d8290", "screen": "#263f5e",
        "screen_light": "#627ca1", "accent": "#8dd6bc", "alert": "#f17e88",
        "bar": "#ffd26a", "bar_highlight": "#fff0c5", "bar_edge": "#f19d69",
        "hair_light": "#536580", "skin_shadow": "#e7bc9c",
        "coat_light": "#99e1cb", "coat_shadow": "#479c98",
        "bag": "#df827e", "bag_light": "#ffd9ac", "sock": "#f8edda",
        "cream": "#fff4db", "eye": "#704f57",
    },
    "peach": {
        "outline": "#473859", "coat": "#e99a9e", "hair": "#6b4c71",
        "skin": "#ffe3c8", "blush": "#ef7f8e", "mouth": "#a84d69",
        "shoe": "#ffd08a", "metal": "#a7799e", "screen": "#493956",
        "screen_light": "#b286a4", "accent": "#ffd1a0", "alert": "#f48b79",
        "bar": "#a5e5b0", "bar_highlight": "#e4ffd6", "bar_edge": "#60bfa4",
        "hair_light": "#806586", "skin_shadow": "#ecc0a9",
        "coat_light": "#ffd1c4", "coat_shadow": "#bc728b",
        "bag": "#d27694", "bag_light": "#ffe0b5", "sock": "#fff0e4",
        "cream": "#fff6e9", "eye": "#765064",
    },
}


def draw_atlas(palette):
    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas)

    def frame(name):
        x, y, _, _ = FRAMES[name]
        return x, y

    def box(x, y, width, height, color):
        draw.rectangle((x, y, x + width - 1, y + height - 1), fill=color)

    def robot(pose):
        ox, oy = frame(f"robot_{pose}")
        ax, ay = ox + 32, oy + 69

        def r(x, y, width, height, color):
            box(ax + x, ay + y, width, height, color)

        stride = -3 if pose == "walk_0" else 3 if pose == "walk_1" else 0
        draw.ellipse((ax - 25, ay - 2, ax + 25, ay + 6), fill="#10263844")
        r(-17 + stride, -18, 12, 18, palette["outline"])
        r(5 - stride, -18, 12, 18, palette["outline"])
        r(-16, -38, 32, 24, palette["outline"])
        r(-13, -35, 26, 18, palette["metal"])
        r(-25, -36, 9, 21, palette["outline"])
        r(16, -36, 9, 21, palette["outline"])
        r(-28, -66, 56, 31, palette["outline"])
        r(-24, -62, 48, 23, "#d8f9ea" if pose == "hit" else palette["screen_light"])
        r(-20, -59, 40, 17, "#172b3d" if pose == "defeated" else "#e9a3ae" if pose == "hit" else palette["screen"])
        if pose == "defeated":
            r(-12, -51, 24, 2, palette["metal"])
        elif pose == "hit":
            for index in range(5):
                r(-16 + index * 8, -57 + (index % 2) * 7, 5, 3, palette["bar"] if index % 2 else palette["accent"])
        else:
            r(-11, -54, 6, 4, palette["alert"])
            r(7, -54, 6, 4, palette["alert"])
            r(-3, -47, 8, 2, palette["alert"])
        r(-5, -69, 10, 3, palette["bar_edge"])

    for pose in POSES:
        draw_hero(draw, palette, FRAMES[f"girl_{pose}"], pose)
    for pose in ("walk_0", "walk_1", "ready", "hit", "defeated"):
        robot(pose)

    for active in (False, True):
        ox, oy = frame("machine_active" if active else "machine_idle")

        def r(x, y, width, height, color):
            box(ox + x, oy + y, width, height, color)

        r(0, 13, 19, 13, palette["outline"])
        r(0, 16, 18, 6, palette["accent"])
        r(11, 0, 45, 58, palette["outline"])
        r(14, 3, 39, 52, palette["metal"])
        r(17, 6, 33, 20, palette["outline"])
        r(20, 9, 27, 14, palette["accent"] if active else palette["screen_light"])
        r(25, 13, 4, 7, palette["outline"])
        r(29, 13, 4, 2, palette["outline"])
        r(35, 13, 4, 7, palette["outline"])
        r(33, 18, 6, 2, palette["outline"])
        r(17, 31, 30, 15, palette["screen"])
        r(19, 48, 7, 7, palette["outline"])
        r(41, 48, 7, 7, palette["outline"])
        r(51, 33, 15, 10, palette["outline"])
        r(54, 35, 12, 6, palette["accent"])
        draw.ellipse((ox + 45, oy + 27, ox + 49, oy + 31), fill=palette["bar"] if active else palette["accent"])

    ox, oy = frame("bar")
    box(ox + 1, oy + 1, 18, 8, palette["outline"])
    box(ox + 2, oy + 2, 16, 6, palette["bar"])
    box(ox + 2, oy + 3, 2, 4, palette["bar_edge"])
    box(ox + 15, oy + 2, 2, 6, palette["bar_edge"])
    box(ox + 5, oy + 3, 5, 2, palette["bar_highlight"])
    box(ox + 11, oy + 5, 2, 2, palette["bar_highlight"])
    box(ox + 17, oy + 3, 2, 1, palette["bar_highlight"])
    box(ox + 17, oy + 6, 2, 1, palette["bar_highlight"])
    ox, oy = frame("tray")
    box(ox, oy, 38, 5, palette["outline"])
    box(ox + 2, oy, 34, 2, palette["accent"])
    ox, oy = frame("floor")
    box(ox + 2, oy, 316, 8, palette["outline"])
    box(ox + 2, oy, 316, 2, palette["accent"])
    box(ox + 20, oy + 8, 280, 4, palette["metal"])
    return atlas


def animation(*frames, fps=1):
    return {"frames": list(frames), "fps": fps}


for skin_id, palette in PALETTES.items():
    folder = ROOT / skin_id
    folder.mkdir(parents=True, exist_ok=True)
    draw_atlas(palette).save(folder / "sprites.png")
    manifest = {
        "formatVersion": 1,
        "id": skin_id,
        "atlas": "sprites.png",
        "frames": FRAMES,
        "objects": {"floor": "floor", "tray": "tray", "bar": "bar"},
        "anchors": {"girl": list(ANCHOR), "robot": [32, 69]},
        "animations": {
            "girl": {
                "idle": animation(*(["girl_idle_0"] * 15 + ["girl_idle_1"]), fps=8),
                "take": animation("girl_take_0", "girl_take_1", fps=4.2),
                "eat": animation("girl_eat_0", "girl_eat_1", fps=3.6),
                "beam": animation("girl_beam_0", "girl_beam_1", fps=6.7),
                "hit": animation("girl_beam_1"),
                "victory": animation("girl_victory"),
            },
            "robot": {
                "entering": animation("robot_walk_0", "robot_walk_1", fps=8),
                "ready": animation("robot_ready"),
                "hit": animation("robot_hit"),
                "defeated": animation("robot_defeated"),
            },
            "machine": {"idle": animation("machine_idle"), "active": animation("machine_active")},
        },
        "effects": {"beam": palette["accent"], "token": palette["accent"], "progress": palette["bar"]},
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
