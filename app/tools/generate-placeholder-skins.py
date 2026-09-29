"""Regenerate the two editable placeholder atlases (requires Pillow).

These are temporary game sprites, not the final character art. Keep frame names,
sizes, and ground anchors stable when replacing them with hand-drawn sprites.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1] / "public" / "skins"
ATLAS_SIZE = (1024, 256)
FRAMES = {}


def register(name, x, y, width, height):
    FRAMES[name] = [x, y, width, height]


for index, pose in enumerate(("idle_0", "idle_1", "take", "eat", "beam", "victory")):
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
    },
    "peach": {
        "outline": "#473859", "coat": "#e99a9e", "hair": "#6b4c71",
        "skin": "#ffe3c8", "blush": "#ef7f8e", "mouth": "#a84d69",
        "shoe": "#ffd08a", "metal": "#a7799e", "screen": "#493956",
        "screen_light": "#b286a4", "accent": "#ffd1a0", "alert": "#f48b79",
        "bar": "#a5e5b0", "bar_highlight": "#e4ffd6", "bar_edge": "#60bfa4",
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

    def girl(pose):
        ox, oy = frame(f"girl_{pose}")
        ax, ay = ox + 48, oy + 68

        def r(x, y, width, height, color):
            box(ax + x, ay + y, width, height, color)

        draw.ellipse((ax - 29, ay - 3, ax + 29, ay + 7), fill="#10263844")
        r(-17, -15, 10, 15, palette["outline"])
        r(6, -15, 10, 15, palette["outline"])
        r(-20, -43, 40, 31, palette["outline"])
        r(-17, -40, 34, 25, palette["coat"])
        r(-6, -38, 12, 20, "#f4e8c6")
        r(-13, -64, 28, 11, palette["hair"])
        r(-19, -60, 40, 37, palette["outline"])
        r(-16, -58, 34, 31, palette["skin"])
        r(-19, -59, 36, 10, palette["hair"])
        r(10, -63, 9, 13, palette["hair"])
        r(-7, -68, 5, 7, palette["hair"])
        eye_height = 1 if pose == "idle_1" else 5
        r(-10, -46, 4, eye_height, palette["outline"])
        r(7, -46, 4, eye_height, palette["outline"])
        r(-16, -40, 6, 3, palette["blush"])
        r(12, -40, 6, 3, palette["blush"])
        if pose == "eat":
            r(-1, -39, 8, 7, palette["mouth"])
        else:
            r(0, -37, 6, 2 if pose == "beam" else 3, palette["mouth"])
        if pose in ("beam", "victory"):
            r(17, -34, 20, 7, palette["outline"])
            r(19, -32, 18, 3, palette["skin"])
            draw.ellipse((ax + 33, ay - 35, ax + 43, ay - 25), fill=palette["bar"] if pose == "beam" else palette["skin"])
        else:
            r(17, -37, 8, 17, palette["outline"])
            r(19, -35, 5, 14, palette["skin"])
        if pose == "take":
            r(-43, -39, 24, 8, palette["outline"])
            r(-44, -37, 21, 4, palette["skin"])
            draw.ellipse((ax - 48, ay - 39, ax - 40, ay - 31), fill=palette["skin"])
        elif pose == "eat":
            r(-24, -42, 20, 8, palette["outline"])
            r(-22, -40, 18, 4, palette["skin"])
        else:
            r(-25, -37, 8, 17, palette["outline"])
            r(-23, -35, 5, 14, palette["skin"])
        r(-23, -25, 8, 10, palette["shoe"])

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

    for pose in ("idle_0", "idle_1", "take", "eat", "beam", "victory"):
        girl(pose)
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
    box(ox, oy, 17, 7, palette["outline"])
    box(ox + 2, oy + 1, 13, 5, palette["bar"])
    box(ox + 4, oy + 2, 4, 3, palette["bar_highlight"])
    box(ox + 13, oy + 1, 2, 5, palette["bar_edge"])
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
        "anchors": {"girl": [48, 68], "robot": [32, 69]},
        "animations": {
            "girl": {
                "idle": animation("girl_idle_0", "girl_idle_0", "girl_idle_0", "girl_idle_1", fps=1),
                "take": animation("girl_take"),
                "eat": animation("girl_eat"),
                "beam": animation("girl_beam"),
                "hit": animation("girl_beam"),
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
