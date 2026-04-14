#!/bin/bash
NEW_IP=$1

if [ -z "$NEW_IP" ]; then
    echo "❌ Erreur: Vous devez spécifier la nouvelle IP."
    echo "💡 Usage: ./set-box-ip.sh <NOUVELLE_IP>"
    echo "💡 Exemple: ./set-box-ip.sh 192.168.0.50"
    exit 1
fi

echo "🔄 Adaptation de l'infrastructure pour pointer vers : $NEW_IP"

# 1. Mise à jour du script de déploiement
if [ -f "surf-beach-mode.sh" ]; then
    sed -i '' -E "s/VM_IP=\"[0-9\.]+\"/VM_IP=\"$NEW_IP\"/" surf-beach-mode.sh
    echo "✅ surf-beach-mode.sh mis à jour."
else
    echo "⚠️ surf-beach-mode.sh introuvable."
fi

# 2. Mise à jour du fichier d'environnement Supabase
if [ -f "infra/.env" ]; then
    sed -i '' -E "s|API_EXTERNAL_URL=http://[0-9\.]+:8000|API_EXTERNAL_URL=http://${NEW_IP}:8000|" infra/.env
    sed -i '' -E "s|SITE_URL=http://[0-9\.]+:8080|SITE_URL=http://${NEW_IP}:8080|" infra/.env
    echo "✅ infra/.env mis à jour."
else
    echo "⚠️ infra/.env introuvable."
fi

# 3. Mise à jour de .env.production pour le Frontend compilé
if [ -f "frontend/.env.production" ]; then
    sed -i '' -E "s|VITE_SUPABASE_URL_LAN=http://[0-9\.]+:8000|VITE_SUPABASE_URL_LAN=http://${NEW_IP}:8000|" frontend/.env.production
    echo "✅ frontend/.env.production mis à jour."
else
    echo "⚠️ frontend/.env.production introuvable."
fi

echo "🎉 Succès ! Relancez l'Option 1 (./surf-beach-mode.sh) avec cette IP."
