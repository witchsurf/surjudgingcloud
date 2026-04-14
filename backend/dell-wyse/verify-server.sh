#!/bin/bash

# 🩺 Serveur Surf Judging - Script de Vérification (Dell Wyse 5070)
# Ce script vérifie que tous les composants sont prêts avant une compétition.

echo "=================================================="
echo "   SURF JUDGING - DIAGNOSTIC SERVEUR"
echo "=================================================="

# 1. Vérification Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker n'est pas installé."
else
    echo "✅ Docker est installé."
    
    # 2. Vérification des Containers
    RUNNING_CONTAINERS=$(docker ps --format "{{.Names}}")
    REQUIRED_CONTAINERS=("surfjudging_postgres" "surfjudging_rest" "surfjudging_realtime" "surfjudging_auth" "surfjudging_kong")
    
    for container in "${REQUIRED_CONTAINERS[@]}"; do
        if echo "$RUNNING_CONTAINERS" | grep -q "$container"; then
            echo "✅ Container $container : EN LIGNE"
        else
            echo "❌ Container $container : ARRETÉ ou MANQUANT"
        fi
    done
fi

# 3. Vérification Réseau
IP_LOCAL=$(hostname -I | awk '{print $1}')
echo "ℹ️  Adresse IP du serveur : $IP_LOCAL"

if [[ "$IP_LOCAL" == "10.0.0.24" ]]; then
    echo "✅ IP Statique (10.0.0.24) : OK"
else
    echo "⚠️  L'IP n'est pas 10.0.0.24. Vérifiez votre config netplan si vous voulez garder la compatibilité avec vos tablettes actuelles."
fi

# 4. Vérification de l'API (Santé)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/rest/v1/ --header "apikey: dummy")
if [ "$HTTP_STATUS" -eq 401 ] || [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ API (Kong Gateway) : RÉPOND"
else
    echo "❌ API (Kong Gateway) : ERREUR ($HTTP_STATUS)"
fi

echo "=================================================="
echo "   DIAGNOSTIC TERMINÉ"
echo "=================================================="
