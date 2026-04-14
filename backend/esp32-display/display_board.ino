/**
 * ============================================================
 *  SURF JUDGING — TABLEAU D'AFFICHAGE LED COB RGBW
 *  Firmware ESP32 (Arduino Framework)
 * ============================================================
 * 
 * Ce firmware pilote un tableau d'affichage LED composé de :
 *   - 4 chiffres 7-segments (Timer MM:SS) — LED COB RGBW
 *   - 4 panneaux de priorité dynamique — LED COB RGBW (WS2814)
 *   - 1 bande supérieure (vert = début, jaune = 5 dernières min)
 * 
 * L'ESP32 interroge le serveur toutes les 500ms via HTTP GET
 * et décompte le timer localement pour éviter les saccades.
 * 
 * Protocole LED : WS2814 (RGBW 24V) via NeoPixelBus
 * ============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <NeoPixelBus.h>

// =================================================================
// CONFIGURATION — À adapter selon votre installation
// =================================================================

// --- WiFi ---
const char* WIFI_SSID     = "SURF_JUDGING_LAN";   // Nom du réseau plage
const char* WIFI_PASSWORD = "changeme2024";         // Mot de passe WiFi

// --- Serveur ---
const char* SERVER_URL = "http://192.168.1.69:4000/api/iot/display";
const int   POLL_INTERVAL_MS = 500;  // Fréquence de polling (500ms)

// --- LED Configuration ---
// Nombre total de LED sur la chaîne (Data pin unique)
// Timer: 4 chiffres x 7 segments x ~10 LED/segment = 280 LED
// Priorité: 4 panneaux x 60 LED = 240 LED
// Bande: ~100 LED
const int TOTAL_LEDS = 620;

// Pin de données pour les LED WS2814 RGBW
const int LED_DATA_PIN = 16;

// --- Mapping des zones LED ---
// Chaque zone est définie par son offset et sa taille dans la chaîne

// Timer Digit 1 (dizaines de minutes)
const int DIGIT1_OFFSET = 0;
const int LEDS_PER_SEGMENT = 10;  // Nombre de LED par segment de 7-seg

// Timer Digit 2 (unités de minutes)
const int DIGIT2_OFFSET = 70;   // 7 segments x 10 LED

// Timer Digit 3 (dizaines de secondes)
const int DIGIT3_OFFSET = 140;

// Timer Digit 4 (unités de secondes)
const int DIGIT4_OFFSET = 210;

// Panneaux de priorité
const int PRIORITY_OFFSET = 280;
const int LEDS_PER_PRIORITY_PANEL = 60;

// Bande supérieure
const int BAND_OFFSET = 520;
const int BAND_LED_COUNT = 100;

// --- Luminosité ---
const uint8_t BRIGHTNESS_DAY   = 255;  // Plein jour
const uint8_t BRIGHTNESS_NIGHT = 100;  // Soir/Nuit

// =================================================================
// TYPES & STRUCTURES
// =================================================================

struct DisplayState {
  char timer_text[6];       // "MM:SS\0"
  int  remaining_seconds;
  bool is_running;
  char band[10];            // "GREEN", "YELLOW" ou "OFF"
  char priority[4][10];     // 4 couleurs (ex: "ROUGE", "BLANC", ...)
  int  priority_count;
  char status[12];          // "running", "waiting", etc.
  unsigned long server_time;
  unsigned long local_sync_millis;
};

// Table de vérité pour les segments 7-seg
// Segments: A(top), B(top-right), C(bottom-right), D(bottom),
//           E(bottom-left), F(top-left), G(middle)
//           Index:  A  B  C  D  E  F  G
const bool DIGIT_SEGMENTS[10][7] = {
  /* 0 */ { 1, 1, 1, 1, 1, 1, 0 },
  /* 1 */ { 0, 1, 1, 0, 0, 0, 0 },
  /* 2 */ { 1, 1, 0, 1, 1, 0, 1 },
  /* 3 */ { 1, 1, 1, 1, 0, 0, 1 },
  /* 4 */ { 0, 1, 1, 0, 0, 1, 1 },
  /* 5 */ { 1, 0, 1, 1, 0, 1, 1 },
  /* 6 */ { 1, 0, 1, 1, 1, 1, 1 },
  /* 7 */ { 1, 1, 1, 0, 0, 0, 0 },
  /* 8 */ { 1, 1, 1, 1, 1, 1, 1 },
  /* 9 */ { 1, 1, 1, 1, 0, 1, 1 },
};

