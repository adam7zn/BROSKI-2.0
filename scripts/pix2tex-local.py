#!/usr/bin/env python3
"""Local JSON-lines pix2tex worker. Textbook crops never leave this process."""

import json
import sys
from pathlib import Path

from PIL import Image, ImageOps
from pix2tex.cli import LatexOCR


model = LatexOCR()

for line in sys.stdin:
    request = json.loads(line)
    try:
        image = ImageOps.exif_transpose(Image.open(Path(request["imagePath"]))).convert("RGB")
        x, y, width, height = request["boundingBox"]
        left = max(0, round(x * image.width))
        top = max(0, round(y * image.height))
        right = min(image.width, round((x + width) * image.width))
        bottom = min(image.height, round((y + height) * image.height))
        crop = image.crop((left, top, right, bottom))
        latex = model(crop)
        response = {"id": request["id"], "latex": latex, "confidence": None}
    except Exception as error:  # Keep the page run alive and make the block reviewable.
        response = {"id": request.get("id", "unknown"), "error": str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
