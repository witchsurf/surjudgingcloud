/**
 * ============================================================================
 *  SURF JUDGING CLOUD — ESP32 PRIORITY LED CONTROLLER
 * ============================================================================
 *
 *  Firmware pour ESP32-WROOM-DA
 *  Port série: /dev/cu.usbserial-1420
 *
 *  Ce firmware pilote 4 modules COB RGBW 24V via des cartes MOSFET ANMBEST
 *  pour afficher les priorités des surfeurs en temps réel.
 *  Il contrôle aussi un horn 24V via un module relais pour les signaux de
 *  début et fin de série.
 *
 *  Architecture:
 *    Core 0: Polling HTTPS Supabase (toutes les 5s)
 *    Core 1: Serveur web + LEDs + Horn (loop principale)
 *
 *  Modules COB (priorité):
 *    Module 0 (P1) : GPIO 18=R, 19=G, 21=B, 22=W
 *    Module 1 (P2) : GPIO 23=R, 25=G, 26=B, 27=W
 *    Module 2 (P3) : GPIO 32=R, 33=G, 16=B, 17=W
 *    Module 3 (P4) : GPIO 4=R,  5=G,  13=B, 14=W
 *
 *  Horn 24V:
 *    GPIO 2 → Module relais → Horn 24V
 *    Début de série: 3s | Fin de série: 5s
 *
 *  IMPORTANT: Les LEDs bleues de la carte MOSFET doivent être shuntées
 *             pour que le signal 3.3V de l’ESP32 soit suffisant.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <WebServer.h>

WebServer server(80); // Serveur sur le port 80
WiFiMulti wifiMulti;  // Gestionnaire multi-réseaux WiFi

// ============================================================================
//  CONFIGURATION RÉSEAU (À ADAPTER À TON RÉSEAU LAN)
// ============================================================================
// NOTE: Les WiFi pré-configurés (DLINK, Maison, Hotspot) sont définis
// dans la fonction setup(). Aucun SSID unique requis ici.

// URL de l'API Supabase Cloud (pour les tests)
// En production terrain, remettre l'IP locale du HP : http://192.168.1.69:8000
const char* SUPABASE_URL  = "https://xwaymumbkmwxqifihuvn.supabase.co";

// Clé anonyme Supabase Cloud
const char* SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXltdW1ia213eHFpZmlodXZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzY4NzAsImV4cCI6MjA3Nzg1Mjg3MH0.oeFEvXtKxVr006_Y6Sx2-vWYIfmsRKQ-nP9M-awBMU4";

// Intervalle de polling en millisecondes
// HTTPS Cloud = 5s pour préserver la RAM, HTTP LAN = rapide (1s)
const unsigned long POLL_INTERVAL_MS = 5000;

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
    { .pinR = 32, .pinG = 33, .pinB = 16, .pinW = 17 },

    // Module 3: Position P4 — Carte MOSFET #4
    //   ⚠️ GPIO 5 inutilisable (pull-up permanent), remplacé par GPIO 15
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
const RGBW LYCRA_JAUNE   = { 255, 200,   0,   0 };  // Lycra jaune
const RGBW LYCRA_BLEU    = {   0,   0, 255,   0 };  // Lycra bleu
const RGBW LYCRA_VERT    = {   0, 255,   0,   0 };  // Lycra vert
const RGBW COLOR_EQUAL   = {   0,   0,   0, 120 };  // Priorité égale (blanc doux)
const RGBW COLOR_OFF     = {   0,   0,   0,   0 };  // Éteint

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
};

ModuleState moduleStates[4] = {};

// Horn : contrôlé depuis Core 1, déclenché par Core 0
volatile bool hornTrigger = false;           // Core 0 met à true pour déclencher
volatile unsigned long hornRequestedMs = 0;  // Durée demandée
bool hornActive = false;                     // Horn en cours (Core 1 seulement)
unsigned long hornStartTime = 0;             // Début du horn
unsigned long hornDurationMs = 0;            // Durée du horn en cours

// Suivi de l'état précédent du heat (pour détecter les transitions)
String previousHeatStatus = "";

// Prototypes de fonctions (requis pour éviter les erreurs de scope C++ avec arguments par défaut)
void connectWiFi(bool blocking = false);

// ============================================================================
//  SETUP
// ============================================================================

void setup() {
    delay(2000); // Temps de stabilisation pour l'alimentation externe
    Serial.begin(115200);
    delay(1000);

    Serial.println("================================================");
    Serial.println("  SURF JUDGING — PRIORITY + HORN CONTROLLER v1.1");
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

    // Initialiser le horn
    pinMode(HORN_PIN, OUTPUT);
    digitalWrite(HORN_PIN, LOW);  // Horn éteint au démarrage
    Serial.printf("  Horn : GPIO %d (relais)\n", HORN_PIN);

    Serial.println();
    Serial.println("🏄 Système prêt.");
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
    Serial.println("📡 Polling HTTPS démarré sur Core 0");
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            pollPriorityState();
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_MS));
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
            }
        }
        connectWiFi();
        return;
    }

    if (!wifiConnected) {
        wifiConnected = true;
        Serial.printf("✅ WiFi connecté ! IP: %s\n", WiFi.localIP().toString().c_str());
    }

    // Mise à jour des LEDs SI le Core 0 a mis à jour les états
    if (statesUpdated) {
        statesUpdated = false;
        for (int m = 0; m < NUM_MODULES; m++) {
            setModuleColor(m, moduleStates[m].color);
        }
    }

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

    String url = String(SUPABASE_URL) + "/rest/v1/rpc/get_active_priority";

    if (String(SUPABASE_URL).startsWith("https")) {
        http.begin(secureClient, url);
    } else {
        http.begin(url);
    }

    http.setTimeout(10000);
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
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
        if (currentHeatId != "") {
            Serial.println("⏸️  Veille.");
            currentHeatId = "";
            for (int m = 0; m < NUM_MODULES; m++) {
                moduleStates[m].priorityRank = 0;
                moduleStates[m].lycraColor = "";
                moduleStates[m].color = COLOR_EQUAL;
            }
            statesUpdated = true;
        }
        return;
    }

    // La réponse RPC retourne : heat_id, status, priority_state, surfers
    JsonObject row = results[0];
    String heatId = row["heat_id"].as<String>();
    String heatStatus = row["status"].as<String>();

    lastHeatStatus = heatStatus;

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
        if (currentHeatId != "") {
            currentHeatId = "";
            for (int m = 0; m < NUM_MODULES; m++) {
                moduleStates[m].priorityRank = 0;
                moduleStates[m].lycraColor = "";
                moduleStates[m].color = COLOR_EQUAL;
            }
            statesUpdated = true;
        }
        return;
    }

    if (heatId != currentHeatId) {
        Serial.printf("🏄 %s (%s)\n", heatId.c_str(), heatStatus.c_str());
        currentHeatId = heatId;
    }

    // Champs retournés par la fonction RPC: priority_state (pas priorityState)
    JsonObject priorityState = row["priority_state"];
    JsonArray surfers = row["surfers"];

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
    server.on("/", []() {
        String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
        html += "<title>Priority Control Debug</title>";
        html += "<style>body{font-family:sans-serif;background:#1a1a1a;color:white;padding:20px} .card{background:#333;padding:15px;border-radius:10px;margin-bottom:10px}";
        html += ".status{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}";
        html += ".online{background:#4CAF50} .offline{background:#f44336} .priority{font-size:24px;font-weight:bold}";
        html += ".module{display:inline-block;width:60px;height:60px;border:2px solid #555;border-radius:8px;margin:5px;text-align:center;line-height:60px;font-weight:bold}";
        html += "</style><script>setTimeout(function(){location.reload();},2000);</script></head><body>";
        
        html += "<h1>Priority LED Debug</h1>";
        
        // WiFi & Alim
        html += "<div class='card'>";
        html += "<div><span class='status online'></span> WiFi: " + WiFi.SSID() + " (" + String(WiFi.RSSI()) + " dBm)</div>";
        html += "<div>IP: " + WiFi.localIP().toString() + "</div>";
        html += "</div>";

        // Heat Status
        html += "<div class='card'>";
        html += "<h2>Heat Actif</h2>";
        if (currentHeatId == "") {
            html += "<p style='color:#888'>Aucun heat en cours (Mode Veille)</p>";
        } else {
            html += "<p class='priority'>ID: " + currentHeatId + "</p>";
        }
        html += "</div>";

        // Modules Status — Position de priorité
        html += "<div class='card'><h2>Positions</h2>";
        String posLabels[] = {"P", "2", "3", "4"};
        for (int m = 0; m < NUM_MODULES; m++) {
            String colorStyle = "background:rgb(" + String(moduleStates[m].color.r) + "," + String(moduleStates[m].color.g) + "," + String(moduleStates[m].color.b) + ");";
            if (moduleStates[m].color.r == 0 && moduleStates[m].color.g == 0 && moduleStates[m].color.b == 0 && moduleStates[m].color.w > 0) {
                colorStyle = "background:#eee;color:#333;";
            }
            if (moduleStates[m].priorityRank <= 0) colorStyle += "opacity:0.4;";

            html += "<div class='module' style='" + colorStyle + "'>";
            if (moduleStates[m].priorityRank > 0) {
                html += posLabels[m];
            } else {
                html += "=";
            }
            html += "</div>";
        }
        // Afficher les lycras assignés
        html += "<p style='font-size:12px;color:#aaa'>";
        for (int m = 0; m < NUM_MODULES; m++) {
            html += posLabels[m] + ":" + (moduleStates[m].lycraColor.length() > 0 ? moduleStates[m].lycraColor : "-") + " ";
        }
        html += "</p>";
        html += "</div>";

        // Debug API
        html += "<div class='card'><h2>API Debug</h2>";
        html += "<div>URL: " + String(SUPABASE_URL) + "</div>";
        html += "<div>HTTP: " + String(lastHttpCode) + "</div>";
        if (lastHttpError.length() > 0) {
            html += "<div style='color:#f44336'>Erreur: " + lastHttpError + "</div>";
        }
        html += "<div>Résultats: " + String(lastResultCount) + "</div>";
        html += "<div>Status heat: " + (lastHeatStatus.length() > 0 ? lastHeatStatus : String("(vide)")) + "</div>";
        if (lastJsonError.length() > 0) {
            html += "<div style='color:#f44336'>JSON Err: " + lastJsonError + "</div>";
        }
        html += "<div>RAM libre: " + String(ESP.getFreeHeap()) + " bytes</div>";
        html += "<div>Erreurs: " + String(consecutiveErrors) + "</div>";
        html += "<div>DNS: " + WiFi.dnsIP().toString() + "</div>";
        html += "<div>Polls: " + String(pollCount) + "</div>";
        html += "</div>";

        // Horn status
        html += "<div class='card'><h2>Horn</h2>";
        html += "<div>GPIO: " + String(HORN_PIN) + "</div>";
        html += "<div>État: " + String(hornActive ? "🔊 ACTIF" : "🔇 Off") + "</div>";
        html += "</div>";

        html += "</body></html>";
        server.send(200, "text/html", html);
    });
    server.begin();
    Serial.println("🌐 Serveur web démarré sur http://" + WiFi.localIP().toString());
}
