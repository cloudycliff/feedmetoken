"""Turn the selected six-pose illustration sheet into a game-ready atlas.

The approved single-character concept remains in docs/art. The six-pose sheet
is another editable art source; this script only extracts alpha and aligns feet.
Requires Pillow, NumPy and SciPy. Normal app builds need none of these packages.
"""

import json
from pathlib import Path
from shutil import copyfile

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "art" / "hero-v1-actions-sheet.png"
TARGET = ROOT / "app" / "public" / "skins" / "concept"
ATLAS_PATH = TARGET / "hero-actions.png"
PREVIEW_PATH = ROOT / "docs" / "art" / "hero-v1-illustration-poses.png"
POSES = ("idle", "reach", "bite", "chew", "fire", "victory")
FOOT_POSITIONS = ((305, 490), (755, 487), (1195, 489),
                  (303, 969), (654, 970), (1180, 972))
FRAME_W, FRAME_H = 600, 520
ANCHOR_X, ANCHOR_Y = 300, 490


def extract(cell: Image.Image, pose: str) -> Image.Image:
    rgb = np.asarray(cell.convert("RGB"), dtype=np.uint8)
    red, green, blue = (rgb[:, :, channel].astype(np.int16) for channel in range(3))
    cream = (
        (red > 240) & (green > 225) & (blue > 200)
        & (red >= green) & (green >= blue)
        & (red - green < 30) & (green - blue < 40)
    )
    edge = np.zeros(cream.shape, dtype=bool)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True
    background = ndimage.binary_propagation(edge & cream, mask=cream)
    subject = ~background
    if pose == "fire":
        # The game's existing beam begins at the hand; omit the sheet's ray.
        subject[100:235, 358:] = False
    components, count = ndimage.label(subject)
    if not count:
        raise RuntimeError(f"No character detected in {pose} cell")
    sizes = np.bincount(components.ravel())
    sizes[0] = 0
    subject = components == sizes.argmax()
    alpha = np.clip(ndimage.gaussian_filter(subject.astype(np.float32), 0.65) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack((rgb, alpha)), "RGBA")


sheet = Image.open(SOURCE).convert("RGB")
if sheet.size != (1536, 1024):
    raise ValueError(f"Expected a 1536x1024 source sheet, got {sheet.size}")
atlas = Image.new("RGBA", (FRAME_W * 3, FRAME_H * 2))
review = Image.new("RGB", (900, 540), "#eff3f0")
review_draw = ImageDraw.Draw(review)
frames = {}
for index, (pose, (foot_x, foot_y)) in enumerate(zip(POSES, FOOT_POSITIONS)):
    col, row = index % 3, index // 3
    cell = sheet.crop((col * 512, row * 512, (col + 1) * 512, (row + 1) * 512))
    sprite = extract(cell, pose)
    aligned = Image.new("RGBA", (FRAME_W, FRAME_H))
    aligned.alpha_composite(sprite, (
        ANCHOR_X - (foot_x - col * 512),
        ANCHOR_Y - (foot_y - row * 512),
    ))
    atlas.alpha_composite(aligned, (col * FRAME_W, row * FRAME_H))
    frames[pose] = [col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H]
    review_draw.rectangle((col * 300 + 4, row * 270 + 4, col * 300 + 296, row * 270 + 266), outline="#bacbd0")
    review_draw.text((col * 300 + 12, row * 270 + 10), pose, fill="#2e4552")
    small = aligned.resize((270, 234), Image.Resampling.LANCZOS)
    review.paste(small, (col * 300 + 15, row * 270 + 28), small)

TARGET.mkdir(parents=True, exist_ok=True)
atlas.save(ATLAS_PATH)
review.save(PREVIEW_PATH)
mint = ROOT / "app" / "public" / "skins" / "mint"
copyfile(mint / "sprites.png", TARGET / "sprites.png")
manifest = json.loads((mint / "manifest.json").read_text(encoding="utf-8"))
manifest["id"] = "concept"
if (TARGET / "manifest.json").exists():
    current = json.loads((TARGET / "manifest.json").read_text(encoding="utf-8"))
    if "robotIllustration" in current:
        manifest["robotIllustration"] = current["robotIllustration"]
manifest["illustration"] = {
    "atlas": ATLAS_PATH.name,
    "displayHeight": 78,
    "anchor": [ANCHOR_X, ANCHOR_Y],
    "interactions": {
        "takeBarEndOffset": [-28, -19],
        "beamStartOffset": [32, -38],
    },
    "frames": frames,
    "animations": {
        "idle": {"frames": ["idle"], "fps": 1},
        "take": {"frames": ["idle", "reach"], "fps": 4.2},
        "eat": {"frames": ["bite", "chew"], "fps": 3.6},
        "beam": {"frames": ["chew", "fire"], "fps": 6.7},
        "hit": {"frames": ["fire"], "fps": 1},
        "victory": {"frames": ["victory"], "fps": 1},
    },
}
(TARGET / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Saved {ATLAS_PATH} and {PREVIEW_PATH}")
