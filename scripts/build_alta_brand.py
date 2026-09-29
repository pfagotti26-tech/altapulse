"""Deriva assets da marca fornecida sem redesenhar símbolo ou lettering ALTA."""
from pathlib import Path
from io import BytesIO
import requests
import pymupdf
from PIL import Image, ImageDraw, ImageFont

BASE = Path('/app')
OUT = BASE / 'frontend/public/brand'
OUT.mkdir(parents=True, exist_ok=True)
font_path = BASE / 'brand-assets/Poppins-Light.ttf'
if not font_path.exists():
    response = requests.get('https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Light.ttf', timeout=30)
    response.raise_for_status()
    font_path.write_bytes(response.content)
doc = pymupdf.open(BASE / 'brand-assets/vermelho.pdf')
pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(4, 4), alpha=True)
source = Image.open(BytesIO(pix.tobytes('png'))).convert('RGBA')
symbol = source.crop((76, 0, 808, 668))
word = source.crop((0, 680, source.width, 1092))

def colored(image, color):
    result = Image.new('RGBA', image.size, color)
    result.putalpha(image.getchannel('A'))
    return result

for name, color in [('black', '#101012'), ('white', '#ffffff'), ('red', '#C41E3A')]:
    mark = colored(symbol, color)
    alta = colored(word, color)
    stacked = Image.new('RGBA', (980, 1420), (0, 0, 0, 0))
    stacked.alpha_composite(mark, (124, 24))
    stacked.alpha_composite(alta, ((980 - alta.width) // 2, 708))
    draw = ImageDraw.Draw(stacked)
    font = ImageFont.truetype(str(font_path), 194)
    draw.text((490, 1300), 'pulse', font=font, fill=color, anchor='ms')
    stacked.save(OUT / f'alta-pulse-stacked-{name}.png', optimize=True)
    stacked.save(OUT / f'alta-core-stacked-{name}.png', optimize=True)  # Compatibilidade com pacotes anteriores.
    horizontal = Image.new('RGBA', (1060, 390), (0, 0, 0, 0))
    horizontal.alpha_composite(mark.resize((350, 319), Image.Resampling.LANCZOS), (5, 22))
    horizontal.alpha_composite(alta.resize((560, 264), Image.Resampling.LANCZOS), (425, 0))
    ImageDraw.Draw(horizontal).text((705, 342), 'pulse', font=ImageFont.truetype(str(font_path), 132), fill=color, anchor='ms')
    horizontal.save(OUT / f'alta-pulse-{name}.png', optimize=True)
    horizontal.save(OUT / f'alta-core-{name}.png', optimize=True)  # Arquivos legados preservam os caminhos.
    mark.save(OUT / f'alta-mark-{name}.png', optimize=True)
favicon = colored(symbol, '#C41E3A')
favicon.thumbnail((56, 56), Image.Resampling.LANCZOS)
icon = Image.new('RGBA', (64, 64), '#ffffff')
icon.alpha_composite(favicon, ((64-favicon.width)//2, (64-favicon.height)//2))
icon.save(OUT / 'favicon.png')
icon.save(BASE / 'frontend/public/favicon.ico')
print('Alta Pulse: símbolo e lettering ALTA preservados; somente o descritor do logotipo foi substituído.')