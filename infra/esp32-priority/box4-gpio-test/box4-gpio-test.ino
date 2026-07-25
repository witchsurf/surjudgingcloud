/**
 * Test Box 4 complet pour diagnostic ESP32 -> SN74AHCT125N -> MOSFET.
 *
 * Box 4:
 *   R = GPIO 4
 *   G = GPIO 15
 *   B = GPIO 13
 *   W = GPIO 14
 *
 * Important:
 *   Ce sketch force TOUS les canaux en sortie.
 *   Les canaux non testes sont forces a LOW pour eviter les entrees flottantes
 *   sur le SN74AHCT125N.
 *
 * Mesures attendues sur le canal actif:
 *   - GPIO ESP32 -> GND: environ 3.3V
 *   - Sortie SN74AHCT125N -> GND: environ 5V
 *   - Entree MOSFET -> GND: environ 5V
 */

const int PIN_R = 4;
const int PIN_G = 15;
const int PIN_B = 13;
const int PIN_W = 14;

// false = vert seul en HIGH fixe.
// true  = sequence R, G, B, W, 3 secondes par canal.
const bool SEQUENCE_MODE = false;

void allOff() {
  digitalWrite(PIN_R, LOW);
  digitalWrite(PIN_G, LOW);
  digitalWrite(PIN_B, LOW);
  digitalWrite(PIN_W, LOW);
}

void setOnly(int pin, const char* label) {
  allOff();
  digitalWrite(pin, HIGH);
  Serial.printf("%s ON - GPIO %d HIGH\n", label, pin);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  pinMode(PIN_W, OUTPUT);

  allOff();

  Serial.println("=== BOX 4 GPIO TEST COMPLET ===");
  Serial.println("R=GPIO4, G=GPIO15, B=GPIO13, W=GPIO14");
  Serial.println("Canaux non testes forces a LOW.");

  if (!SEQUENCE_MODE) {
    setOnly(PIN_G, "VERT");
    Serial.println("Mode fixe: seul VERT doit etre actif.");
  }
}

void loop() {
  if (!SEQUENCE_MODE) {
    // Maintenir explicitement le rouge/bleu/blanc a LOW.
    digitalWrite(PIN_R, LOW);
    digitalWrite(PIN_G, HIGH);
    digitalWrite(PIN_B, LOW);
    digitalWrite(PIN_W, LOW);
    delay(1000);
    return;
  }

  setOnly(PIN_R, "ROUGE");
  delay(3000);

  setOnly(PIN_G, "VERT");
  delay(3000);

  setOnly(PIN_B, "BLEU");
  delay(3000);

  setOnly(PIN_W, "BLANC");
  delay(3000);
}
