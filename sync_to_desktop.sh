#!/bin/bash
# Script de synchronisation: Playground → Desktop/judging
# Utilisation: ./sync_to_desktop.sh

SOURCE="/Users/laraise/.gemini/antigravity/playground/neon-planck"
DEST="$HOME/Desktop/judging"

echo "📦 Syncing Playground → Desktop/judging..."
echo "   Source: $SOURCE"
echo "   Dest: $DEST"
echo ""

# Vérifier que les dossiers existent
if [ ! -d "$SOURCE" ]; then
    echo "❌ Error: Source directory not found: $SOURCE"
    exit 1
fi

if [ ! -d "$DEST" ]; then
    echo "⚠️  Warning: Destination directory not found: $DEST"
    echo "   Creating destination directory..."
    mkdir -p "$DEST"
fi

# Synchronisation avec rsync
rsync -av \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude '.env' \
  "$SOURCE/" "$DEST/"

echo ""
echo "✅ Sync complete!"
echo ""
echo "Next steps:"
echo "1. Open FileZilla"
echo "2. Connect to 195.35.2.170 (SFTP)"
echo "3. Upload from Desktop/judging → /opt/judging"
echo "4. SSH and rebuild: npm run build"
