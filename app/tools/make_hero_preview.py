"""Render a review sheet from the mint skin's nine heroine frames."""

from pathlib import Path

from PIL import Image, ImageDraw

from draw_hero_v1 import POSES


APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
atlas = Image.open(APP / "public" / "skins" / "mint" / "sprites.png").convert("RGBA")
sheet = Image.new("RGB", (960, 870), "#f7f4ed")
draw = ImageDraw.Draw(sheet)

for index, pose in enumerate(POSES):
    column, row = index % 3, index // 3
    left, top = column * 320, row * 290
    draw.rectangle((left + 8, top + 8, left + 311, top + 281), outline="#c5cbd0", width=2)
    draw.text((left + 18, top + 17), pose.replace("_", " "), fill="#213d58")
    sprite = atlas.crop((index * 96, 0, index * 96 + 96, 80))
    sprite = sprite.resize((288, 240), Image.Resampling.NEAREST)
    sheet.paste(sprite, (left + 16, top + 35), sprite)

destination = ROOT / "docs" / "art" / "hero-v1-pixel-poses.png"
sheet.save(destination)
print(destination)
