#!/bin/bash
# ============================================================
# Budowlaniec Bot — PEŁNY deployment (kopiuje pliki + uruchamia)
# Uruchom LOKALNIE na komputerze (Windows: Git Bash / WSL)
# ============================================================

SERVER="root@46.225.131.52"
REMOTE_DIR="/opt/budowlaniec-bot"

echo "🏗️ Budowlaniec Bot — Deploy na serwer"
echo "Serwer: $SERVER"
echo "========================================"

# 1. Kopiuj pliki na serwer
echo "📤 Kopiuję pliki na serwer..."
ssh $SERVER "mkdir -p $REMOTE_DIR"

# Kopiuj tylko potrzebne pliki (bez node_modules, auth_info)
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'auth_info' \
    --exclude 'logs' \
    --exclude '.git' \
    ./ $SERVER:$REMOTE_DIR/

echo "✅ Pliki skopiowane"

# 2. Uruchom deploy.sh na serwerze
echo "🚀 Uruchamiam deployment na serwerze..."
ssh $SERVER "cd $REMOTE_DIR && bash deploy.sh"

# 3. Uruchom Docker Compose
echo "🐳 Uruchamiam Docker Compose..."
ssh $SERVER "cd $REMOTE_DIR && docker compose up -d --build"

echo ""
echo "========================================"
echo "✅ Deployment zakończony!"
echo ""
echo "🌐 Strona: http://46.225.131.52"
echo "📊 Dashboard: http://46.225.131.52/dashboard"
echo "📱 WebApp: http://46.225.131.52/webapp"
echo "🤖 Bot Telegram: https://t.me/Budowlaniec_bot"
echo "========================================"
