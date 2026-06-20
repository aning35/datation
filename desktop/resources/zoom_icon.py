import math
from PIL import Image, ImageDraw, ImageFilter

def create_squircle_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius, fill=255)
    return mask

# Open the original artifact image which has no rounded corners
orig_path = "/Users/huihui/.gemini/antigravity-ide/brain/79030255-8589-41e2-a702-01737cedadf6/datation_icon_1781946589309.png"
img = Image.open(orig_path).convert("RGBA")

# Zoom factor (crop center 75%)
width, height = img.size
crop_w = int(width * 0.72)
crop_h = int(height * 0.72)
left = (width - crop_w) // 2
top = (height - crop_h) // 2
right = left + crop_w
bottom = top + crop_h

# Crop and resize
cropped = img.crop((left, top, right, bottom))
zoomed = cropped.resize((width, height), Image.Resampling.LANCZOS)

# Create a rounded mask
radius = int(width * 0.225)
mask = create_squircle_mask(zoomed.size, radius)

# Apply mask
rounded = Image.new("RGBA", zoomed.size, (0,0,0,0))
rounded.paste(zoomed, (0, 0), mask=mask)

# Save to resources
dest_path = "/Users/huihui/workspace/code-ws/datation/desktop/resources/icon.png"
rounded.save(dest_path, "PNG")

# Recreate .ico
sizes = [(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)]
rounded.save("/Users/huihui/workspace/code-ws/datation/desktop/resources/icon.ico", format="ICO", sizes=sizes)

print("Icon zoomed and rounded successfully!")
