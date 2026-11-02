#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
cargo build --release --bin lineup-simulator
APP="$PWD/outputs/职业强度模拟器.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime"
cp target/release/lineup-simulator "$APP/Contents/MacOS/lineup-simulator"
cp resources/{adapter.mjs,game-data.json,native-game-data.json,templates.json,search-pools.json,ui-names.json,ui-english.tsv,font.ttf} "$APP/Contents/Resources/"
ditto resources/icons "$APP/Contents/Resources/icons"
cp resources/runtime/node "$APP/Contents/Resources/runtime/node"
cp resources/template-provenance.json "$APP/Contents/Resources/模板来源.json"
cp NOTICE.txt engine/UPSTREAM.md docs/node-LICENSE.txt docs/heap-js-LICENSE.txt "$APP/Contents/Resources/"
cp docs/战斗核心修复-0.4.2.txt docs/界面与筛选更新-0.4.3.txt docs/报告与前十布局-0.4.4.txt docs/DPS展示修正-0.4.5.txt docs/枪模板更新-0.4.6.txt docs/施法断点修复-0.4.7.txt docs/顶级房屋调整-0.4.8.txt docs/内存积压修复-0.4.9.txt docs/排行榜刷新-0.4.10.txt "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>职业强度模拟器</string>
<key>CFBundleDisplayName</key><string>职业强度模拟器</string>
<key>CFBundleExecutable</key><string>lineup-simulator</string>
<key>CFBundleIdentifier</key><string>local.stella.profession-strength-simulator</string>
<key>CFBundleVersion</key><string>410</string>
<key>CFBundleShortVersionString</key><string>0.4.10</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict></plist>
EOF
codesign --force --deep --sign - "$APP"
printf '%s\n' "$APP"