// =================================================================
// GLOBALS
// =================================================================

// NeoPixelBus pour WS2814 RGBW (méthode DMA, pin unique)
NeoPixelBus<NeoGrbwFeature, NeoEsp32I2s1Ws2812xMethod> strip(TOTAL_LEDS, LED_DATA_PIN);

DisplayState displayState;
DisplayState previousState;

unsigned long lastPollMs  = 0;
unsigned long lastRenderMs = 0;
bool wifiConnected = false;
uint8_t currentBrightness = BRIGHTNESS_DAY;

// =================================================================
// COULEURS RGBW
// =================================================================

RgbwColor colorFromName(const char* name) {
  if (strcmp(name, "ROUGE") == 0 || strcmp(name, "RED") == 0)
    return RgbwColor(255, 0, 0, 0);
  if (strcmp(name, "BLANC") == 0 || strcmp(name, "WHITE") == 0)
    return RgbwColor(0, 0, 0, 255);       // Canal W pur pour un vrai blanc
  if (strcmp(name, "JAUNE") == 0 || strcmp(name, "YELLOW") == 0)
    return RgbwColor(255, 200, 0, 0);
  if (strcmp(name, "BLEU") == 0 || strcmp(name, "BLUE") == 0)
    return RgbwColor(0, 0, 255, 0);
  if (strcmp(name, "VERT") == 0 || strcmp(name, "GREEN") == 0)
    return RgbwColor(0, 255, 0, 0);
  // Fallback: blanc chaud
  return RgbwColor(180, 140, 80, 50);
}

RgbwColor applyBrightness(RgbwColor color, uint8_t brightness) {
  float factor = brightness / 255.0f;
  return RgbwColor(
    (uint8_t)(color.R * factor),
    (uint8_t)(color.G * factor),
    (uint8_t)(color.B * factor),
    (uint8_t)(color.W * factor)
  );
}

// =================================================================
// WIFI
// =================================================================

void setupWiFi() {
  Serial.printf("[WIFI] Connexion à %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setAutoReconnect(true);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.printf("\n[WIFI] ✅ Connecté! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    wifiConnected = false;
    Serial.println("\n[WIFI] ❌ Échec de connexion, fonctionnement en mode autonome");
  }
}

// =================================================================
// SERVEUR — Polling HTTP
// =================================================================

bool fetchDisplayState() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    return false;
  }
  wifiConnected = true;

  HTTPClient http;
  http.begin(SERVER_URL);
  http.setTimeout(2000); // Timeout court pour ne pas bloquer le rendu

  int httpCode = http.GET();
  if (httpCode != 200) {
    Serial.printf("[HTTP] Erreur: %d\n", httpCode);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  // Parse JSON
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[JSON] Parse error: %s\n", error.c_str());
    return false;
  }

  // Sauvegarder ancien état
  memcpy(&previousState, &displayState, sizeof(DisplayState));

  // --- Timer ---
  strlcpy(displayState.timer_text, doc["timer"] | "20:00", sizeof(displayState.timer_text));
  displayState.remaining_seconds = doc["remaining_seconds"] | 1200;
  displayState.is_running = doc["is_running"] | false;

  // --- Bande ---
  strlcpy(displayState.band, doc["band"] | "OFF", sizeof(displayState.band));

  // --- Priorité ---
  JsonArray priorityArr = doc["priority"].as<JsonArray>();
  displayState.priority_count = 0;
  if (priorityArr) {
    for (JsonVariant v : priorityArr) {
      if (displayState.priority_count < 4) {
        strlcpy(displayState.priority[displayState.priority_count],
                v.as<const char*>() ? v.as<const char*>() : "BLANC",
                sizeof(displayState.priority[0]));
        displayState.priority_count++;
      }
    }
  }

  // --- Status ---
  strlcpy(displayState.status, doc["status"] | "waiting", sizeof(displayState.status));

  // --- Sync timestamp ---
  displayState.server_time = doc["server_time"] | 0UL;
  displayState.local_sync_millis = millis();

  Serial.printf("[IOT] Timer: %s | Band: %s | Priority: %d colors | Status: %s\n",
    displayState.timer_text, displayState.band,
    displayState.priority_count, displayState.status);

  return true;
}

