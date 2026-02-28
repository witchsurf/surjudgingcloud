#!/bin/bash
# SSL Certificate Diagnostic & Fix Script
# Upload this to your VPS and run as root/sudo

set -e

echo "🔒 SSL Certificate Diagnostic & Fix for surfjudging.cloud"
echo "=========================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

VPS_IP=$(curl -s ifconfig.me)
DOMAIN="surfjudging.cloud"
AUTOMATION_DOMAIN="automation.surfjudging.cloud"

# 1. DNS Check
echo -e "${YELLOW}📡 Step 1: Checking DNS Resolution${NC}"
echo "   VPS IP: $VPS_IP"

DOMAIN_IP=$(dig +short $DOMAIN @8.8.8.8 | tail -n1)
AUTO_DOMAIN_IP=$(dig +short $AUTOMATION_DOMAIN @8.8.8.8 | tail -n1)

echo "   $DOMAIN resolves to: $DOMAIN_IP"
echo "   $AUTOMATION_DOMAIN resolves to: $AUTO_DOMAIN_IP"

if [ "$VPS_IP" != "$DOMAIN_IP" ]; then
    echo -e "${RED}   ❌ ERROR: DNS mismatch for $DOMAIN!${NC}"
    echo "   → Go to your DNS provider and add:"
    echo "     Type: A, Name: @, Value: $VPS_IP"
    echo ""
    read -p "   Press Enter after fixing DNS, or Ctrl+C to abort..."
else
    echo -e "${GREEN}   ✅ DNS correct for $DOMAIN${NC}"
fi

if [ "$VPS_IP" != "$AUTO_DOMAIN_IP" ]; then
    echo -e "${RED}   ❌ ERROR: DNS mismatch for $AUTOMATION_DOMAIN!${NC}"
    echo "   → Go to your DNS provider and add:"
    echo "     Type: A, Name: automation, Value: $VPS_IP"
    echo ""
    read -p "   Press Enter after fixing DNS, or Ctrl+C to abort..."
else
    echo -e "${GREEN}   ✅ DNS correct for $AUTOMATION_DOMAIN${NC}"
fi

# 2. Port Check
echo ""
echo -e "${YELLOW}🔌 Step 2: Checking Port Accessibility${NC}"

# Check if ports 80 and 443 are listening
if netstat -tuln | grep -q ':80 '; then
    echo -e "${GREEN}   ✅ Port 80 is open${NC}"
else
    echo -e "${RED}   ❌ Port 80 is NOT listening${NC}"
fi

if netstat -tuln | grep -q ':443 '; then
    echo -e "${GREEN}   ✅ Port 443 is open${NC}"
else
    echo -e "${RED}   ❌ Port 443 is NOT listening${NC}"
fi

# Check external accessibility
echo "   Testing external access..."
if timeout 5 bash -c "echo > /dev/tcp/8.8.8.8/80" 2>/dev/null; then
    echo -e "${GREEN}   ✅ Can reach external HTTP${NC}"
else
    echo -e "${RED}   ❌ Cannot reach external HTTP (firewall issue?)${NC}"
fi

# 3. Firewall Check
echo ""
echo -e "${YELLOW}🔥 Step 3: Checking Firewall${NC}"

if command -v ufw &> /dev/null; then
    echo "   UFW detected"
    if ufw status | grep -q "Status: active"; then
        echo -e "${YELLOW}   ⚠️  UFW is active${NC}"
        if ! ufw status | grep -q "80/tcp.*ALLOW"; then
            echo -e "${RED}   ❌ Port 80 not allowed, fixing...${NC}"
            ufw allow 80/tcp
        fi
        if ! ufw status | grep -q "443/tcp.*ALLOW"; then
            echo -e "${RED}   ❌ Port 443 not allowed, fixing...${NC}"
            ufw allow 443/tcp
        fi
        echo -e "${GREEN}   ✅ Firewall configured${NC}"
    else
        echo -e "${GREEN}   ✅ UFW inactive${NC}"
    fi
elif command -v firewall-cmd &> /dev/null; then
    echo "   Firewalld detected"
    if ! firewall-cmd --list-services | grep -q "http"; then
        echo -e "${RED}   ❌ HTTP not allowed, fixing...${NC}"
        firewall-cmd --permanent --add-service=http
        firewall-cmd --permanent --add-service=https
        firewall-cmd --reload
    fi
    echo -e "${GREEN}   ✅ Firewall configured${NC}"
else
    echo -e "${GREEN}   ✅ No firewall detected${NC}"
fi

# 4. Docker & Traefik Check
echo ""
echo -e "${YELLOW}🐳 Step 4: Checking Docker & Traefik${NC}"

cd /opt/judging/infra

if ! docker ps | grep -q traefik; then
    echo -e "${RED}   ❌ Traefik container not running${NC}"
else
    echo -e "${GREEN}   ✅ Traefik is running${NC}"
fi

# 5. Certificate Files
echo ""
echo -e "${YELLOW}📝 Step 5: Checking Certificate Files${NC}"

