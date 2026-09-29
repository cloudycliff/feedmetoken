"""Pixel adaptation of the approved heroine concept for 96x80 skin frames.

Each pose shares the same [48, 74] ground anchor. The illustration in
docs/art/hero-v1-concept.png is the design reference, not a frame source.
"""

from PIL import ImageDraw


POSES = (
    "idle_0", "idle_1", "take_0", "take_1", "eat_0", "eat_1",
    "beam_0", "beam_1", "victory",
)
ANCHOR = (48, 74)


def draw_hero(draw: ImageDraw.ImageDraw, palette: dict[str, str], frame: tuple[int, int, int, int], pose: str) -> None:
    """Draw one opaque-pixel pose into a transparent atlas frame."""
    x, y, width, height = frame
    assert (width, height) == (96, 80) and pose in POSES
    ax, ay = x + ANCHOR[0], y + ANCHOR[1]

    def rect(left: int, top: int, right: int, bottom: int, fill: str) -> None:
        draw.rectangle((ax + left, ay + top, ax + right, ay + bottom), fill=fill)

    def ellipse(left: int, top: int, right: int, bottom: int, fill: str) -> None:
        draw.ellipse((ax + left, ay + top, ax + right, ay + bottom), fill=fill)

    def polygon(points: list[tuple[int, int]], fill: str) -> None:
        draw.polygon([(ax + px, ay + py) for px, py in points], fill=fill)

    outline = palette["outline"]
    hair = palette["hair"]
    hair_light = palette["hair_light"]
    skin = palette["skin"]
    skin_shadow = palette["skin_shadow"]
    coat = palette["coat"]
    coat_light = palette["coat_light"]
    coat_shadow = palette["coat_shadow"]
    blush = palette["blush"]
    bag = palette["bag"]
    bag_light = palette["bag_light"]
    amber = palette["bar"]

    # Ground contact and shoes stay fixed across every action.
    ellipse(-27, -2, 27, 5, "#10263844")
    rect(-16, -14, -5, -5, outline)
    rect(5, -14, 16, -5, outline)
    rect(-17, -8, -3, 0, outline)
    rect(4, -8, 18, 0, outline)
    rect(-15, -7, -5, -2, palette["shoe"])
    rect(6, -7, 16, -2, palette["shoe"])
    rect(-15, -6, -8, -4, coat_light)
    rect(9, -6, 16, -4, coat_light)
    rect(-17, -1, -3, 0, bag_light)
    rect(4, -1, 18, 0, bag_light)
    rect(-14, -16, -5, -12, palette["sock"])
    rect(6, -16, 15, -12, palette["sock"])

    # Short skirt, roomy mint jacket, broad collar and a visible snack pouch.
    polygon([(-16, -22), (16, -22), (18, -11), (-18, -11)], outline)
    rect(-14, -19, 14, -13, hair)
    draw.rounded_rectangle((ax - 23, ay - 37, ax + 22, ay - 14), radius=6, fill=outline)
    draw.rounded_rectangle((ax - 20, ay - 35, ax + 19, ay - 16), radius=5, fill=coat)
    rect(-19, -21, 18, -17, coat_shadow)
    polygon([(-19, -34), (-11, -38), (-4, -31), (3, -31), (11, -38), (19, -34),
             (12, -26), (-12, -26)], coat_shadow)
    polygon([(-11, -34), (-4, -30), (0, -35), (4, -30), (11, -34),
             (8, -28), (-8, -28)], coat_light)
    rect(-2, -27, 2, -17, palette["cream"])
    rect(0, -28, 1, -18, bag_light)
    rect(-25, -31, -22, -23, outline)  # snack-pouch strap
    rect(-27, -29, -17, -23, amber)    # foil packs peeking out
    rect(-25, -27, -21, -23, palette["bar_highlight"])
    draw.rounded_rectangle((ax - 29, ay - 25, ax - 14, ay - 9), radius=3, fill=outline)
    draw.rounded_rectangle((ax - 27, ay - 23, ax - 16, ay - 11), radius=2, fill=bag)
    rect(-24, -18, -20, -15, bag_light)
    rect(-22, -20, -22, -14, bag_light)
    rect(-25, -18, -19, -17, bag_light)

    # Arms are drawn before the head; the hand then sits over the face when eating.
    if pose in ("take_0", "take_1"):
        if pose == "take_0":
            polygon([(-20, -35), (-27, -36), (-39, -34), (-41, -29), (-28, -28),
                     (-19, -27)], outline)
            rect(-38, -33, -27, -30, coat)
            ellipse(-46, -36, -39, -28, skin)
        else:
            polygon([(-20, -35), (-28, -34), (-30, -39), (-19, -44), (-15, -40),
                     (-23, -28)], outline)
            rect(-27, -37, -20, -31, coat)
            ellipse(-19, -46, -12, -39, skin)
    elif pose in ("eat_0", "eat_1", "victory"):
        polygon([(-20, -35), (-27, -34), (-25, -42), (-13, -46), (-9, -41),
                 (-18, -29)], outline)
        rect(-25, -38, -19, -32, coat)
        ellipse(-14, -46, -7, -39, skin)
    else:
        polygon([(-20, -35), (-26, -34), (-29, -22), (-23, -19), (-17, -29)], outline)
        rect(-25, -31, -22, -23, coat)
        ellipse(-28, -24, -21, -17, skin)

    if pose == "beam_0":
        polygon([(17, -34), (23, -37), (29, -31), (24, -27), (16, -29)], outline)
        rect(20, -34, 27, -30, coat)
        ellipse(25, -33, 32, -26, skin)
        rect(31, -31, 34, -29, amber)
    elif pose == "beam_1":
        polygon([(17, -35), (25, -37), (39, -34), (39, -28), (25, -27),
                 (16, -29)], outline)
        rect(24, -34, 37, -30, coat)
        ellipse(37, -35, 44, -28, skin)
        ellipse(42, -34, 47, -29, amber)
    elif pose == "victory":
        polygon([(17, -35), (24, -36), (27, -44), (15, -47), (12, -42),
                 (19, -31)], outline)
        rect(21, -40, 25, -34, coat)
        ellipse(11, -48, 18, -41, skin)
    else:
        polygon([(17, -35), (24, -34), (28, -22), (22, -19), (17, -28)], outline)
        rect(21, -31, 25, -23, coat)
        ellipse(21, -24, 28, -17, skin)

    # Big round face, short navy bob and a single curved ahoge from the concept.
    polygon([(-22, -63), (-17, -68), (-9, -70), (13, -70), (21, -65),
             (24, -56), (24, -37), (18, -31), (-18, -31), (-25, -39),
             (-25, -53)], outline)
    ellipse(-21, -68, 22, -30, hair)
    ellipse(-18, -61, 19, -29, skin_shadow)
    ellipse(-17, -60, 18, -30, skin)
    rect(-17, -46, -14, -36, skin_shadow)
    rect(16, -45, 18, -37, skin_shadow)
    polygon([(-21, -57), (-19, -64), (-12, -67), (14, -67), (20, -63),
             (21, -53), (15, -54), (11, -57), (5, -55), (-1, -58),
             (-8, -55), (-14, -56)], hair)
    polygon([(-24, -55), (-19, -55), (-17, -37), (-20, -32), (-24, -37)], hair)
    polygon([(19, -55), (24, -54), (24, -39), (20, -34), (17, -39)], hair)
    polygon([(-13, -65), (-5, -67), (9, -67), (15, -64), (8, -63),
             (-7, -63)], hair_light)
    polygon([(-3, -68), (-7, -73), (-6, -74), (-1, -74), (2, -71),
             (4, -67), (8, -64), (3, -64)], hair)
    rect(-6, -72, -3, -70, hair_light)

    # Eyes and cheeks carry the personality at 2x display scale.
    if pose == "idle_1" or pose == "victory" or pose == "eat_1":
        rect(-11, -46, -5, -44, outline)
        rect(5, -46, 11, -44, outline)
        if pose == "eat_1":
            rect(-10, -43, -6, -42, hair_light)
            rect(6, -43, 10, -42, hair_light)
    elif pose in ("beam_0", "beam_1"):
        rect(-11, -49, -5, -47, hair)
        rect(5, -49, 11, -47, hair)
        rect(-10, -45, -6, -41, outline)
        rect(6, -45, 10, -41, outline)
    else:
        rect(-11, -48, -4, -41, outline)
        rect(4, -48, 11, -41, outline)
        rect(-9, -46, -6, -42, palette["eye"])
        rect(6, -46, 9, -42, palette["eye"])
        rect(-10, -47, -8, -45, palette["cream"])
        rect(5, -47, 7, -45, palette["cream"])
        rect(-6, -42, -5, -41, amber)
        rect(9, -42, 10, -41, amber)

    if pose == "eat_1":
        ellipse(-19, -42, -11, -35, blush)
        ellipse(11, -42, 19, -35, blush)
        rect(-14, -39, -12, -38, bag_light)
        rect(13, -39, 15, -38, bag_light)
        rect(-2, -38, 3, -37, palette["mouth"])
    else:
        rect(-17, -40, -13, -37, blush)
        rect(13, -40, 17, -37, blush)
        if pose == "eat_0":
            rect(-2, -42, 4, -36, palette["mouth"])
            rect(0, -38, 3, -37, bag_light)
        elif pose == "victory":
            rect(-4, -38, 4, -37, palette["mouth"])
            rect(-2, -36, 2, -36, palette["mouth"])
        else:
            rect(-2, -39, 3, -38, palette["mouth"])

    # Foreground fingertips keep the reach, bite and satisfied pose readable.
    if pose == "take_1":
        ellipse(-20, -45, -13, -39, skin)
    elif pose == "eat_0":
        ellipse(-11, -44, -5, -39, skin)
    elif pose == "victory":
        ellipse(12, -45, 18, -39, skin)
