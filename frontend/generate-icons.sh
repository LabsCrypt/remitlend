#!/bin/bash

# Create PWA icons from SVG
# This script requires ImageMagick to be installed

echo "Generating PWA icons from SVG..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Please install it first:"
    echo "  macOS: brew install imagemagick"
    echo "  Ubuntu: sudo apt-get install imagemagick"
    exit 1
fi

# Directory containing the SVG
ICON_DIR="public/icons"
SVG_FILE="$ICON_DIR/icon-512x512.svg"

# Create regular icons
SIZES=(72 96 128 144 152 192 384 512)

for size in "${SIZES[@]}"; do
    echo "Generating ${size}x${size} icon..."
    convert -background none -size ${size}x${size} "$SVG_FILE" "$ICON_DIR/icon-${size}x${size}.png"
done

# Create maskable icons (with padding)
echo "Generating maskable icons..."
convert -background none -size 192x192 -gravity center -extent 192x192 "$SVG_FILE" "$ICON_DIR/icon-maskable-192x192.png"
convert -background none -size 512x512 -gravity center -extent 512x512 "$SVG_FILE" "$ICON_DIR/icon-maskable-512x512.png"

# Create shortcut icons
echo "Generating shortcut icons..."

# Apply for Loan icon - document with plus
convert -background none -size 96x96 -gravity center -extent 96x96 "$SVG_FILE" "$ICON_DIR/shortcut-apply-96x96.png"

# My Loans icon - list view
convert -background none -size 96x96 -gravity center -extent 96x96 "$SVG_FILE" "$ICON_DIR/shortcut-loans-96x96.png"

# Make Payment icon - payment symbol
convert -background none -size 96x96 -gravity center -extent 96x96 "$SVG_FILE" "$ICON_DIR/shortcut-payment-96x96.png"

echo "Icon generation complete!"
echo "Generated files:"
ls -la "$ICON_DIR/"*.png
