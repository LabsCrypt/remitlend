# RemitLend PWA Icons

This directory contains all the icons used for the RemitLend Progressive Web App.

## Icon Sizes and Usage

### App Icons
- `icon-72x72.png` - Android launcher (ldpi)
- `icon-96x96.png` - Android launcher (mdpi)
- `icon-128x128.png` - Chrome Web Store
- `icon-144x144.png` - Android launcher (hdpi)
- `icon-152x152.png` - Android launcher (xhdpi)
- `icon-192x192.png` - Android launcher (xxhdpi), PWA default
- `icon-384x384.png` - Android launcher (xxxhdpi)
- `icon-512x512.png` - Android launcher (xxxxhdpi), App Store

### Favicon
- `favicon.ico` - Browser favicon (16x16, 32x32)
- `favicon.png` - Modern browsers (32x32)

### Splash Screens
- `splash-640x1136.png` - iPhone 5/SE
- `splash-750x1334.png` - iPhone 6/7/8
- `splash-1242x2208.png` - iPhone 6/7/8 Plus
- `splash-1125x2436.png` - iPhone X/XS/11 Pro
- `splash-1170x2532.png` - iPhone 12/13 Pro
- `splash-1284x2778.png` - iPhone 12/13 Pro Max
- `splash-828x1792.png` - iPhone XR/11
- `splash-1242x2688.png` - iPhone XS Max/11 Pro Max

## Design Guidelines

### Brand Colors
- **Primary**: #3b82f6 (Blue)
- **Secondary**: #1e293b (Dark Blue)
- **Accent**: #10b981 (Green)
- **Background**: #ffffff (White)
- **Text**: #1f2937 (Dark Gray)

### Icon Design
- Clean, modern design with rounded corners
- RemitLend logo prominently featured
- High contrast for accessibility
- Works well on both light and dark backgrounds

### File Formats
- **PNG** for all icons and splash screens
- **ICO** for favicon compatibility
- **SVG** for scalable vector icons (if available)

## Generating Icons

To generate all required icons from a single source:

1. Start with a 512x512 high-resolution PNG or SVG
2. Use an icon generation tool like:
   - [PWA Asset Generator](https://www.pwabuilder.com/imageGenerator)
   - [Favicon.io](https://favicon.io/)
   - [RealFaviconGenerator](https://realfavicongenerator.net/)

3. Ensure the source follows these guidelines:
   - Square aspect ratio
   - Transparent background for flexibility
   - High resolution (minimum 512x512)
   - Clear, readable branding

## Testing Icons

Test your PWA icons across different devices:

1. **Mobile Devices**: Android and iOS
2. **Desktop Browsers**: Chrome, Edge, Firefox
3. **Tablets**: iPad and Android tablets
4. **Different Screen Sizes**: From small phones to large desktops

## Accessibility Considerations

- Ensure sufficient color contrast (minimum 4.5:1)
- Test with high contrast mode
- Verify icons work with screen readers
- Consider colorblind users

## File Size Optimization

- Keep icon files under 50KB when possible
- Use appropriate compression without losing quality
- Consider WebP format for better compression
- Implement lazy loading for larger icons

## Maintenance

- Update icons when branding changes
- Test new icon sizes for new devices
- Keep backup of source files
- Document any design changes
