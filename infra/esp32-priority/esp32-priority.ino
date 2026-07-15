/**
 * ============================================================================
 *  SURF JUDGING CLOUD — ESP32 PRIORITY LED CONTROLLER v2.1
 * ============================================================================
 *
 *  Firmware pour ESP32-WROOM-DA
 *  Port série: /dev/cu.usbserial-1420
 *
 *  v2.0 — Fonctionnalités:
 *    - Polling ultra-rapide 500ms en LAN (5s Cloud)
 *    - OTA (mise à jour sans fil via http://priority.local/update)
 *    - mDNS (http://priority.local)
 *    - Clignotement fin de série (30s lent, 10s rapide)
 *    - Fondu animé lors des changements de priorité
 *    - Config WiFi modifiable depuis le dashboard web
 *
 *  Architecture:
 *    Core 0: Polling API Supabase
 *    Core 1: Serveur web + LEDs + Horn (loop principale)
 *
 *  IMPORTANT: Les LEDs bleues de la carte MOSFET doivent être shuntées
 *             pour que le signal 3.3V de l'ESP32 soit suffisant.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Update.h>
#include <Preferences.h>

WebServer server(80); // Serveur sur le port 80
WiFiMulti wifiMulti;  // Gestionnaire multi-réseaux WiFi
Preferences prefs;    // Stockage persistant en flash

// ============================================================================
//  CONFIGURATION RÉSEAU (À ADAPTER À TON RÉSEAU LAN)
// ============================================================================
// NOTE: Les WiFi pré-configurés (DLINK, Maison, Hotspot) sont définis
// dans la fonction setup(). Aucun SSID unique requis ici.

// Podium servi par ce boîtier. Flasher un boîtier en "A" et l'autre en "B".
const char* PODIUM_ID = "A";

// ============================================================================
//  URL & CLÉS SUPABASE (DYNAMIQUE SELON LE RÉSEAU)
// ============================================================================

// 1. CLOUD (Par défaut, via maison ou 4G)
const char* SUPABASE_URL_CLOUD  = "https://xwaymumbkmwxqifihuvn.supabase.co";
const char* SUPABASE_KEY_CLOUD  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXltdW1ia213eHFpZmlodXZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzY4NzAsImV4cCI6MjA3Nzg1Mjg3MH0.oeFEvXtKxVr006_Y6Sx2-vWYIfmsRKQ-nP9M-awBMU4";

// 2. PLAGE / LAN (via HP Box sur routeur DLINK)
const char* SUPABASE_URL_LOCAL  = "http://192.168.1.2:8000";
const char* SUPABASE_KEY_LOCAL  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODY3NjA0MDV9.R7dF61lzIX8Zj2AQxZVQ2cltHnjQX0t-I1QckuSNLyA";

// Résolution dynamique selon le réseau connecté
String getSupabaseUrl() {
    if (WiFi.SSID() == "DLINK") return SUPABASE_URL_LOCAL;
    return SUPABASE_URL_CLOUD;
}

String getSupabaseKey() {
    if (WiFi.SSID() == "DLINK") return SUPABASE_KEY_LOCAL;
    return SUPABASE_KEY_CLOUD;
}

// Intervalle de polling dynamique
// LAN (DLINK) = 500ms pour réactivité max, Cloud (HTTPS) = 5s pour la RAM
unsigned long getPollInterval() {
    if (WiFi.SSID() == "DLINK") return 500;
    return 5000;
}

String getPodiumId() {
    String podium = String(PODIUM_ID);
    podium.trim();
    podium.toUpperCase();
    return podium.length() > 0 ? podium : "A";
}

// ============================================================================
//  HORN 24V (via module relais)
// ============================================================================

const int HORN_PIN = 5;                     // GPIO 5 → IN du module relais
const unsigned long HORN_START_MS = 3000;    // Durée horn début de série (3s)
const unsigned long HORN_END_MS   = 5000;    // Durée horn fin de série (5s)

// ============================================================================
//  CONFIGURATION DES GPIO — 4 MODULES COB RGBW
// ============================================================================
//
//  Chaque module COB = une POSITION de priorité
//    Module 0 = P1 (Priorité absolue)
//    Module 1 = P2 (2ème priorité)
//    Module 2 = P3 (3ème priorité)
//    Module 3 = P4 (4ème priorité)
//
//  La couleur du LED = la couleur du LYCRA du surfeur qui occupe ce rang

struct CobModule {
    int pinR;
    int pinG;
    int pinB;
    int pinW;
};

// *** ADAPTE LES GPIO À TON CÂBLAGE RÉEL ***
CobModule modules[4] = {
    // Module 0: Position P1 — Carte MOSFET #1
    { .pinR = 18, .pinG = 19, .pinB = 21, .pinW = 22 },

    // Module 1: Position P2 — Carte MOSFET #2
    { .pinR = 23, .pinG = 25, .pinB = 26, .pinW = 27 },

    // Module 2: Position P3 — Carte MOSFET #3
    { .pinR = 32, .pinG = 33, .pinB = 16, .pinW = 17 }, // B=RX2, W=TX2

    // Module 3: Position P4 — Carte MOSFET #4
    //   GPIO 5 réservé au horn, donc canal G déplacé sur GPIO 15
    { .pinR =  4, .pinG = 15, .pinB = 13, .pinW = 14 },
};

const int NUM_MODULES = 4;

// ============================================================================
//  CONFIGURATION PWM
// ============================================================================

const int PWM_FREQ       = 200;   // 200 Hz max pour la carte ANMBEST
const int PWM_RESOLUTION = 8;     // 8 bits = 0-255

// ============================================================================
//  COULEURS DES LYCRAS (RGBW, ce que le LED affiche)
// ============================================================================

struct RGBW {
    uint8_t r, g, b, w;
};

// Couleur du LED = couleur du lycra du surfeur
const RGBW LYCRA_ROUGE   = { 255,   0,   0,   0 };  // Lycra rouge
const RGBW LYCRA_BLANC   = {   0,   0,   0, 255 };  // Lycra blanc
const RGBW LYCRA_JAUNE   = { 255, 180,   0,   0 };  // Jaune validé: R=255 + G=180
const RGBW LYCRA_BLEU    = {   0,   0, 255,   0 };  // Lycra bleu
const RGBW LYCRA_VERT    = {   0, 255,   0,   0 };  // Lycra vert
const RGBW COLOR_EQUAL   = {   0,   0,   0, 120 };  // Priorité égale (blanc doux)
const RGBW COLOR_OFF     = {   0,   0,   0,   0 };  // Éteint

// Prototypes des fonctions utilisant la structure RGBW
RGBW lycraToColor(String lycra);
void setModuleColor(int moduleIndex, RGBW color);

// ============================================================================
//  VARIABLES GLOBALES
// ============================================================================

unsigned long lastPollTime = 0;
bool wifiConnected = false;
String currentHeatId = "";
int consecutiveErrors = 0;

// Debug : dernière réponse API
int lastHttpCode = 0;
String lastHeatStatus = "";
String lastJsonError = "";
int lastResultCount = 0;
String lastHttpError = "";  // Message d'erreur HTTP détaillé
volatile int pollCount = 0;  // Compteur de polls (vérifie que la tâche tourne)

// Flag pour signaler au Core 1 que les états ont changé (thread-safe)
volatile bool statesUpdated = false;

// État actuel de chaque module (= chaque position de priorité)
struct ModuleState {
    int priorityRank;   // 0 = equal, 1 = P, 2, 3, 4, -1 = off
    String lycraColor;  // Couleur du lycra du surfeur à cette position
    RGBW color;         // Couleur LED correspondante
    RGBW currentColor;  // Couleur actuellement affichée (pour le fondu)
};

ModuleState moduleStates[4] = {};

// Horn : contrôlé depuis Core 1, déclenché par Core 0
volatile bool hornTrigger = false;           // Core 0 met à true pour déclencher
volatile unsigned long hornRequestedMs = 0;  // Durée demandée
bool hornActive = false;                     // Horn en cours (Core 1 seulement)
unsigned long hornStartTime = 0;             // Début du horn
unsigned long hornDurationMs = 0;            // Durée du horn en cours

// Timer du heat (reçu du polling) pour le clignotement fin de série
volatile long heatRemainingSeconds = -1;  // -1 = pas de timer actif

// Suivi de l'état précédent du heat (pour détecter les transitions)
String previousHeatStatus = "";

// Suivi du clignotement pour restaurer les couleurs à la sortie des 30 dernières secondes
bool endBlinkWasActive = false;

// Prototypes de fonctions (requis pour éviter les erreurs de scope C++ avec arguments par défaut)
void connectWiFi(bool blocking = false);
void applyPriorityStateFromRow(JsonObject row);
void clearActivePriority();
void runSSEClient();
void parseAndApplySSEPayload(String payload);
String getSseHost();
uint16_t getSsePort();

// ============================================================================
//  SETUP
// ============================================================================

void setup() {
    delay(2000); // Temps de stabilisation pour l'alimentation externe
    Serial.begin(115200);
    delay(1000);

    Serial.println("================================================");
    Serial.println("  SURF JUDGING — PRIORITY + HORN CONTROLLER v2.1");
    Serial.println("================================================");
    Serial.println();

    // Initialiser les PWM — assignation EXPLICITE des 16 canaux LEDC
    // (l'auto-assignation par ledcAttach peut échouer pour les derniers canaux)
    int ledcChannel = 0;
    for (int m = 0; m < NUM_MODULES; m++) {
        int pins[] = {modules[m].pinR, modules[m].pinG, modules[m].pinB, modules[m].pinW};
        const char* names[] = {"R", "G", "B", "W"};
        
        Serial.printf("  P%d: ", m+1);
        for (int c = 0; c < 4; c++) {
            // Désactiver tout pull-up/pull-down interne (surtout GPIO 5)
            pinMode(pins[c], OUTPUT);
            digitalWrite(pins[c], LOW);
            
            bool ok = ledcAttachChannel(pins[c], PWM_FREQ, PWM_RESOLUTION, ledcChannel);
            Serial.printf("%s=%d(ch%d:%s) ", names[c], pins[c], ledcChannel, ok ? "OK" : "FAIL");
            ledcChannel++;
        }
        Serial.println();
    }

    // TEST DIAGNOSTIC : allume chaque canal de chaque module 1 par 1
    Serial.println("\n  === TEST HARDWARE ===");
    const char* channelNames[] = {"R", "G", "B", "W"};
    for (int m = 0; m < NUM_MODULES; m++) {
        int pins[] = {modules[m].pinR, modules[m].pinG, modules[m].pinB, modules[m].pinW};
        for (int c = 0; c < 4; c++) {
            ledcWrite(pins[c], 255);
            Serial.printf("  P%d %s (GPIO %d) = ON\n", m+1, channelNames[c], pins[c]);
            delay(400);
            ledcWrite(pins[c], 0);
        }
    }

    // TEST BLEU DÉDIÉ : garde TOUS les canaux B allumés 3 secondes
    // Si la COB ne s'allume pas en bleu -> problème hardware (shunt)
    // Si la COB s'allume en bleu -> OK, les micro-LEDs MOSFET sont juste shuntées
    Serial.println("\n  >>> TEST BLEU 3s - REGARDE LA COB <<<");
    for (int m = 0; m < NUM_MODULES; m++) {
        ledcWrite(modules[m].pinB, 255);
        Serial.printf("  P%d B (GPIO %d) = BLEU ON\n", m+1, modules[m].pinB);
    }
    delay(3000);
    // Éteindre
    for (int m = 0; m < NUM_MODULES; m++) {
        ledcWrite(modules[m].pinB, 0);
    }
    Serial.println("  >>> FIN TEST BLEU <<<");

    // TEST BLEU avec digitalWrite (bypass LEDC) pour comparaison
    Serial.println("\n  >>> TEST BLEU GPIO DIRECT 3s <<<");
    for (int m = 0; m < NUM_MODULES; m++) {
        ledcDetach(modules[m].pinB);  // Libérer LEDC
        pinMode(modules[m].pinB, OUTPUT);
        digitalWrite(modules[m].pinB, HIGH);
        Serial.printf("  P%d B (GPIO %d) = digitalWrite HIGH\n", m+1, modules[m].pinB);
    }
    delay(3000);
    for (int m = 0; m < NUM_MODULES; m++) {
        digitalWrite(modules[m].pinB, LOW);
    }
    Serial.println("  >>> FIN TEST GPIO DIRECT <<<");

    // Réattacher LEDC sur les canaux B
    int bChannels[] = {2, 6, 10, 14};  // Canaux LEDC des B
    for (int m = 0; m < NUM_MODULES; m++) {
        ledcAttachChannel(modules[m].pinB, PWM_FREQ, PWM_RESOLUTION, bChannels[m]);
    }

    Serial.println("  === FIN TEST ===\n");

    Serial.println();

    // Configurer la liste des réseaux WiFi pré-configurés
    // wifiMulti se connectera automatiquement au meilleur réseau disponible.
    
    // 1. Mode Plage (DLINK) — Note: Mettre le mot de passe s'il y en a un
    wifiMulti.addAP("DLINK", ""); 
    
    // 2. Réseau Maison (ext-LARAISE Fam)
    wifiMulti.addAP("ext-LARAISE FAM 2.4ghz", "mekouLar");
    
    // 3. Réseau Maison (Variante sans "FAM")
    wifiMulti.addAP("ext-LARAISE 2.4ghz", "mekouLar");
    
    // 4. Hotspot Téléphone (AndroidAP)
    wifiMulti.addAP("AndroidAP", "12345678");

    Serial.println("📡 Initialisation WiFiMulti...");

    // Connexion WiFi (mode bloquant au démarrage)
    connectWiFi(true);

    // Configuration du serveur Web de diagnostic
    setupWebServer();

    // Animation de démarrage — balayer toutes les couleurs
    startupAnimation();

    // Synchroniser l'état logiciel avec le blanc doux affiché après l'animation.
    // Sans cela, le premier fondu partirait de noir alors que les panneaux sont déjà en veille.
    for (int m = 0; m < NUM_MODULES; m++) {
        moduleStates[m].priorityRank = 0;
        moduleStates[m].lycraColor = "";
        moduleStates[m].color = COLOR_EQUAL;
        moduleStates[m].currentColor = COLOR_EQUAL;
    }

    // Initialiser le horn
    pinMode(HORN_PIN, OUTPUT);
    digitalWrite(HORN_PIN, LOW);  // Horn éteint au démarrage
    Serial.printf("  Horn : GPIO %d (relais)\n", HORN_PIN);

    Serial.println();
    Serial.println("🏄 Système prêt.");

    // mDNS : accessible via http://priority.local
    if (MDNS.begin("priority")) {
        MDNS.addService("http", "tcp", 80);
        Serial.println("📡 mDNS: http://priority.local");
    }

    Serial.println();

    // Lancer le polling HTTPS sur le Core 0 (2ème processeur)
    // Le Core 1 (loop) reste libre pour le serveur web et les LEDs
    xTaskCreatePinnedToCore(
        pollingTask,       // Fonction de la tâche
        "SupabasePolling", // Nom
        32768,             // Stack: 32 KB (TLS en a besoin de ~16 KB)
        NULL,              // Paramètres
        1,                 // Priorité
        NULL,              // Handle
        0                  // Core 0 (le 2ème processeur)
    );
}

// ============================================================================
//  TÂCHE DE POLLING (Core 0 — séparé du serveur web)
// ============================================================================

void pollingTask(void *parameter) {
    Serial.println("📡 Polling/SSE démarré sur Core 0");
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            if (WiFi.SSID() == "DLINK") {
                // Sur le LAN de la plage, utiliser le streaming SSE haute-vitesse
                runSSEClient();
            } else {
                // Sur le Cloud (ou autre réseau), utiliser le polling HTTP classique
                pollPriorityState();
                vTaskDelay(pdMS_TO_TICKS(getPollInterval()));
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }
}

// ============================================================================
//  LOOP PRINCIPAL (Core 1 — serveur web + LEDs)
// ============================================================================

void loop() {
    unsigned long now = millis();

    // Gérer la reconnexion WiFi
    if (WiFi.status() != WL_CONNECTED) {
        if (wifiConnected) {
            Serial.println("⚠️  WiFi déconnecté !");
            wifiConnected = false;
            for (int m = 0; m < NUM_MODULES; m++) {
                setModuleColor(m, COLOR_EQUAL);
                moduleStates[m].currentColor = COLOR_EQUAL;
            }
        }
        connectWiFi();
        return;
    }

    if (!wifiConnected) {
        wifiConnected = true;
        Serial.printf("✅ WiFi connecté ! IP: %s\n", WiFi.localIP().toString().c_str());
    }

    // ── FONDU ANIMÉ des LEDs (crossfade 200ms) ──
    if (statesUpdated) {
        statesUpdated = false;
        // Fondu progressif sur 10 étapes (200ms total)
        const int FADE_STEPS = 10;
        const int FADE_DELAY = 20; // ms par étape
        
        RGBW startColors[4];
        RGBW endColors[4];
        for (int m = 0; m < NUM_MODULES; m++) {
            startColors[m] = moduleStates[m].currentColor;
            endColors[m] = moduleStates[m].color;
        }
        
        for (int step = 1; step <= FADE_STEPS; step++) {
            float t = (float)step / FADE_STEPS;
            for (int m = 0; m < NUM_MODULES; m++) {
                RGBW c;
                c.r = startColors[m].r + (endColors[m].r - startColors[m].r) * t;
                c.g = startColors[m].g + (endColors[m].g - startColors[m].g) * t;
                c.b = startColors[m].b + (endColors[m].b - startColors[m].b) * t;
                c.w = startColors[m].w + (endColors[m].w - startColors[m].w) * t;
                setModuleColor(m, c);
            }
            delay(FADE_DELAY);
        }
        
        // Enregistrer la couleur finale
        for (int m = 0; m < NUM_MODULES; m++) {
            moduleStates[m].currentColor = moduleStates[m].color;
        }
    }

    // ── CLIGNOTEMENT FIN DE SÉRIE ──
    // Dernières 30s : clignotement lent (500ms). Dernières 10s : rapide (150ms).
    bool endBlinkActive = (
        heatRemainingSeconds >= 0 &&
        heatRemainingSeconds <= 30 &&
        lastHeatStatus == "running"
    );

    if (endBlinkActive) {
        int blinkInterval = (heatRemainingSeconds <= 10) ? 150 : 500;
        bool ledOn = ((now / blinkInterval) % 2 == 0);

        for (int m = 0; m < NUM_MODULES; m++) {
            setModuleColor(m, ledOn ? moduleStates[m].color : COLOR_OFF);
        }
    } else if (endBlinkWasActive) {
        // Important : si le clignotement se termine pendant une phase OFF,
        // réafficher immédiatement les couleurs normales.
        for (int m = 0; m < NUM_MODULES; m++) {
            setModuleColor(m, moduleStates[m].color);
            moduleStates[m].currentColor = moduleStates[m].color;
        }
    }

    endBlinkWasActive = endBlinkActive;

    // Contrôle du horn (non-bloquant)
    if (hornTrigger) {
        hornTrigger = false;
        hornActive = true;
        hornDurationMs = hornRequestedMs;
        hornStartTime = millis();
        digitalWrite(HORN_PIN, HIGH);
        Serial.printf(">> HORN ON (%d ms)\n", hornDurationMs);
    }

    if (hornActive && (millis() - hornStartTime >= hornDurationMs)) {
        hornActive = false;
        digitalWrite(HORN_PIN, LOW);
        Serial.println(">> HORN OFF");
    }

    // Gérer les requêtes web
    server.handleClient();
}

// ============================================================================
//  CONNEXION WIFI
// ============================================================================

void connectWiFi(bool blocking) {
    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        return;
    }

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    
    if (blocking) {
        Serial.println("📡 Recherche des réseaux pré-configurés (DLINK, Maison, AndroidAP)...");
        int attempts = 0;
        // Mode bloquant : attend le réseau au démarrage
        while (wifiMulti.run() != WL_CONNECTED && attempts < 15) {
            delay(1000);
            Serial.print(".");
            attempts++;
        }
    } else {
        // Mode non-bloquant pour la loop principal : tente une fois
        static unsigned long lastReconnectAttempt = 0;
        if (millis() - lastReconnectAttempt > 5000) { // Tenter toutes les 5s max
            lastReconnectAttempt = millis();
            Serial.println("📡 [WiFiMulti] Tentative de reconnexion en arrière-plan...");
            wifiMulti.run();
        }
    }

    if (WiFi.status() == WL_CONNECTED) {
        if (!wifiConnected) {
            Serial.println();
            Serial.print("✅ Connecté avec succès ! SSID : ");
            Serial.println(WiFi.SSID());
            Serial.printf("   IP locale : %s\n", WiFi.localIP().toString().c_str());
            wifiConnected = true;
        }
    } else {
        if (blocking) {
            Serial.println("\n❌ Aucun réseau disponible pour l'instant. Démarrage en mode veille.");
        }
        wifiConnected = false;
    }
}

// ============================================================================
//  POLLING DE L'API SUPABASE
// ============================================================================

void pollPriorityState() {
    pollCount++;

    // Client TLS persistant — créé une seule fois, réutilisé
    // Évite la fuite mémoire de ~40KB à chaque new/delete
    static WiFiClientSecure secureClient;
    static bool tlsInit = false;
    HTTPClient http;

    if (!tlsInit) {
        secureClient.setInsecure();
        secureClient.setTimeout(10);
        tlsInit = true;
        Serial.println("🔐 TLS initialisé");
    }

    String activeUrl = getSupabaseUrl();
    String activeKey = getSupabaseKey();
    String url = activeUrl + "/rest/v1/rpc/get_active_priority?p_podium_id=" + getPodiumId();

    if (activeUrl.startsWith("https")) {
        http.begin(secureClient, url);
    } else {
        http.begin(url); // Mode HTTP simple pour la plage
    }

    http.setTimeout(10000);
    http.addHeader("apikey", activeKey);
    http.addHeader("Authorization", String("Bearer ") + activeKey);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();

    if (httpCode != 200) {
        if (httpCode > 0) {
            Serial.printf("⚠️  HTTP %d\n", httpCode);
            lastHttpError = "HTTP " + String(httpCode);
        } else {
            Serial.printf("❌ %s\n", http.errorToString(httpCode).c_str());
            lastHttpError = http.errorToString(httpCode);
            consecutiveErrors++;
            // Recréer le client TLS après 5 erreurs
            if (consecutiveErrors % 5 == 0) {
                secureClient.stop();
                tlsInit = false;
                Serial.println("🔄 Reset TLS");
            }
            if (consecutiveErrors > 30) ESP.restart();
        }
        http.end();
        lastHttpCode = httpCode;
        return;
    }

    consecutiveErrors = 0;
    lastHttpCode = httpCode;
    lastHttpError = "";

    String payload = http.getString();
    http.end();

    Serial.printf("📦 #%d: %d b, RAM: %d\n", pollCount, payload.length(), ESP.getFreeHeap());

    JsonDocument doc;
    DeserializationError jsonError = deserializeJson(doc, payload);
    payload = String(); // Libérer immédiatement

    if (jsonError) {
        Serial.printf("❌ JSON: %s\n", jsonError.c_str());
        lastJsonError = String(jsonError.c_str());
        return;
    }
    lastJsonError = "";

    JsonArray results = doc.as<JsonArray>();
    lastResultCount = results.size();

    if (results.size() == 0) {
        clearActivePriority();
        return;
    }

    // La réponse RPC retourne : heat_id, status, priority_state, surfers
    JsonObject row = results[0];
    applyPriorityStateFromRow(row);
}

// ============================================================================
//  LAYOUT PRIORITY STATE APPLICATION ENGINE
// ============================================================================

void applyPriorityStateFromRow(JsonObject row) {
    String heatId = row["heat_id"].as<String>();
    String heatStatus = row["status"].as<String>();

    lastHeatStatus = heatStatus;

    // Extraire le temps restant du timer (pour le clignotement fin de série)
    if (row.containsKey("timer_remaining_seconds") && !row["timer_remaining_seconds"].isNull()) {
        heatRemainingSeconds = row["timer_remaining_seconds"].as<long>();
    } else {
        heatRemainingSeconds = -1; // Pas de timer disponible
    }

    // === DÉTECTION DES TRANSITIONS POUR LE HORN ===
    if (previousHeatStatus != "" && previousHeatStatus != heatStatus) {
        // Début de série : waiting → running
        if (previousHeatStatus == "waiting" && heatStatus == "running") {
            Serial.println("📯 HORN: DÉBUT DE SÉRIE !");
            hornRequestedMs = HORN_START_MS;
            hornTrigger = true;
        }
        // Fin de série : running → finished ou closed
        if (previousHeatStatus == "running" &&
            (heatStatus == "finished" || heatStatus == "closed")) {
            Serial.println("📯 HORN: FIN DE SÉRIE !");
            hornRequestedMs = HORN_END_MS;
            hornTrigger = true;
        }
    }
    previousHeatStatus = heatStatus;

    // Ignorer les heats terminés
    if (heatStatus != "running" && heatStatus != "waiting" && heatStatus != "paused") {
        clearActivePriority();
        return;
    }

    if (heatId != currentHeatId) {
        Serial.printf("🏄 %s (%s)\n", heatId.c_str(), heatStatus.c_str());
        currentHeatId = heatId;
    }

    // Champs retournés par la fonction RPC: priority_state (pas priorityState)
    JsonObject priorityState = row["priority_state"];

    // Si pas de priorityState, mode equal
    if (priorityState.isNull()) {
        applyEqualPriority();
        return;
    }

    String mode = priorityState["mode"].as<String>();

    if (mode == "equal") {
        applyEqualPriority();
        return;
    }

    // LOGIQUE : Module 0 = P1, Module 1 = P2, etc.
    // La couleur du LED = couleur du lycra du surfeur à ce rang
    JsonArray order = priorityState["order"];
    int orderSize = 0;
    for (JsonVariant v : order) orderSize++;

    for (int m = 0; m < NUM_MODULES; m++) {
        RGBW targetColor;
        String lycra = "";
        int rank;

        if (m < orderSize) {
            rank = m + 1;
            String rawColor = order[m];
            lycra = normalizeColor(rawColor);
            targetColor = lycraToColor(lycra);
        } else {
            // Pas encore au lineup = éteint
            rank = 0;
            targetColor = COLOR_OFF;
        }

        bool changed = (moduleStates[m].priorityRank != rank ||
                        moduleStates[m].lycraColor != lycra);

        moduleStates[m].priorityRank = rank;
        moduleStates[m].lycraColor = lycra;
        moduleStates[m].color = targetColor;

        if (changed) {
            statesUpdated = true;
            Serial.printf("  P%d: %s\n", rank, lycra.c_str());
        }
    }
}

// ============================================================================
//  CLEAR / STANDBY MODE APPLICATION
// ============================================================================

void clearActivePriority() {
    bool changed = (currentHeatId != "");
    currentHeatId = "";

    for (int m = 0; m < NUM_MODULES; m++) {
        if (moduleStates[m].priorityRank != 0 ||
            moduleStates[m].lycraColor.length() > 0 ||
            moduleStates[m].color.r != COLOR_EQUAL.r ||
            moduleStates[m].color.g != COLOR_EQUAL.g ||
            moduleStates[m].color.b != COLOR_EQUAL.b ||
            moduleStates[m].color.w != COLOR_EQUAL.w) {
            changed = true;
        }

        moduleStates[m].priorityRank = 0;
        moduleStates[m].lycraColor = "";
        moduleStates[m].color = COLOR_EQUAL;
    }

    if (changed) {
        Serial.println("⏸️  Veille.");
        statesUpdated = true;
    }
}

// ============================================================================
//  DYNAMIC HOST PARSING & REAL-TIME SSE STREAMING (BEACH LAN ONLY)
// ============================================================================

String getSseHost() {
    // Exemple : SUPABASE_URL_LOCAL = "http://192.168.1.2:8000"
    String url = SUPABASE_URL_LOCAL;
    int schemeEnd = url.indexOf("://");
    if (schemeEnd != -1) {
        url = url.substring(schemeEnd + 3);
    }

    int pathStart = url.indexOf('/');
    if (pathStart != -1) {
        url = url.substring(0, pathStart);
    }

    int portSeparator = url.lastIndexOf(':');
    if (portSeparator != -1) {
        url = url.substring(0, portSeparator);
    }

    return url;
}

uint16_t getSsePort() {
    String url = SUPABASE_URL_LOCAL;
    int schemeEnd = url.indexOf("://");
    if (schemeEnd != -1) {
        url = url.substring(schemeEnd + 3);
    }

    int pathStart = url.indexOf('/');
    if (pathStart != -1) {
        url = url.substring(0, pathStart);
    }

    int portSeparator = url.lastIndexOf(':');
    if (portSeparator != -1) {
        int parsedPort = url.substring(portSeparator + 1).toInt();
        if (parsedPort > 0 && parsedPort <= 65535) {
            return static_cast<uint16_t>(parsedPort);
        }
    }

    return 80;
}

void parseAndApplySSEPayload(String payload) {
    JsonDocument doc;
    DeserializationError jsonError = deserializeJson(doc, payload);
    
    if (jsonError) {
        Serial.printf("❌ SSE JSON: %s\n", jsonError.c_str());
        return;
    }
    
    if (!doc.containsKey("event")) return;
    
    String event = doc["event"].as<String>();
    
    if (event == "priority_update") {
        if (doc["data"].isNull()) {
            clearActivePriority();
        } else {
            JsonObject data = doc["data"].as<JsonObject>();
            applyPriorityStateFromRow(data);
        }
    }
}

void runSSEClient() {
    WiFiClient client;
    String host = getSseHost();
    uint16_t port = getSsePort();
    
    Serial.printf("📡 SSE: Connexion à %s:%d...\n", host.c_str(), port);
    
    if (!client.connect(host.c_str(), port)) {
        Serial.println("❌ SSE: Échec de connexion au serveur LAN. Repli.");
        vTaskDelay(pdMS_TO_TICKS(5000));
        return;
    }
    
    Serial.println("✅ SSE: Connecté ! Envoi de la requête GET /priority/sse...");
    
    client.print("GET /priority/sse?podium=" + getPodiumId() + " HTTP/1.1\r\n");
    client.print("Host: " + host + "\r\n");
    client.print("Accept: text/event-stream\r\n");
    client.print("Connection: keep-alive\r\n");
    client.print("\r\n");
    
    // Attendre la réponse HTTP (headers)
    unsigned long timeout = millis();
    while (client.connected() && !client.available()) {
        if (millis() - timeout > 5000) {
            Serial.println("❌ SSE: Timeout d'attente de réponse du serveur.");
            client.stop();
            return;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    
    // Lire les headers jusqu'à la ligne vide
    while (client.connected() && client.available()) {
        String line = client.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) {
            break; // Fin des headers HTTP
        }
    }
    
    Serial.println("👂 SSE: Écoute des événements en cours...");
    consecutiveErrors = 0;
    unsigned long lastKeepAlive = millis();
    
    while (client.connected() && WiFi.status() == WL_CONNECTED) {
        if (client.available()) {
            String line = client.readStringUntil('\n');
            lastKeepAlive = millis(); // Réinitialiser le timer keep-alive
            
            if (line.startsWith("data: ")) {
                String payload = line.substring(6);
                payload.trim();
                Serial.println("📦 SSE data: " + payload);
                parseAndApplySSEPayload(payload);
            }
        } else {
            // Heartbeat check : reconnexion si aucun keep-alive pendant 45 secondes
            if (millis() - lastKeepAlive > 45000) {
                Serial.println("⚠️ SSE: Pas d'activité depuis 45s, reconnexion...");
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }
    
    Serial.println("🔌 SSE: Déconnecté du serveur LAN.");
    client.stop();
    vTaskDelay(pdMS_TO_TICKS(2000));
}

// ============================================================================
//  NORMALISATION DES NOMS DE COULEURS
// ============================================================================

String normalizeColor(String color) {
    color.trim();
    color.toUpperCase();

    // Mapper les noms anglais vers français (comme dans DisplayPage.tsx)
    if (color == "RED")    return "ROUGE";
    if (color == "WHITE")  return "BLANC";
    if (color == "YELLOW") return "JAUNE";
    if (color == "BLUE")   return "BLEU";
    if (color == "GREEN")  return "VERT";

    return color;
}

// Convertir un nom de lycra en couleur RGBW pour le LED
RGBW lycraToColor(String lycra) {
    if (lycra == "ROUGE") return LYCRA_ROUGE;
    if (lycra == "BLANC") return LYCRA_BLANC;
    if (lycra == "JAUNE") return LYCRA_JAUNE;
    if (lycra == "BLEU")  return LYCRA_BLEU;
    if (lycra == "VERT")  return LYCRA_VERT;
    return COLOR_EQUAL;  // Couleur inconnue = blanc doux
}

void applyEqualPriority() {
    bool changed = false;
    for (int m = 0; m < NUM_MODULES; m++) {
        if (moduleStates[m].priorityRank != 0) {
            changed = true;
        }
        moduleStates[m].priorityRank = 0;
        moduleStates[m].lycraColor = "";
        moduleStates[m].color = COLOR_EQUAL;
    }
    if (changed) {
        statesUpdated = true;
        Serial.println("≡ ÉGALE");
    }
}

// ============================================================================
//  CONTRÔLE DES MODULES COB
// ============================================================================

void setModuleColor(int moduleIndex, RGBW color) {
    if (moduleIndex < 0 || moduleIndex >= NUM_MODULES) return;

    ledcWrite(modules[moduleIndex].pinR, color.r);
    ledcWrite(modules[moduleIndex].pinG, color.g);
    ledcWrite(modules[moduleIndex].pinB, color.b);
    ledcWrite(modules[moduleIndex].pinW, color.w);
}

// ============================================================================
//  ANIMATION DE DÉMARRAGE
// ============================================================================

void startupAnimation() {
    Serial.println("🎬 Animation...");

    // Balayage rapide : allumer chaque module un par un en blanc
    for (int m = 0; m < NUM_MODULES; m++) {
        setModuleColor(m, { 0, 0, 0, 200 });
        delay(150);
    }
    delay(200);

    // Tout éteindre
    for (int m = 0; m < NUM_MODULES; m++) {
        setModuleColor(m, COLOR_OFF);
    }
    delay(100);

    // Mode veille (blanc doux)
    for (int m = 0; m < NUM_MODULES; m++) {
        setModuleColor(m, COLOR_EQUAL);
    }

    Serial.println("✅ Prêt.");
}
// ============================================================================
//  SERVEUR WEB DE DIAGNOSTIC
// ============================================================================

void setupWebServer() {
    // ── PAGE PRINCIPALE ──
    server.on("/", []() {
        String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
        html += "<title>Priority Control v2.1</title>";
        html += "<style>body{font-family:sans-serif;background:#1a1a1a;color:white;padding:20px;max-width:600px;margin:0 auto}";
        html += ".card{background:#333;padding:15px;border-radius:10px;margin-bottom:10px}";
        html += ".status{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}";
        html += ".online{background:#4CAF50}.offline{background:#f44336}";
        html += ".module{display:inline-block;width:60px;height:60px;border:2px solid #555;border-radius:8px;margin:5px;text-align:center;line-height:60px;font-weight:bold}";
        html += ".btn{display:inline-block;padding:8px 16px;background:#2196F3;color:white;border-radius:6px;text-decoration:none;margin:4px;font-size:14px}";
        html += ".timer-warn{color:#ff9800;font-weight:bold;animation:blink 1s infinite}";
        html += "@keyframes blink{50%{opacity:0.3}}";
        html += "</style><script>setTimeout(function(){location.reload();},2000);</script></head><body>";
        
        html += "<h1>🏄 Priority v2.1</h1>";
        
        // WiFi
        html += "<div class='card'>";
        html += "<div><span class='status online'></span> " + WiFi.SSID() + " (" + String(WiFi.RSSI()) + " dBm)</div>";
        html += "<div>IP: " + WiFi.localIP().toString() + " | <a href='http://priority.local' style='color:#4fc3f7'>priority.local</a></div>";
        html += "<div>Podium: " + getPodiumId() + "</div>";
        html += "<div>Polling: " + String(getPollInterval()) + "ms | Mode: " + (WiFi.SSID() == "DLINK" ? "🏖️ LAN" : "☁️ Cloud") + "</div>";
        html += "</div>";

        // Heat + Timer
        html += "<div class='card'>";
        if (currentHeatId == "") {
            html += "<p style='color:#888'>Aucun heat en cours (Mode Veille)</p>";
        } else {
            html += "<p style='font-size:24px;font-weight:bold'>Heat: " + currentHeatId + " [" + lastHeatStatus + "]</p>";
            if (heatRemainingSeconds >= 0) {
                int mins = heatRemainingSeconds / 60;
                int secs = heatRemainingSeconds % 60;
                String timerClass = (heatRemainingSeconds <= 30) ? "timer-warn" : "";
                html += "<p class='" + timerClass + "'>⏱ " + String(mins) + ":" + (secs < 10 ? "0" : "") + String(secs) + "</p>";
            }
        }
        html += "</div>";

        // Modules
        html += "<div class='card'><h2>Positions</h2>";
        String posLabels[] = {"P", "2", "3", "4"};
        for (int m = 0; m < NUM_MODULES; m++) {
            String colorStyle = "background:rgb(" + String(moduleStates[m].color.r) + "," + String(moduleStates[m].color.g) + "," + String(moduleStates[m].color.b) + ");";
            if (moduleStates[m].color.r == 0 && moduleStates[m].color.g == 0 && moduleStates[m].color.b == 0 && moduleStates[m].color.w > 0) {
                colorStyle = "background:#eee;color:#333;";
            }
            if (moduleStates[m].priorityRank <= 0) colorStyle += "opacity:0.4;";
            html += "<div class='module' style='" + colorStyle + "'>" + (moduleStates[m].priorityRank > 0 ? posLabels[m] : String("=")) + "</div>";
        }
        html += "<p style='font-size:12px;color:#aaa'>";
        for (int m = 0; m < NUM_MODULES; m++) {
            html += posLabels[m] + ":" + (moduleStates[m].lycraColor.length() > 0 ? moduleStates[m].lycraColor : "-") + " ";
        }
        html += "</p></div>";

        // Debug
        html += "<div class='card'><h2>Debug</h2>";
        html += "<div>API: " + getSupabaseUrl() + "</div>";
        html += "<div>HTTP: " + String(lastHttpCode) + " | Polls: " + String(pollCount) + "</div>";
        html += "<div>RAM: " + String(ESP.getFreeHeap()) + " bytes | Errors: " + String(consecutiveErrors) + "</div>";
        if (lastHttpError.length() > 0) html += "<div style='color:#f44336'>" + lastHttpError + "</div>";
        html += "</div>";

        // Horn
        html += "<div class='card'><h2>Horn</h2>";
        html += "<div>GPIO " + String(HORN_PIN) + " — " + String(hornActive ? "🔊 ACTIF" : "🔇 Off") + "</div>";
        html += "</div>";

        // Navigation
        html += "<div style='margin-top:15px'>";
        html += "<a class='btn' href='/update'>📦 OTA Update</a>";
        html += "<a class='btn' href='/wifi'>📶 WiFi Config</a>";
        html += "</div>";

        html += "</body></html>";
        server.send(200, "text/html", html);
    });

    // ── OTA : PAGE DE MISE À JOUR FIRMWARE ──
    server.on("/update", HTTP_GET, []() {
        String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
        html += "<title>OTA Update</title>";
        html += "<style>body{font-family:sans-serif;background:#1a1a1a;color:white;padding:20px;max-width:500px;margin:0 auto}";
        html += ".card{background:#333;padding:20px;border-radius:10px}";
        html += "input[type=file]{margin:10px 0}";
        html += "input[type=submit]{background:#4CAF50;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer}";
        html += "</style></head><body>";
        html += "<h1>📦 OTA Firmware Update</h1>";
        html += "<div class='card'>";
        html += "<p>Version actuelle: v2.1</p>";
        html += "<p>RAM libre: " + String(ESP.getFreeHeap()) + " bytes</p>";
        html += "<form method='POST' action='/update' enctype='multipart/form-data'>";
        html += "<input type='file' name='firmware' accept='.bin'><br>";
        html += "<input type='submit' value='Flasher le firmware'>";
        html += "</form></div>";
        html += "<p><a href='/' style='color:#4fc3f7'>← Retour</a></p>";
        html += "</body></html>";
        server.send(200, "text/html", html);
    });

    server.on("/update", HTTP_POST, []() {
        server.sendHeader("Connection", "close");
        server.send(200, "text/plain", Update.hasError() ? "FAIL" : "OK — Redemarrage...");
        delay(500);
        ESP.restart();
    }, []() {
        HTTPUpload& upload = server.upload();
        if (upload.status == UPLOAD_FILE_START) {
            Serial.printf("OTA: %s\n", upload.filename.c_str());
            if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) Update.printError(Serial);
        } else if (upload.status == UPLOAD_FILE_END) {
            if (Update.end(true)) {
                Serial.printf("OTA OK: %u bytes\n", upload.totalSize);
            } else {
                Update.printError(Serial);
            }
        }
    });

    // ── CONFIG WIFI ──
    server.on("/wifi", HTTP_GET, []() {
        String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
        html += "<title>WiFi Config</title>";
        html += "<style>body{font-family:sans-serif;background:#1a1a1a;color:white;padding:20px;max-width:500px;margin:0 auto}";
        html += ".card{background:#333;padding:15px;border-radius:10px;margin-bottom:10px}";
        html += "input{background:#444;border:1px solid #666;color:white;padding:8px;border-radius:6px;width:100%;margin:4px 0;box-sizing:border-box}";
        html += "button{background:#2196F3;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;margin-top:8px}";
        html += "</style></head><body>";
        html += "<h1>📶 WiFi Config</h1>";
        html += "<div class='card'><p>Connecté: <strong>" + WiFi.SSID() + "</strong> (" + String(WiFi.RSSI()) + " dBm)</p></div>";
        
        // Formulaire pour ajouter un réseau
        html += "<div class='card'><h2>Ajouter un réseau</h2>";
        html += "<form method='POST' action='/wifi'>";
        html += "<input type='text' name='ssid' placeholder='Nom du réseau (SSID)' required>";
        html += "<input type='password' name='pass' placeholder='Mot de passe (vide si ouvert)'>";
        html += "<button type='submit'>Ajouter et reconnecter</button>";
        html += "</form></div>";

        // Réseaux actuels depuis Preferences
        html += "<div class='card'><h2>Réseaux enregistrés</h2>";
        prefs.begin("wifi", true); // Lecture seule
        for (int i = 0; i < 8; i++) {
            String key = "ssid" + String(i);
            String ssid = prefs.getString(key.c_str(), "");
            if (ssid.length() > 0) {
                html += "<div>📶 " + ssid + "</div>";
            }
        }
        prefs.end();
        html += "<p style='font-size:12px;color:#888'>+ DLINK, ext-LARAISE, AndroidAP (codés en dur)</p></div>";

        html += "<p><a href='/' style='color:#4fc3f7'>← Retour</a></p>";
        html += "</body></html>";
        server.send(200, "text/html", html);
    });

    server.on("/wifi", HTTP_POST, []() {
        String ssid = server.arg("ssid");
        String pass = server.arg("pass");
        
        if (ssid.length() > 0) {
            // Sauvegarder dans Preferences
            prefs.begin("wifi", false);
            // Trouver le prochain slot libre
            for (int i = 0; i < 8; i++) {
                String key = "ssid" + String(i);
                String existing = prefs.getString(key.c_str(), "");
                if (existing.length() == 0 || existing == ssid) {
                    prefs.putString(key.c_str(), ssid);
                    prefs.putString(("pass" + String(i)).c_str(), pass);
                    break;
                }
            }
            prefs.end();
            
            // Ajouter au WiFiMulti immédiatement
            wifiMulti.addAP(ssid.c_str(), pass.c_str());
            Serial.printf("📶 Réseau ajouté: %s\n", ssid.c_str());
        }
        
        server.sendHeader("Location", "/wifi");
        server.send(303, "text/plain", "");
    });

    server.begin();
    
    // Charger les réseaux WiFi sauvegardés en flash
    prefs.begin("wifi", true);
    for (int i = 0; i < 8; i++) {
        String ssid = prefs.getString(("ssid" + String(i)).c_str(), "");
        String pass = prefs.getString(("pass" + String(i)).c_str(), "");
        if (ssid.length() > 0) {
            wifiMulti.addAP(ssid.c_str(), pass.c_str());
            Serial.printf("  📶 WiFi flash: %s\n", ssid.c_str());
        }
    }
    prefs.end();
    
    Serial.println("🌐 Serveur web démarré sur http://" + WiFi.localIP().toString());
}
