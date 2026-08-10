"""Build the deterministic Cabinet Crafter Windows icon from its geometric mark."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "cabinet-crafter.ico"
SCALE = 4


def scaled_box(values):
    return tuple(round(value * SCALE) for value in values)


canvas = Image.new("RGBA", (256 * SCALE, 256 * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle(scaled_box((0, 0, 256, 256)), radius=48 * SCALE, fill="#181816")
draw.polygon(
    [(70 * SCALE, 39 * SCALE), (174 * SCALE, 39 * SCALE), (201 * SCALE, 71 * SCALE),
     (201 * SCALE, 217 * SCALE), (55 * SCALE, 217 * SCALE), (55 * SCALE, 71 * SCALE)],
    fill="#ffef72",
)
draw.polygon(
    [(83 * SCALE, 62 * SCALE), (160 * SCALE, 62 * SCALE), (178 * SCALE, 83 * SCALE),
     (178 * SCALE, 114 * SCALE), (83 * SCALE, 114 * SCALE)],
    fill="#181816",
)
draw.rounded_rectangle(scaled_box((83, 130, 178, 157)), radius=5 * SCALE, fill="#181816")
draw.ellipse(scaled_box((104, 135.5, 120, 151.5)), fill="#ffef72")
draw.ellipse(scaled_box((135, 135.5, 151, 151.5)), fill="#ffef72")
draw.rectangle(scaled_box((83, 174, 178, 194)), fill="#181816")
draw.polygon(
    [(55 * SCALE, 71 * SCALE), (83 * SCALE, 71 * SCALE), (83 * SCALE, 217 * SCALE),
     (55 * SCALE, 217 * SCALE)],
    fill="#e2c940",
)

master = canvas.resize((256, 256), Image.Resampling.LANCZOS)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
master.save(OUTPUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(OUTPUT)
