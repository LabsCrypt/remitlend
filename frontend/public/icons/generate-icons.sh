#!/bin/bash

# Generate PWA icons from SVG source
# This script requires ImageMagick to be installed:
# macOS: brew install imagemagick
# Ubuntu: sudo apt-get install imagemagick

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$SCRIPT_DIR"
SVG_SOURCE="$ICONS_DIR/icon-512x512.svg"

echo "🎨 Generating PWA icons from SVG source..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Please install it:"
    echo "   macOS: brew install imagemagick"
    echo "   Ubuntu: sudo apt-get install imagemagick"
    exit 1
fi

# Check if SVG source exists
if [ ! -f "$SVG_SOURCE" ]; then
    echo "❌ SVG source file not found: $SVG_SOURCE"
    exit 1
fi

# Define icon sizes
declare -a SIZES=(
    72
    96
    128
    144
    152
    192
    384
    512
)

# Generate PNG icons
for size in "${SIZES[@]}"; do
    output_file="$ICONS_DIR/icon-${size}x${size}.png"
    echo "📐 Generating ${size}x${size} icon..."
    
    convert "$SVG_SOURCE" \
        -resize "${size}x${size}" \
        -background transparent \
        "$output_file"
    
    if [ $? -eq 0 ]; then
        echo "✅ Created: $output_file"
    else
        echo "❌ Failed to create: $output_file"
    fi
done

# Generate favicon.ico (multiple sizes in one file)
echo "🔖 Generating favicon.ico..."
convert \
    "$ICONS_DIR/icon-16x16.png" \
    "$ICONS_DIR/icon-32x32.png" \
    "$ICONS_DIR/icon-48x48.png" \
    "$PUBLIC_DIR/favicon.ico"

if [ $? -eq 0 ]; then
    echo "✅ Created: $PUBLIC_DIR/favicon.ico"
else
    echo "❌ Failed to create favicon.ico"
fi

# Generate Apple touch icon
echo "🍎 Generating Apple touch icon..."
convert "$SVG_SOURCE" \
    -resize 180x180 \
    -background transparent \
    "$PUBLIC_DIR/apple-touch-icon.png"

if [ $? -eq 0 ]; then
    echo "✅ Created: $PUBLIC_DIR/apple-touch-icon.png"
else
    echo "❌ Failed to create apple-touch-icon.png"
fi

echo ""
echo "🎉 Icon generation complete!"
echo ""
echo "📋 Generated files:"
for size in "${SIZES[@]}"; do
    echo "   - icons/icon-${size}x${size}.png"
done
echo "   - favicon.ico"
echo "   - apple-touch-icon.png"
echo ""
echo "💡 Next steps:"
echo "   1. Test the PWA installation on mobile devices"
echo "   2. Verify icons appear correctly in different contexts"
echo "   3. Update manifest.json if needed"