if [ ! -d "letsencrypt" ]; then
    echo -e "${YELLOW}   ⚠️  Creating letsencrypt directory${NC}"
    mkdir -p letsencrypt
fi

if [ ! -f "letsencrypt/acme.json" ]; then
    echo -e "${YELLOW}   ⚠️  Creating acme.json${NC}"
    touch letsencrypt/acme.json
    chmod 600 letsencrypt/acme.json
else
    PERMS=$(stat -c %a letsencrypt/acme.json 2>/dev/null || stat -f %A letsencrypt/acme.json)
    if [ "$PERMS" != "600" ]; then
        echo -e "${RED}   ❌ Wrong permissions ($PERMS), fixing...${NC}"
        chmod 600 letsencrypt/acme.json
    else
        echo -e "${GREEN}   ✅ acme.json permissions correct${NC}"
    fi

    # Check if acme.json has certificates
    if [ -s "letsencrypt/acme.json" ]; then
        echo -e "${GREEN}   ✅ acme.json contains data${NC}"
        echo "   Certificate info:"
        cat letsencrypt/acme.json | jq -r '.le.Certificates[]?.domain.main' 2>/dev/null || echo "     (cannot parse - might be encrypted)"
    else
        echo -e "${YELLOW}   ⚠️  acme.json is empty (certificate not generated yet)${NC}"
    fi
fi

# 6. Environment Check
echo ""
echo -e "${YELLOW}⚙️  Step 6: Checking Environment Configuration${NC}"

if [ ! -f ".env" ]; then
    echo -e "${RED}   ❌ .env file missing${NC}"
    if [ -f ".env.production" ]; then
        echo -e "${YELLOW}   → Copying .env.production to .env${NC}"
        cp .env.production .env
    fi
else
    if grep -q "DOMAIN_NAME=surfjudging.cloud" .env; then
        echo -e "${GREEN}   ✅ DOMAIN_NAME configured correctly${NC}"
    else
        echo -e "${RED}   ❌ DOMAIN_NAME not set correctly${NC}"
    fi

    if grep -q "SSL_EMAIL=" .env && ! grep -q "SSL_EMAIL=$" .env; then
        echo -e "${GREEN}   ✅ SSL_EMAIL configured${NC}"
    else
        echo -e "${RED}   ❌ SSL_EMAIL not set${NC}"
    fi
fi

# 7. Clean restart with certificate generation
echo ""
echo -e "${YELLOW}🔄 Step 7: Clean Restart for Certificate Generation${NC}"
read -p "   Do you want to restart containers and regenerate certificate? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "   Stopping containers..."
    docker compose down

    echo "   Removing old certificate..."
    rm -f letsencrypt/acme.json
    touch letsencrypt/acme.json
    chmod 600 letsencrypt/acme.json

    echo "   Using production environment..."
    cp .env.production .env 2>/dev/null || true

    echo "   Starting containers..."
    docker compose up -d

    echo "   Waiting 45 seconds for certificate generation..."
    sleep 45

    echo ""
    echo "   Checking Traefik logs for certificate:"
    docker compose logs traefik 2>&1 | grep -i "certificate\|acme\|error" | tail -20
fi

# 8. Final Verification
echo ""
echo -e "${YELLOW}🔍 Step 8: Final Verification${NC}"

echo "   Testing HTTPS connection..."
if curl -k -I https://$DOMAIN 2>&1 | grep -q "HTTP"; then
    echo -e "${GREEN}   ✅ HTTPS responding${NC}"

    # Check certificate validity
    echo ""
    echo "   Certificate details:"
    echo "quit" | timeout 5 openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>/dev/null || echo "     (cannot retrieve certificate details)"
else
    echo -e "${RED}   ❌ HTTPS not responding${NC}"
fi

# 9. Summary
echo ""
echo "=========================================================="
echo -e "${YELLOW}📋 SUMMARY & NEXT STEPS${NC}"
echo "=========================================================="
echo ""

if [ -s "letsencrypt/acme.json" ]; then
    echo -e "${GREEN}✅ Certificate file exists and has content${NC}"
else
    echo -e "${RED}❌ Certificate file empty - Let's Encrypt challenge likely failed${NC}"
    echo ""
    echo "Common causes:"
    echo "  1. DNS not pointing to this server ($VPS_IP)"
    echo "  2. Port 80 blocked by firewall or ISP"
    echo "  3. Domain not accessible from internet"
    echo ""
    echo "Manual verification:"
    echo "  → Visit http://$DOMAIN from another device"
    echo "  → Check: curl -I http://$DOMAIN/.well-known/acme-challenge/test"
fi

echo ""
echo "View live Traefik logs:"
echo "  docker compose -f /opt/judging/infra/docker-compose.yml logs -f traefik"
echo ""
echo "Force certificate regeneration:"
echo "  cd /opt/judging/infra"
echo "  docker compose down"
echo "  rm -f letsencrypt/acme.json && touch letsencrypt/acme.json && chmod 600 letsencrypt/acme.json"
echo "  docker compose up -d && docker compose logs -f traefik"
echo ""
