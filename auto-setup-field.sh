#!/bin/bash

# SURF JUDGING - AUTO-SETUP FIELD NETWORK
# Ce script détecte votre IP actuelle et configure les fichiers .env automatiquement.

echo "=================================================="
echo "   SURF JUDGING - CONFIGURATION AUTOMATIQUE"
echo "=================================================="

# 1. Détection de l'IP du Mac
# On cherche l'IP sur l'interface Wi-Fi (en0) ou Ethernet (en1/en2)
# On privilégie les IPs en 192.168.x.x
IP_MAC=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | grep "192.168" | awk '{print $2}' | head -n 1)

if [ -z "$IP_MAC" ]; then
    echo "❌ Erreur : Impossible de détecter une IP locale (192.168.x.x)."
    echo "Vérifiez que vous êtes connecté au routeur de la compétition."
    exit 1
fi

echo "✅ IP Mac détectée : $IP_MAC"

# IP de la VM (dynamique)
echo "Regardez l'écran de votre machine virtuelle Ubuntu."
echo "L'adresse IP devrait être affichée (ex: 192.168.1.37 ou 10.0.0.24)."
read -p "Veuillez entrer l'IP de la VM Supabase : " IP_VM

if [ -z "$IP_VM" ]; then
    echo "❌ Erreur : L'adresse IP de la VM ne peut pas être vide."
    exit 1
fi

echo "ℹ️ IP VM Supabase : $IP_VM"

# 2. Mise à jour du Frontend (.env.local)
FRONTEND_ENV="frontend/.env.local"
if [ -f "$FRONTEND_ENV" ]; then
    echo "📝 Mise à jour de $FRONTEND_ENV..."
    # Remplacement des IPs
    sed -i '' "s/VITE_SUPABASE_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:8000/VITE_SUPABASE_URL=http:\/\/$IP_VM:8000/g" "$FRONTEND_ENV"
    sed -i '' "s/VITE_SUPABASE_URL_LAN=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:8000/VITE_SUPABASE_URL_LAN=http:\/\/$IP_VM:8000/g" "$FRONTEND_ENV"
    sed -i '' "s/VITE_SITE_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:5173/VITE_SITE_URL=http:\/\/$IP_MAC:5173/g" "$FRONTEND_ENV"
    sed -i '' "s/VITE_SITE_URL_LAN=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:5173/VITE_SITE_URL_LAN=http:\/\/$IP_MAC:5173/g" "$FRONTEND_ENV"
    sed -i '' "s/VITE_KIOSK_BASE_URL_LAN=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:5173/VITE_KIOSK_BASE_URL_LAN=http:\/\/$IP_MAC:5173/g" "$FRONTEND_ENV"
    echo "   Fait."
else
    echo "⚠️  Fichier $FRONTEND_ENV introuvable."
fi

# 3. Mise à jour du script de démarrage (socat)
START_SCRIPT="start-field-network.sh"
if [ -f "$START_SCRIPT" ]; then
    echo "📝 Mise à jour de $START_SCRIPT..."
    sed -i '' "s/IP_MAC=\"[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\"/IP_MAC=\"$IP_MAC\"/g" "$START_SCRIPT"
    echo "   Fait."
fi

echo ""
echo "=================================================="
echo "🎯 CONFIGURATION TERMINÉE !"
echo "=================================================="
echo ""
echo "1. Lancez le pont réseau (socat) :"
echo "   ./start-field-network.sh"
echo ""
echo "2. COMMANDE À COPIER SUR VOTRE VM (SSH) :"
echo "   Copiez-collez cette ligne dans votre terminal Ubuntu :"
echo ""
echo "   sed -i 's/SITE_URL=http:\/\/[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:5173/SITE_URL=http:\/\/$IP_MAC:5173/g' ~/surjudgingcloud/infra/.env && sudo docker compose -f ~/surjudgingcloud/infra/docker-compose-local.yml restart"
echo ""
echo "3. Ouvrez l'App sur votre Mac :"
echo "   http://$IP_MAC:5173/my-events"
echo ""
