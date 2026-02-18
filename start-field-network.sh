#!/bin/bash

# Configuration
IP_MAC="192.168.1.3"
PORT="8000"

echo "=================================================="
echo "   SURF JUDGING - DÉMARRAGE RÉSEAU TERRAIN"
echo "=================================================="
echo ""
echo "Ce script configure le pont réseau entre le Mac et la VM Supabase."
echo "Il est conçu pour être utilisé avec le routeur D-Link sur le terrain."
echo ""
echo "Vérification de l'IP..."

# Vérifier si l'IP 192.168.1.3 est attribuée
CURRENT_IP=$(ifconfig | grep "inet " | grep $IP_MAC)

if [ -z "$CURRENT_IP" ]; then
    echo "⚠️  ATTENTION : Votre Mac n'a pas l'IP $IP_MAC !"
    echo "    Veuillez vérifier votre connexion au routeur D-Link."
    echo "    IP actuelles détectées :"
    ifconfig | grep "inet " | grep -v 127.0.0.1
    echo ""
    echo "Appuyez sur Ctrl+C pour annuler, ou Entrée pour forcer le démarrage..."
    read
fi

echo "Démarrage du tunnel socat sur $IP_MAC:$PORT -> localhost:$PORT"
echo "Vous devrez peut-être entrer votre mot de passe sudo."
echo ""

# Lancer socat
sudo socat TCP-LISTEN:$PORT,bind=$IP_MAC,fork,reuseaddr TCP:192.168.1.69:$PORT
