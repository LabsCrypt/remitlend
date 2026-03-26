# Icon Generation Script

This directory contains a script to generate all required PWA icons from a single SVG source file.

## Usage

```bash
# Make the script executable
chmod +x generate-icons.sh

# Run the script
./generate-icons.sh
```

## Requirements

- ImageMagick must be installed:
  - macOS: `brew install imagemagick`
  - Ubuntu: `sudo apt-get install imagemagick`

## Generated Files

The script will generate:
- `icon-72x72.png` - 72×72 pixels
- `icon-96x96.png` - 96×96 pixels
- `icon-128x128.png` - 128×128 pixels
- `icon-144x144.png` - 144×144 pixels
- `icon-152x152.png` - 152×152 pixels
- `icon-192x192.png` - 192×192 pixels
- `icon-384x384.png` - 384×384 pixels
- `icon-512x512.png` - 512×512 pixels
- `../favicon.ico` - Multi-size favicon
- `../apple-touch-icon.png` - Apple touch icon

## Manual Generation

If ImageMagick is not available, you can use online tools:
- [PWA Asset Generator](https://www.pwabuilder.com/imageGenerator)
- [Favicon.io](https://favicon.io/)
- [RealFaviconGenerator](https://realfavicongenerator.net)

Upload the `icon-512x512.svg` file to generate all required sizes.
