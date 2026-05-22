#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/public/apple-touch-icon.jpg"

if [[ ! -f "$SRC" ]]; then
  echo "Source icon not found: $SRC" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  IM=(magick)
elif command -v convert >/dev/null 2>&1; then
  IM=(convert)
else
  ROOT_DIR="$ROOT_DIR" python3 - <<'PY'
import os
from pathlib import Path
from PIL import Image

root = Path(os.environ["ROOT_DIR"])
src = root / "public" / "apple-touch-icon.jpg"

def cover(size: int, target: Path) -> None:
    image = Image.open(src).convert("RGBA")
    scale = max(size / image.width, size / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - size) // 2
    top = (resized.height - size) // 2
    resized.crop((left, top, left + size, top + size)).save(target)

def maskable(target: Path) -> None:
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    image = Image.open(src).convert("RGBA")
    image.thumbnail((410, 410), Image.LANCZOS)
    canvas.alpha_composite(image, ((512 - image.width) // 2, (512 - image.height) // 2))
    canvas.save(target)

cover(32, root / "public" / "favicon-32.png")
cover(180, root / "public" / "apple-touch-icon-180.png")
cover(192, root / "public" / "icon-192.png")
cover(512, root / "public" / "icon-512.png")
maskable(root / "public" / "icon-512-maskable.png")
PY
  echo "Generated PWA icons in public/."
  exit 0
fi

"${IM[@]}" "$SRC" -resize 32x32^ -gravity center -extent 32x32 "$ROOT_DIR/public/favicon-32.png"
"${IM[@]}" "$SRC" -resize 180x180^ -gravity center -extent 180x180 "$ROOT_DIR/public/apple-touch-icon-180.png"
"${IM[@]}" "$SRC" -resize 192x192^ -gravity center -extent 192x192 "$ROOT_DIR/public/icon-192.png"
"${IM[@]}" "$SRC" -resize 512x512^ -gravity center -extent 512x512 "$ROOT_DIR/public/icon-512.png"
"${IM[@]}" -size 512x512 canvas:none "$SRC" -resize 410x410 -gravity center -composite "$ROOT_DIR/public/icon-512-maskable.png"

echo "Generated PWA icons in public/."
