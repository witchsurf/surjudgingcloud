#!/bin/bash
set -e

# Configuration
VERSION="1.1.0"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
PIN_APP="2026"

# IP de la machine virtuelle locale (détectée d'après ton Docker context)
VM_USER="laraise"
VM_IP="192.168.1.78"
VM_DIR="/home/laraise/surjudgingcloud"

function show_header() {
    clear
    echo -e "${BLUE}======================================================${NC}"
    echo -e "${YELLOW}       🏄 SURF JUDGING PRO - BEACH CONTROL CENTER     ${NC}"
    echo -e "${BLUE}======================================================${NC}"
    echo -e " Version ${VERSION} | Machine Régie Visée : ${VM_USER}@${VM_IP}"
    echo -e "${BLUE}======================================================${NC}"
    echo ""
}

function verify_vm() {
    echo -e "${YELLOW}Vérification de la machine virtuelle locale...${NC}"
    echo -e "Regardez l'écran de votre machine virtuelle Ubuntu."
    echo -e "L'adresse IP devrait être affichée (ex: 192.168.1.37 ou 10.0.0.24)."
    echo ""
    read -p "Veuillez entrer cette adresse IP : " manually_entered_ip
    
    if [ -z "$manually_entered_ip" ]; then
        echo -e "${RED}❌ ERREUR : L'adresse IP ne peut pas être vide.${NC}"
        return 1
    fi

    echo -e "Test de connexion vers ${manually_entered_ip}..."
    if ping -c 1 -W 2 "$manually_entered_ip" >/dev/null 2>&1; then
        VM_IP="$manually_entered_ip"
        echo -e "${GREEN}✅ Connexion réussie à la machine virtuelle sur ${VM_IP}${NC}"
        return 0
    else
        echo -e "${RED}❌ ERREUR : La machine virtuelle n'est pas joignable à cette adresse (${manually_entered_ip}).${NC}"
        echo -e "Vérifiez que la VM est bien allumée et sur le même réseau WiFi (Mode Accès par pont / Bridged)."
        echo ""
        read -p "Appuyez sur Entrée pour revenir au menu..."
        return 1
    fi
}

function etape_1_preparation() {
    show_header
    echo -e "${YELLOW}▶ ÉTAPE 1 : PRÉPARATION (Avec Internet)${NC}"
    echo -e "Cette étape va envoyer ton code vers le serveur Ubuntu et le recompiler."
    echo ""
    
    verify_vm || return
    
    echo -e "${BLUE}📦 1. Compilation front-end locale...${NC}"
    cd frontend || exit
    npm i --no-audit
    rm -rf dist
    npm run build
    cd ..
    
    echo ""
    echo -e "${BLUE}🔄 2. Envoi du nouveau code vers le Serveur (${VM_IP})...${NC}"
    # rsync over ssh (excluding paths that require root permissions or shouldn't be overridden)
    rsync -avz \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude 'infra/letsencrypt' \
        ./ ${VM_USER}@${VM_IP}:${VM_DIR}/
    
    echo ""
    echo -e "${BLUE}🐳 3. Re-création des serveurs Docker sur le Serveur Ubuntu...${NC}"
    ssh ${VM_USER}@${VM_IP} << EOF
        cd ${VM_DIR}/infra
        echo "Arrêt de l'ancien système..."
        docker compose stop surfjudging || true
        echo "Lancement avec compilation..."
        docker compose up -d --build surfjudging
EOF
    
    echo ""
    echo -e "${GREEN}✅ DÉPLOIEMENT TERMINÉ !${NC}"
    echo ""
    echo -e "${YELLOW}⚠️ ACTION REQUISE MAINTENANT :${NC}"
    echo -e "1. Ouvre Chrome et va sur : http://${VM_IP}:8080/my-events"
    echo -e "2. Connecte-toi au Cloud avec Magic Link (puisque tu as internet)."
    echo -e "3. Clique sur le bouton violet [Sync depuis Cloud]."
    echo -e "4. Vérifie que tes événements apparaissent."
    echo ""
    read -p "Une fois la synchro terminée, appuie sur Entrée pour revenir au menu..."
}

function etape_2_plage() {
    show_header
    echo -e "${YELLOW}▶ ÉTAPE 2 : MODE PLAGE (Sans Internet)${NC}"
    echo -e "Veuillez vous assurer que ce Mac et toutes les tablettes"
    echo -e "sont connectés au routeur WiFi de la plage."
    echo ""
    
    verify_vm || return

    echo -e "${GREEN}✅ Le Serveur (${VM_IP}) est prêt !${NC}"
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  🏖️  INSTRUCTIONS POUR LES TABLETTES JUGES :"
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "1. Connectez la tablette au réseau WiFi local de la plage"
    echo -e "2. Ouvrez Chrome ou Safari"
    echo -e "3. Allez sur l'adresse exacte suivante :"
    echo -e ""
    echo -e "   👉 ${BLUE}http://${VM_IP}:8080/my-events${NC}"
    echo -e ""
    echo -e "4. Descendez en bas de la page sur 'Accès Secours'"
    echo -e "5. Entrez le CODE PIN ADMINISTRATEUR :"
    echo -e ""
    echo -e "   👉 ${RED}${PIN_APP}${NC}"
    echo -e ""
    echo -e "6. Sélectionnez l'événement en cours."
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    read -p "Appuyez sur Entrée pour revenir au menu..."
}

while true; do
    show_header
    echo -e "Que souhaitez-vous faire ?"
    echo ""
    echo -e "  ${GREEN}1)${NC} 🌐 ÉTAPE 1 : Préparation Maison (Avec Internet)"
    echo -e "     -> Déploie le code sur le serveur Ubuntu et relance Docker."
    echo ""
    echo -e "  ${YELLOW}2)${NC} 🏖️ ÉTAPE 2 : Lancer le Mode Plage (Sans Internet)"
    echo -e "     -> Affiche les URL et les codes pour les tablettes."
    echo ""
    echo -e "  ${RED}3)${NC} Quitter"
    echo ""
    read -p "Entrez votre choix (1, 2 ou 3) : " choice

    case $choice in
        1)
            etape_1_preparation
            ;;
        2)
            etape_2_plage
            ;;
        3)
            echo "Au revoir !"
            exit 0
            ;;
        *)
            echo -e "${RED}Choix invalide.${NC}"
            sleep 1
            ;;
    esac
done