// =================================================================
// TIMER LOCAL — Décomptage autonome entre les polls
// =================================================================

void computeLocalTimer(char* out, int* remainingSec) {
  if (!displayState.is_running || displayState.remaining_seconds <= 0) {
    strlcpy(out, displayState.timer_text, 6);
    *remainingSec = displayState.remaining_seconds;
    return;
  }

  // Temps écoulé depuis la dernière synchro serveur
  unsigned long elapsed = (millis() - displayState.local_sync_millis) / 1000;
  int remaining = displayState.remaining_seconds - (int)elapsed;
  if (remaining < 0) remaining = 0;

  int minutes = remaining / 60;
  int seconds = remaining % 60;
  snprintf(out, 6, "%02d:%02d", minutes, seconds);
  *remainingSec = remaining;
}

// =================================================================
// RENDU LED — 7-Segments
// =================================================================

void renderDigit(int digitOffset, int digitValue, RgbwColor onColor, RgbwColor offColor) {
  if (digitValue < 0 || digitValue > 9) digitValue = 0;

  for (int seg = 0; seg < 7; seg++) {
    RgbwColor color = DIGIT_SEGMENTS[digitValue][seg] ? onColor : offColor;
    int startLed = digitOffset + (seg * LEDS_PER_SEGMENT);
    for (int i = 0; i < LEDS_PER_SEGMENT; i++) {
      strip.SetPixelColor(startLed + i, color);
    }
  }
}

void renderTimer(const char* timerText, bool isLast5) {
  // Couleur du timer: blanc normalement, rouge si 5 dernières minutes
  RgbwColor timerColor = isLast5
    ? applyBrightness(RgbwColor(255, 0, 0, 0), currentBrightness)      // Rouge
    : applyBrightness(RgbwColor(0, 0, 0, 255), currentBrightness);     // Blanc pur (canal W)

  RgbwColor offColor(0, 0, 0, 0);

  // Parse "MM:SS"
  int m1 = (timerText[0] - '0');
  int m2 = (timerText[1] - '0');
  int s1 = (timerText[3] - '0');
  int s2 = (timerText[4] - '0');

  renderDigit(DIGIT1_OFFSET, m1, timerColor, offColor);
  renderDigit(DIGIT2_OFFSET, m2, timerColor, offColor);
  renderDigit(DIGIT3_OFFSET, s1, timerColor, offColor);
  renderDigit(DIGIT4_OFFSET, s2, timerColor, offColor);
}

// =================================================================
// RENDU LED — Panneaux de Priorité
// =================================================================

void renderPriorityPanels() {
  for (int panel = 0; panel < 4; panel++) {
    int offset = PRIORITY_OFFSET + (panel * LEDS_PER_PRIORITY_PANEL);
    RgbwColor color;

    if (panel < displayState.priority_count) {
      color = applyBrightness(
        colorFromName(displayState.priority[panel]),
        currentBrightness
      );
    } else {
      color = RgbwColor(0, 0, 0, 0);  // Éteint si pas assez de surfeurs
    }

    for (int i = 0; i < LEDS_PER_PRIORITY_PANEL; i++) {
      strip.SetPixelColor(offset + i, color);
    }
  }
}

// =================================================================
// RENDU LED — Bande Supérieure
// =================================================================

