#!/bin/bash
# Build MDesign.app + MDesign.dmg (self-contained, no Node needed at runtime).
# Usage: desktop/bundle.sh    (run from anywhere; ICON_PNG env overrides the icon source)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/MDesign.app"
DMG="$ROOT/MDesign.dmg"
BIN="$ROOT/target/release/mdesign"
ICON_SRC="${ICON_PNG:-$ROOT/icon1024.png}"

echo "==> building frontend"
( cd "$ROOT/.." && npm run build >/dev/null )

echo "==> building rust binary (release)"
cargo build --release --manifest-path "$ROOT/Cargo.toml" >/dev/null

echo "==> building icon"
ICONSET="$ROOT/MDesign.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s"           "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png"      >/dev/null
  sips -z "$((s*2))" "$((s*2))" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ROOT/MDesign.icns"
rm -rf "$ICONSET"

echo "==> assembling app bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/mdesign"
chmod +x "$APP/Contents/MacOS/mdesign"
cp "$ROOT/MDesign.icns" "$APP/Contents/Resources/MDesign.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MDesign</string>
  <key>CFBundleDisplayName</key><string>MDesign</string>
  <key>CFBundleIdentifier</key><string>com.mdesign.app</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>mdesign</string>
  <key>CFBundleIconFile</key><string>MDesign</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

echo "==> ad-hoc codesign"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "   (codesign skipped)"

echo "==> creating dmg"
DMGDIR="$ROOT/.dmgroot"
rm -rf "$DMGDIR"; mkdir -p "$DMGDIR"
cp -R "$APP" "$DMGDIR/"
ln -s /Applications "$DMGDIR/Applications"
rm -f "$DMG"
hdiutil create -volname "MDesign" -srcfolder "$DMGDIR" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$DMGDIR"

echo "==> done"
echo "    app: $APP"
echo "    dmg: $DMG"
