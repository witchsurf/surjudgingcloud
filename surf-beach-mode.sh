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
APP_PORT="8080"
API_PORT="8000"
SSH_OPTIONS="-o BatchMode=yes -o ConnectTimeout=4"
SERVICE_WAIT_SECONDS="25"
SERVICE_RETRY_DELAY="2"

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

function check_port() {
    local host="$1"
    local port="$2"

    if command -v nc >/dev/null 2>&1; then
        nc -z -G 2 "$host" "$port" >/dev/null 2>&1
        return $?
    fi

    if command -v curl >/dev/null 2>&1; then
        curl --connect-timeout 2 -s "http://${host}:${port}" >/dev/null 2>&1
        return $?
    fi

    return 1
}

function wait_for_port() {
    local host="$1"
    local port="$2"
    local label="$3"
    local waited=0

    while [ "$waited" -lt "$SERVICE_WAIT_SECONDS" ]; do
        if check_port "$host" "$port"; then
            return 0
        fi

        if [ "$waited" -eq 0 ]; then
            echo -e "${YELLOW}⏳ Attente du démarrage de ${label} sur ${host}:${port}...${NC}"
        fi

        sleep "$SERVICE_RETRY_DELAY"
        waited=$((waited + SERVICE_RETRY_DELAY))
    done

    return 1
}

function can_ssh_vm() {
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} "echo ok" >/dev/null 2>&1
}

function auto_repair_services() {
    echo -e "${BLUE}🚑 Tentative d'auto-réparation des services sur ${VM_USER}@${VM_IP}...${NC}"

    if ! can_ssh_vm; then
        echo -e "${RED}❌ Auto-réparation impossible : SSH inaccessible.${NC}"
        return 1
    fi

    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} << EOF
        set -e
        cd ${VM_DIR}/infra
        echo "===== Vérification image locale ====="
        if ! docker image inspect infra-surfjudging:latest >/dev/null 2>&1; then
            echo "Image infra-surfjudging:latest introuvable localement."
            echo "Relancez l'étape 1 avec Internet avant de tenter une réparation terrain."
            exit 1
        fi
        echo
        echo "===== Redémarrage ciblé sans rebuild ====="
        docker compose stop surfjudging || true
        docker compose rm -f surfjudging || true
        docker compose up -d --no-build surfjudging
        echo
        echo "===== Docker compose ps ====="
        docker compose ps
EOF

    echo ""
    echo -e "${BLUE}⏳ Attente de redémarrage des services...${NC}"
    sleep 8

    if verify_services; then
        echo -e "${GREEN}✅ Auto-réparation réussie.${NC}"
        return 0
    fi

    echo -e "${RED}❌ Auto-réparation terminée mais les services restent indisponibles.${NC}"
    return 1
}

function run_remote_diagnostics() {
    echo -e "${BLUE}🛠️  Diagnostic distant sur ${VM_USER}@${VM_IP}...${NC}"

    if ! can_ssh_vm; then
        echo -e "${YELLOW}⚠️ SSH indisponible vers ${VM_USER}@${VM_IP}.${NC}"
        echo -e "   Impossible de lire l'état Docker automatiquement."
        echo -e "   Vérifiez OpenSSH dans la VM ou testez : ssh ${VM_USER}@${VM_IP}"
        return 1
    fi

    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} << EOF
        set +e
        echo "===== IP VM ====="
        hostname -I 2>/dev/null || ip a | grep "inet " | grep -v 127.0.0.1
        echo
        echo "===== Docker compose ps ====="
        cd ${VM_DIR}/infra 2>/dev/null && docker compose ps || echo "Impossible de lire docker compose ps dans ${VM_DIR}/infra"
        echo
        echo "===== Docker ps ====="
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "docker ps indisponible"
        echo
        echo "===== Ports à l'écoute ====="
        ss -ltnp 2>/dev/null | grep -E ":(${APP_PORT}|${API_PORT})\\b" || echo "Aucun process visible sur ${APP_PORT}/${API_PORT}"
        echo
        echo "===== Logs récents surfjudging ====="
        cd ${VM_DIR}/infra 2>/dev/null && docker compose logs --tail=40 surfjudging 2>/dev/null || echo "Logs surfjudging indisponibles"
EOF

    return 0
}