void renderBand() {
  RgbwColor bandColor;

  if (strcmp(displayState.band, "GREEN") == 0) {
    bandColor = applyBrightness(RgbwColor(0, 255, 0, 0), currentBrightness);
  } else if (strcmp(displayState.band, "YELLOW") == 0) {
    bandColor = applyBrightness(RgbwColor(255, 200, 0, 0), currentBrightness);
  } else {
    bandColor = RgbwColor(0, 0, 0, 0);  // OFF
  }

  for (int i = 0; i < BAND_LED_COUNT; i++) {
    strip.SetPixelColor(BAND_OFFSET + i, bandColor);
  }
}

// =================================================================
// RENDU COMPLET
// =================================================================

void renderAll() {
  char localTimer[6];
  int localRemaining;
  computeLocalTimer(localTimer, &localRemaining);
  bool isLast5 = displayState.is_running && localRemaining <= 300 && localRemaining > 0;

  renderTimer(localTimer, isLast5);
  renderPriorityPanels();
  renderBand();
  strip.Show();
}

// =================================================================
// ANIMATION — Effet de démarrage "BÉTON"
// =================================================================

void startupAnimation() {
  // Sweep vert sur toute la chaîne
  for (int i = 0; i < TOTAL_LEDS; i++) {
    strip.SetPixelColor(i, RgbwColor(0, 80, 0, 0));
    if (i > 0) strip.SetPixelColor(i - 1, RgbwColor(0, 0, 0, 0));
    if (i % 5 == 0) strip.Show();
  }
  // Flash blanc final
  for (int i = 0; i < TOTAL_LEDS; i++) {
    strip.SetPixelColor(i, RgbwColor(0, 0, 0, 120));
  }
  strip.Show();
  delay(300);
  // Éteindre tout
  for (int i = 0; i < TOTAL_LEDS; i++) {
    strip.SetPixelColor(i, RgbwColor(0, 0, 0, 0));
  }
  strip.Show();
}

// =================================================================
// SETUP & LOOP
// =================================================================

void setup() {
  Serial.begin(115200);
  Serial.println("\n==========================================");
  Serial.println("  SURF JUDGING — TABLEAU LED COB RGBW");
  Serial.println("  Firmware v1.0 — ESP32");
  Serial.println("==========================================\n");

  // Initialiser les LED
  strip.Begin();
  strip.Show();

  // Animation de démarrage
  startupAnimation();

  // Initialiser l'état par défaut
  strlcpy(displayState.timer_text, "20:00", sizeof(displayState.timer_text));
  displayState.remaining_seconds = 1200;
  displayState.is_running = false;
  strlcpy(displayState.band, "OFF", sizeof(displayState.band));
  displayState.priority_count = 4;
  strlcpy(displayState.priority[0], "ROUGE", sizeof(displayState.priority[0]));
  strlcpy(displayState.priority[1], "BLANC", sizeof(displayState.priority[1]));
  strlcpy(displayState.priority[2], "JAUNE", sizeof(displayState.priority[2]));
  strlcpy(displayState.priority[3], "BLEU",  sizeof(displayState.priority[3]));
  strlcpy(displayState.status, "waiting", sizeof(displayState.status));
  displayState.server_time = 0;
  displayState.local_sync_millis = millis();

  // Connexion WiFi
  setupWiFi();

  // Premier fetch
  fetchDisplayState();

  // Premier rendu
  renderAll();
}

void loop() {
  unsigned long now = millis();

  // Polling du serveur toutes les 500ms
  if (now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;

    if (WiFi.status() != WL_CONNECTED) {
      // Tentative de reconnexion en arrière-plan
      // (WiFi.setAutoReconnect gère, mais on log)
      if (wifiConnected) {
        Serial.println("[WIFI] ⚠️ Déconnecté! Timer autonome actif.");
        wifiConnected = false;
      }
    } else {
      if (!wifiConnected) {
        Serial.println("[WIFI] ✅ Reconnecté!");
        wifiConnected = true;
      }
      fetchDisplayState();
    }
  }

  // Rendu LED à ~30fps (toutes les 33ms)
  if (now - lastRenderMs >= 33) {
    lastRenderMs = now;
    renderAll();
  }
}
