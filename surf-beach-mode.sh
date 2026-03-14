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
RSYNC_SSH_OPTIONS="-o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=3"
SERVICE_WAIT_SECONDS="25"
SERVICE_RETRY_DELAY="2"
SSH_STABILITY_CHECKS="3"
SSH_STABILITY_DELAY="2"
FRONTEND_DEPS_STAMP=".deploy-deps.sha256"
BEACH_SUPABASE_SERVICES="postgres kong auth realtime storage rest"
BEACH_DISABLED_SERVICES="meta studio"

# IP de la machine virtuelle locale (détectée d'après ton Docker context)
VM_USER="laraise"
VM_IP="192.168.1.78"
VM_DIR="/home/laraise/surjudgingcloud"
DEPLOY_ITEMS=(
    ".dockerignore"
    "surf-beach-mode.sh"
    "vm-cleanup.sh"
    "vm-network.sh"
    "vm-zombies.sh"
    "infra/Dockerfile"
    "infra/docker-compose.yml"
    "infra/docker-compose-local.yml"
    "infra/kong.yml"
    "infra/nginx.conf"
    "backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql"
    "backend/sql/FIX_SYNC_SCORING.sql"
    "backend/sql/14_ADD_INTERFERENCE_CALLS.sql"
    "frontend/dist/"
)

function sync_deploy_items() {
    local remote="${VM_USER}@${VM_IP}"

    run_rsync() {
        if ! rsync "$@"; then
            echo -e "${RED}❌ Transfert interrompu vers ${remote}.${NC}"
            echo -e "   La connexion SSH est devenue indisponible pendant la copie."
            echo -e "   Vérifiez l'IP actuelle de la VM puis relancez l'étape 1."
            return 1
        fi
    }

    echo -e "${BLUE}📡 Pré-vérification SSH avant transfert...${NC}"
    if ! can_ssh_vm; then
        echo -e "${RED}❌ SSH inaccessible juste avant le transfert vers ${remote}.${NC}"
        echo -e "   Réessayez avec l'IP actuelle de la VM affichée dans Ubuntu."
        return 1
    fi

    if ! ssh ${SSH_OPTIONS} "${remote}" "mkdir -p '${VM_DIR}/infra' '${VM_DIR}/backend/sql' '${VM_DIR}/frontend/dist/assets'"; then
        echo -e "${RED}❌ Impossible de préparer l'arborescence distante sur ${remote}.${NC}"
        return 1
    fi

    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" .dockerignore "${remote}:${VM_DIR}/.dockerignore" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" surf-beach-mode.sh "${remote}:${VM_DIR}/surf-beach-mode.sh" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-cleanup.sh "${remote}:${VM_DIR}/vm-cleanup.sh" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-network.sh "${remote}:${VM_DIR}/vm-network.sh" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-zombies.sh "${remote}:${VM_DIR}/vm-zombies.sh" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" infra/Dockerfile "${remote}:${VM_DIR}/infra/Dockerfile" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" infra/docker-compose.yml "${remote}:${VM_DIR}/infra/docker-compose.yml" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" infra/docker-compose-local.yml "${remote}:${VM_DIR}/infra/docker-compose-local.yml" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" infra/kong.yml "${remote}:${VM_DIR}/infra/kong.yml" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" infra/nginx.conf "${remote}:${VM_DIR}/infra/nginx.conf" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql "${remote}:${VM_DIR}/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" backend/sql/FIX_SYNC_SCORING.sql "${remote}:${VM_DIR}/backend/sql/FIX_SYNC_SCORING.sql" || return 1
    run_rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" backend/sql/14_ADD_INTERFERENCE_CALLS.sql "${remote}:${VM_DIR}/backend/sql/14_ADD_INTERFERENCE_CALLS.sql" || return 1
    run_rsync -avz --delete -e "ssh ${RSYNC_SSH_OPTIONS}" frontend/dist/ "${remote}:${VM_DIR}/frontend/dist/" || return 1
}

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

function get_remote_primary_ip() {
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} \
        "hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.|192\\.168\\.)' | head -n 1" \
        2>/dev/null
}

