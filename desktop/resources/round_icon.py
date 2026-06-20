import math
from PIL import Image, ImageDraw, ImageFilter

def create_squircle_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius, fill=255)
    return mask

# Open original icon
img_path = "/Users/huihui/workspace/code-ws/datation/desktop/resources/icon.png"
img = Image.open(img_path).convert("RGBA")

# Create a rounded mask (Apple squircle-ish, usually radius is ~22.5% of width)
radius = int(img.width * 0.225)
mask = create_squircle_mask(img.size, radius)

# Apply mask
rounded = Image.new("RGBA", img.size, (0,0,0,0))
rounded.paste(img, (0, 0), mask=mask)

# Overwrite the original png
rounded.save(img_path, "PNG")

# Recreate .ico
sizes = [(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)]
rounded.save("/Users/huihui/workspace/code-ws/datation/desktop/resources/icon.ico", format="ICO", sizes=sizes)

print("Icon corners rounded successfully!")