function verify_services() {
    local failed=0

    echo -e "${BLUE}🔎 Vérification des services Surf Judging sur ${VM_IP}...${NC}"

    if wait_for_port "$VM_IP" "$APP_PORT" "Frontend"; then
        echo -e "${GREEN}✅ Frontend accessible sur http://${VM_IP}:${APP_PORT}${NC}"
    else
        echo -e "${RED}❌ Frontend inaccessible sur http://${VM_IP}:${APP_PORT}${NC}"
        echo -e "   Le réseau répond, mais l'application web ne répond pas sur le port ${APP_PORT}."
        failed=1
    fi

    if wait_for_port "$VM_IP" "$API_PORT" "API locale"; then
        echo -e "${GREEN}✅ API locale accessible sur http://${VM_IP}:${API_PORT}${NC}"
    else
        echo -e "${RED}❌ API locale inaccessible sur http://${VM_IP}:${API_PORT}${NC}"
        echo -e "   L'interface admin risque de ne pas charger les données locales."
        failed=1
    fi

    if [ "$failed" -ne 0 ]; then
        echo ""
        echo -e "${YELLOW}Pistes de correction :${NC}"
        echo -e "1. Vérifiez que Docker tourne bien dans la VM."
        echo -e "2. Dans la VM : cd ${VM_DIR}/infra && docker compose ps"
        echo -e "3. Si besoin : cd ${VM_DIR}/infra && docker compose up -d"
        echo -e "4. Vérifiez que la VM est bien en mode bridge sur le réseau D-Link."
        echo ""
        run_remote_diagnostics || true
        echo ""
        if can_ssh_vm; then
            read -p "Voulez-vous tenter l'auto-réparation Docker maintenant ? (o/N) : " repair_now
            if [[ "$repair_now" =~ ^[OoYy]$ ]]; then
                if auto_repair_services; then
                    return 0
                fi
                echo ""
                run_remote_diagnostics || true
                echo ""
            fi
        fi
        return 1
    fi

    return 0
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
        if can_ssh_vm; then
            echo -e "${GREEN}✅ SSH accessible sur ${VM_USER}@${VM_IP}${NC}"
        else
            echo -e "${YELLOW}⚠️ SSH non accessible sur ${VM_USER}@${VM_IP}${NC}"
            echo -e "   Le script pourra vérifier les ports, mais pas diagnostiquer Docker automatiquement."
        fi
        echo ""
        if ! verify_services; then
            echo ""
            read -p "Appuyez sur Entrée pour revenir au menu..."
            return 1
        fi
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
    verify_services || true
    echo ""
    echo -e "${YELLOW}⚠️ ACTION REQUISE MAINTENANT :${NC}"
    echo -e "1. Ouvre Chrome et va sur : http://${VM_IP}:${APP_PORT}/my-events"
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
    echo -e "   👉 ${BLUE}http://${VM_IP}:${APP_PORT}/my-events${NC}"
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

function etape_3_reparation() {
    show_header
    echo -e "${RED}▶ ÉTAPE 3 : AUTO-RÉPARATION TERRAIN${NC}"
    echo -e "Cette étape relance le frontend déjà présent sur la VM, sans rebuild Internet."
    echo ""

    verify_vm || return

    echo ""
    read -p "Confirmer la tentative d'auto-réparation sur ${VM_USER}@${VM_IP} ? (o/N) : " confirm_repair
    if [[ ! "$confirm_repair" =~ ^[OoYy]$ ]]; then
        echo "Annulé."
        sleep 1
        return
    fi

    echo ""
    auto_repair_services || true
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
    echo -e "  ${BLUE}3)${NC} 🚑 Auto-réparation VM"
    echo -e "     -> Tente un redémarrage Docker complet et revérifie 8080/8000."
    echo ""
    echo -e "  ${RED}4)${NC} Quitter"
    echo ""
    read -p "Entrez votre choix (1, 2, 3 ou 4) : " choice

    case $choice in
        1)
            etape_1_preparation
            ;;
        2)
            etape_2_plage
            ;;
        3)
            etape_3_reparation
            ;;
        4)
            echo "Au revoir !"
            exit 0
            ;;
        *)
            echo -e "${RED}Choix invalide.${NC}"
            sleep 1
            ;;
    esac
done