function verify_ssh_stability() {
    local attempt=1

    while [ "$attempt" -le "$SSH_STABILITY_CHECKS" ]; do
        if ! can_ssh_vm; then
            echo -e "${RED}❌ SSH instable vers ${VM_USER}@${VM_IP} (échec au test ${attempt}/${SSH_STABILITY_CHECKS}).${NC}"
            return 1
        fi

        if [ "$attempt" -lt "$SSH_STABILITY_CHECKS" ]; then
            sleep "$SSH_STABILITY_DELAY"
        fi
        attempt=$((attempt + 1))
    done

    return 0
}

function preflight_deploy_network() {
    local detected_ip=""

    echo -e "${BLUE}🧭 Préflight réseau/SSH avant compilation...${NC}"

    if ! verify_ssh_stability; then
        echo -e "${YELLOW}⚠️ La VM répond, mais la session SSH n'est pas suffisamment stable pour lancer un déploiement long.${NC}"
        echo -e "   Re-vérifiez l'IP affichée dans Ubuntu et stabilisez le bridge réseau avant de continuer."
        return 1
    fi

    detected_ip="$(get_remote_primary_ip || true)"
    if [ -n "$detected_ip" ] && [ "$detected_ip" != "$VM_IP" ]; then
        echo -e "${YELLOW}⚠️ Incohérence IP détectée :${NC}"
        echo -e "   IP saisie     : ${VM_IP}"
        echo -e "   IP primaire VM: ${detected_ip}"
        echo -e "   Continuez avec l'IP réellement affichée dans Ubuntu."
        return 1
    fi

    echo -e "${GREEN}✅ SSH stable et IP cohérente pour ${VM_USER}@${VM_IP}${NC}"
    return 0
}

function ensure_frontend_dependencies() {
    local current_stamp=""
    local cached_stamp=""

    current_stamp="$(shasum -a 256 package.json package-lock.json | shasum -a 256 | awk '{print $1}')"
    if [ -f "${FRONTEND_DEPS_STAMP}" ]; then
        cached_stamp="$(cat "${FRONTEND_DEPS_STAMP}")"
    fi

    if [ -d node_modules ] && [ "$current_stamp" = "$cached_stamp" ]; then
        echo -e "${GREEN}✅ Dépendances frontend déjà à jour, npm ci ignoré.${NC}"
        return 0
    fi

    npm ci --no-audit
    printf '%s\n' "$current_stamp" > "${FRONTEND_DEPS_STAMP}"
}

function ensure_beach_stack_remote() {
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} << EOF
        set -e
        cd ${VM_DIR}/infra
        echo "===== Démarrage stack plage minimale ====="
        docker compose -f docker-compose-local.yml up -d ${BEACH_SUPABASE_SERVICES}
        echo
        echo "===== Arrêt des services non essentiels ====="
        docker compose -f docker-compose-local.yml stop ${BEACH_DISABLED_SERVICES} || true
        docker compose -f docker-compose-local.yml rm -f ${BEACH_DISABLED_SERVICES} || true
        echo
        echo "===== État Supabase plage ====="
        docker compose -f docker-compose-local.yml ps
EOF
}

function apply_local_schema_fixes_remote() {
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} << EOF
        set -e
        echo "===== Migration schéma DB locale ====="
        until docker exec surfjudging_postgres pg_isready -U postgres >/dev/null 2>&1; do
            echo "Attente PostgreSQL local..."
            sleep 2
        done
        for sql_file in \
            "${VM_DIR}/backend/sql/FIX_LOCAL_SYNC_SCHEMA.sql" \
            "${VM_DIR}/backend/sql/FIX_SYNC_SCORING.sql" \
            "${VM_DIR}/backend/sql/14_ADD_INTERFERENCE_CALLS.sql"
        do
            if [ -f "\${sql_file}" ]; then
                echo "Application de \$(basename "\${sql_file}")"
                docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "\${sql_file}"
            fi
        done
        echo "===== Rechargement API locale ====="
        cd ${VM_DIR}/infra
        docker compose -f docker-compose-local.yml restart rest kong >/dev/null 2>&1 || true
EOF
}

