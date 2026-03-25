# PWA Icon Generation Guide

Since ImageMagick is not installed, here are the steps to generate all required PWA icons:

## Method 1: Install ImageMagick (Recommended)

```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install imagemagick

# Then run
./generate-icons.sh
```

## Method 2: Online SVG to PNG Converter

1. Open `public/icons/icon-512x512.svg` in a browser
2. Take screenshots or use online converters like:
   - https://convertio.co/svg-png/
   - https://www.freeconvert.com/svg-to-png
3. Generate these sizes:
   - 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512
   - Maskable versions: 192x192, 512x512 (with transparent padding)
   - Shortcut icons: 96x96 for apply, loans, payment

## Method 3: Design Tool

Use Figma, Canva, or similar tools to:
1. Import the SVG
2. Create square canvases for each required size
3. Export as PNG with transparent background

## Required Files

After generation, ensure these files exist in `public/icons/`:

```
icon-72x72.png
icon-96x96.png
icon-128x128.png
icon-144x144.png
icon-152x152.png
icon-192x192.png
icon-384x384.png
icon-512x512.png
icon-maskable-192x192.png
icon-maskable-512x512.png
shortcut-apply-96x96.png
shortcut-loans-96x96.png
shortcut-payment-96x96.png
```

## Icon Design

The current SVG features:
- Blue gradient background (#2563eb to #1e40af)
- Currency exchange symbol (dollar to local currency)
- Arrow indicating remittance/lending flow
- Subtle grid pattern for finance theme
- Rounded corners suitable for modern mobile apps

This design represents cross-border lending and remittance, perfect for emerging markets.
