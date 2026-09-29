"""Extract the four-pose monitor robot illustration into the concept skin.

The source sheet and prompt live in docs/art. Pillow, NumPy and SciPy are needed
only to regenerate this atlas; normal app builds use the committed PNG files.
Run make_illustration_actions.py first if rebuilding the concept skin from scratch.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "art" / "robot-v1-actions-sheet.png"
TARGET = ROOT / "app" / "public" / "skins" / "concept"
ATLAS_PATH = TARGET / "robot-actions.png"
PREVIEW_PATH = ROOT / "docs" / "art" / "robot-v1-illustration-poses.png"
POSES = ("entering", "ready", "hit", "defeated")
FOOT_POSITIONS = ((284, 461), (732, 459), (267, 923), (718, 924))
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
    if pose == "hit":
        # The game draws its own ray; retain only the glow at the screen edge.
        subject[105:180, :198] = False
    components, count = ndimage.label(subject)
    if not count:
        raise RuntimeError(f"No robot detected in {pose} cell")
    sizes = np.bincount(components.ravel())
    sizes[0] = 0
    subject = components == sizes.argmax()
    alpha = np.clip(ndimage.gaussian_filter(subject.astype(np.float32), 0.65) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack((rgb, alpha)), "RGBA")


sheet = Image.open(SOURCE).convert("RGB")
if sheet.size != (1024, 1024):
    raise ValueError(f"Expected a 1024x1024 source sheet, got {sheet.size}")
atlas = Image.new("RGBA", (FRAME_W * 2, FRAME_H * 2))
review = Image.new("RGB", (700, 680), "#eff3f0")
review_draw = ImageDraw.Draw(review)
frames = {}
for index, (pose, (foot_x, foot_y)) in enumerate(zip(POSES, FOOT_POSITIONS)):
    col, row = index % 2, index // 2
    cell = sheet.crop((col * 512, row * 512, (col + 1) * 512, (row + 1) * 512))
    sprite = extract(cell, pose)
    aligned = Image.new("RGBA", (FRAME_W, FRAME_H))
    aligned.alpha_composite(sprite, (
        ANCHOR_X - (foot_x - col * 512),
        ANCHOR_Y - (foot_y - row * 512),
    ))
    atlas.alpha_composite(aligned, (col * FRAME_W, row * FRAME_H))
    frames[pose] = [col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H]
    review_draw.rectangle((col * 350 + 4, row * 340 + 4, col * 350 + 346, row * 340 + 336), outline="#bacbd0")
    review_draw.text((col * 350 + 12, row * 340 + 10), pose, fill="#2e4552")
    small = aligned.resize((318, 276), Image.Resampling.LANCZOS)
    review.paste(small, (col * 350 + 16, row * 340 + 36), small)

TARGET.mkdir(parents=True, exist_ok=True)
atlas.save(ATLAS_PATH)
review.save(PREVIEW_PATH)
manifest_path = TARGET / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["robotIllustration"] = {
    "atlas": ATLAS_PATH.name,
    "displayHeight": 82,
    "anchor": [ANCHOR_X, ANCHOR_Y],
    "beamImpactOffset": [-15, -48],
    "frames": frames,
    "animations": {state: {"frames": [state], "fps": 1} for state in POSES},
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Saved {ATLAS_PATH} and {PREVIEW_PATH}")