function auto_repair_services() {
    echo -e "${BLUE}🚑 Tentative d'auto-réparation des services sur ${VM_USER}@${VM_IP}...${NC}"

    if ! can_ssh_vm; then
        echo -e "${RED}❌ Auto-réparation impossible : SSH inaccessible.${NC}"
        return 1
    fi

    echo -e "${BLUE}🏖️ Réactivation de la stack plage minimale...${NC}"
    ensure_beach_stack_remote
    apply_local_schema_fixes_remote

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
    local check_services="${1:-yes}"

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
        if [ "$check_services" = "yes" ]; then
            if ! verify_services; then
                echo ""
                read -p "Appuyez sur Entrée pour revenir au menu..."
                return 1
            fi
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
    preflight_deploy_network || return
    
    echo -e "${BLUE}📦 1. Compilation front-end locale...${NC}"
    cd frontend || exit
    ensure_frontend_dependencies
    rm -rf dist
    npm run build
    cd ..
    
    echo ""
    echo -e "${BLUE}🔄 2. Envoi du nouveau code vers le Serveur (${VM_IP})...${NC}"
    sync_deploy_items || return
    
    echo ""
    echo -e "${BLUE}🗄️ 3. Activation de la stack plage minimale...${NC}"
    ensure_beach_stack_remote
    apply_local_schema_fixes_remote

    echo ""
    echo -e "${BLUE}🐳 4. Re-création du frontend sur le Serveur Ubuntu...${NC}"
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} << EOF
        cd ${VM_DIR}/infra
        echo "Arrêt de l'ancien système..."
        docker compose stop surfjudging || true
        echo "Lancement avec build runtime-only..."
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

function etape_4_maintenance() {
    show_header
    echo -e "${BLUE}▶ ÉTAPE 4 : MAINTENANCE VM${NC}"
    echo -e "Nettoyage Docker, diagnostic réseau/SSH et processus zombies."
    echo ""

    verify_vm "no" || return

    echo ""
    echo -e "${BLUE}🌐 Diagnostic réseau/SSH...${NC}"
    if ! can_ssh_vm; then
        echo -e "${RED}❌ SSH inaccessible vers ${VM_USER}@${VM_IP}.${NC}"
        echo -e "   La maintenance distante ne peut pas continuer."
        echo -e "   Vérifiez d'abord l'IP affichée dans Ubuntu et le mode bridge/NAT de la VM."
        echo ""
        read -p "Appuyez sur Entrée pour revenir au menu..."
        return
    fi

    echo -e "${BLUE}📤 Envoi des scripts de maintenance...${NC}"
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} "mkdir -p '${VM_DIR}'"
    rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-network.sh "${VM_USER}@${VM_IP}:${VM_DIR}/vm-network.sh"
    rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-cleanup.sh "${VM_USER}@${VM_IP}:${VM_DIR}/vm-cleanup.sh"
    rsync -avz -e "ssh ${RSYNC_SSH_OPTIONS}" vm-zombies.sh "${VM_USER}@${VM_IP}:${VM_DIR}/vm-zombies.sh"

    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} "cd ${VM_DIR} && chmod +x vm-network.sh vm-cleanup.sh vm-zombies.sh && ./vm-network.sh"
    echo ""
    echo -e "${BLUE}🧹 Nettoyage Docker...${NC}"
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} "cd ${VM_DIR} && ./vm-cleanup.sh"
    echo ""
    echo -e "${BLUE}🧟 Diagnostic zombies...${NC}"
    ssh ${SSH_OPTIONS} ${VM_USER}@${VM_IP} "cd ${VM_DIR} && ./vm-zombies.sh"
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
    echo -e "  ${BLUE}4)${NC} 🧹 Maintenance VM"
    echo -e "     -> Diagnostique réseau/SSH, nettoie Docker et analyse les zombies."
    echo ""
    echo -e "  ${RED}5)${NC} Quitter"
    echo ""
    read -p "Entrez votre choix (1, 2, 3, 4 ou 5) : " choice

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
            etape_4_maintenance
            ;;
        5)
            echo "Au revoir !"
            exit 0
            ;;
        *)
            echo -e "${RED}Choix invalide.${NC}"
            sleep 1
            ;;
    esac
done
