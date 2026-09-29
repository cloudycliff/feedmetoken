"""Extract the accepted concept illustration as a transparent preview sprite.

Requires Pillow, NumPy and SciPy. The original concept image is never changed.
This is an art-direction sample, not an animated replacement for the heroine.
"""

import json
from pathlib import Path
from shutil import copyfile

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "art" / "hero-v1-concept.png"
DESTINATION = ROOT / "app" / "public" / "skins" / "concept" / "hero-idle.png"

rgb = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.uint8)
red, green, blue = (rgb[:, :, channel].astype(np.int16) for channel in range(3))

# The illustration's cream backdrop has a slight gradient. Only pixels
# connected to the canvas edge are removed, protecting pale enclosed details.
cream = (
    (red > 225) & (green > 218) & (blue > 205)
    & (red >= green) & (green >= blue)
    & (red - green < 32) & (green - blue < 36)
)
edge = np.zeros(cream.shape, dtype=bool)
edge[0, :] = edge[-1, :] = True
edge[:, 0] = edge[:, -1] = True
background = ndimage.binary_propagation(edge & cream, mask=cream)
subject = ~background

# The open space between the legs is surrounded by the pose and therefore
# does not connect to an edge. Its cream region is far larger than pale
# character details such as eyes and socks.
inner_cream, inner_count = ndimage.label(subject & cream)
if inner_count:
    inner_sizes = np.bincount(inner_cream.ravel())
    subject &= ~((inner_cream > 0) & (inner_sizes[inner_cream] > 5_000))

# Remove the neutral ground shadow beneath the shoes; keep the colored shoes.
rows = np.arange(subject.shape[0])[:, None]
neutral_shadow = (
    (rows > 920) & (np.maximum.reduce((red, green, blue)) - np.minimum.reduce((red, green, blue)) < 22)
    & (red < 240)
)
subject &= ~neutral_shadow

# Tiny detached flecks in the concept are omitted from the game sprite.
components, count = ndimage.label(subject)
if not count:
    raise RuntimeError("Could not find the heroine in the concept art")
sizes = np.bincount(components.ravel())
sizes[0] = 0
subject = components == sizes.argmax()

alpha = np.clip(ndimage.gaussian_filter(subject.astype(np.float32), 0.65) * 255, 0, 255).astype(np.uint8)
rgba = np.dstack((rgb, alpha))
ys, xs = np.nonzero(alpha > 8)
margin = 4
box = (
    max(0, int(xs.min()) - margin), max(0, int(ys.min()) - margin),
    min(rgb.shape[1], int(xs.max()) + margin + 1), min(rgb.shape[0], int(ys.max()) + margin + 1),
)
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(rgba, "RGBA").crop(box).save(DESTINATION)
mint = ROOT / "app" / "public" / "skins" / "mint"
copyfile(mint / "sprites.png", DESTINATION.parent / "sprites.png")
manifest = json.loads((mint / "manifest.json").read_text(encoding="utf-8"))
manifest["id"] = "concept"
manifest["idleIllustration"] = {"asset": DESTINATION.name, "displayHeight": 78}
(DESTINATION.parent / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Saved {DESTINATION} ({box[2] - box[0]}x{box[3] - box[1]})")
