from pathlib import Path
from PIL import Image

INPUT_DIR = Path("icons\\menu")
OUTPUT_DIR = Path("icons")

TARGET_SIZE = (80, 80)
WEBP_QUALITY = 100

OUTPUT_DIR.mkdir(exist_ok=True)

for png_path in INPUT_DIR.glob("*.png"):
    with Image.open(png_path) as img:
        img = img.convert("RGBA")

        # Proportionen erhalten, maximal 40x40
        img.thumbnail(TARGET_SIZE, Image.LANCZOS)

        # Auf exakt 40x40 mit transparentem Hintergrund setzen
        canvas = Image.new("RGBA", TARGET_SIZE, (0, 0, 0, 0))
        x = (TARGET_SIZE[0] - img.width) // 2
        y = (TARGET_SIZE[1] - img.height) // 2
        canvas.paste(img, (x, y), img)

        output_path = OUTPUT_DIR / f"{png_path.stem}.webp"

        canvas.save(
            output_path,
            "WEBP",
            quality=WEBP_QUALITY,
            method=6,
            lossless=True
        )

        print(f"{png_path.name} -> {output_path.name}")