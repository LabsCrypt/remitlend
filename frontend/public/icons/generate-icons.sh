#!/bin/bash

# Simple icon generation script for RemitLend PWA
# Creates basic PNG icons from SVG source

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$SCRIPT_DIR"
SVG_SOURCE="$ICONS_DIR/icon-512x512.svg"

echo "🎨 Generating PWA icons..."

# Check if SVG source exists
if [ ! -f "$SVG_SOURCE" ]; then
    echo "❌ SVG source file not found: $SVG_SOURCE"
    exit 1
fi

# For now, copy the SVG as placeholder for different sizes
# In production, use ImageMagick or online tools
echo "📐 Creating placeholder icons..."

# Create simple placeholder files (copy of SVG)
for size in 72 96 128 144 152 192 384 512; do
    output_file="$ICONS_DIR/icon-${size}x${size}.png"
    
    # Copy SVG as placeholder (in production, convert to PNG)
    cp "$SVG_SOURCE" "$output_file"
    echo "✅ Created placeholder: $output_file"
done

# Create favicon
cp "$SVG_SOURCE" "$PUBLIC_DIR/favicon.ico"
echo "✅ Created favicon.ico"

# Create Apple touch icon
cp "$SVG_SOURCE" "$PUBLIC_DIR/apple-touch-icon.png"
echo "✅ Created apple-touch-icon.png"

echo ""
echo "🎉 Basic icons created!"
echo ""
echo "⚠️  NOTE: These are placeholder SVG files."
echo "   For production, convert to PNG using:"
echo "   - ImageMagick: brew install imagemagick && ./generate-icons-real.sh"
echo "   - Online: https://favicon.io/ or https://realfavicongenerator.net/"
echo ""
echo "📋 Generated files:"
for size in 72 96 128 144 152 192 384 512; do
    echo "   - icons/icon-${size}x${size}.png"
done
echo "   - favicon.ico"
echo "   - apple-touch-icon.png"
