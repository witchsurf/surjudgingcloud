# 🏄 Mémo de Câblage — Boîtier Cerveau ESP32 (Priorité & Klaxon)

Ce document décrit le câblage physique et l'intégration du boîtier de commande central (cerveau) utilisant un ESP32, une plaque de buffers de signal (SN74AHCT125N) et des modules MOSFET de puissance pour piloter les 4 boîtes de priorité LED COB (24V) et le klaxon de série.

---

## 1. Vue d'Ensemble de l'Architecture Électronique

Le coffret est divisé en trois zones distinctes :
1. **Alimentation (Puissance) :** Entrée 24V générale, borniers de distribution +24V et GND puissance.
2. **Logique (Signal) :** Régulateur de tension DC-DC Step-Down (24V ──► 5.0V), ESP32-WROOM-DA et plaque prototype buffer.
3. **MOSFET (Commutation) :** 4 cartes MOSFET 4 canaux (repérées de 1 à 4) qui convertissent les signaux logiques 5V en signaux de puissance 24V PWM pour les LED COB.

### Version firmware validée

Le firmware validé pour ce câblage est `infra/esp32-priority/esp32-priority.ino` en **v2.1**.

Corrections validées en v2.1 :
- Le client SSE LAN utilise maintenant le port déclaré dans `SUPABASE_URL_LOCAL` (`http://192.168.1.2:8000`) au lieu de forcer le port 80. C'est indispensable pour écouter `/priority/sse` sur la box HP locale.
- Le clignotement des 30 dernières secondes restaure immédiatement les couleurs normales en sortie de phase OFF.
- L'état logiciel est synchronisé avec le blanc doux affiché après l'animation de démarrage, ce qui évite un premier fondu depuis un état noir fictif.
- Le jaune lycra est calibré à `R=255, G=180, B=0, W=0`.
- Le boîtier peut être attaché à un podium via `PODIUM_ID`. Pour deux podiums, flasher un boîtier avec `PODIUM_ID = "A"` et l'autre avec `PODIUM_ID = "B"`.
- En LAN HP, le firmware écoute `/priority/sse?podium=A/B`. En cloud, il appelle `get_active_priority?p_podium_id=A/B`.

### Configuration podium

Dans `infra/esp32-priority/esp32-priority.ino`, modifier avant compilation :

```cpp
const char* PODIUM_ID = "A";
```

Valeurs prévues pour la V1 terrain :
- `A` pour le podium principal;
- `B` pour le second podium.

La page debug `http://priority.local` affiche le podium configuré pour confirmer le bon flash.

### Prérequis compilation Arduino

Installer la bibliothèque **ArduinoJson** par **Benoit Blanchon**, en version **7.x** recommandée. Le firmware utilise `#include <ArduinoJson.h>` et `JsonDocument doc;`.

Dans Arduino IDE local :
1. Ouvrir **Sketch > Include Library > Manage Libraries...**
2. Chercher `ArduinoJson`
3. Installer **ArduinoJson by Benoit Blanchon**

Dans Arduino Cloud :
1. Ouvrir le sketch `_Prioritycode`
2. Aller dans l'onglet **Libraries**
3. Chercher et ajouter **ArduinoJson**

### Compilation et flash validés

Compilation/flash Arduino Cloud validés pour la v2.1 sur ESP32-D0WD-V3 :
- Programme : `1 180 607` octets, soit **90%** de `1 310 720` octets.
- RAM globale : `52 332` octets, soit **15%**, avec `275 348` octets libres pour les variables locales.
- Upload série validé sur `/dev/cu.usbserial-0001`, écriture vérifiée par hash, puis reset via RTS.

Cette taille est acceptable, mais proche de la limite. Si de nouvelles fonctions sont ajoutées au firmware, surveiller la taille du croquis avant flash.

---

## 2. Plaque Buffer (`SN74AHCT125N`) — Niveau Logique 3.3V ──► 5.0V

Afin de garantir des signaux de commande robustes (5V) sur de longues distances de câbles vers les boîtes LED de la plage, le signal 3.3V en sortie de l'ESP32 passe par **4 puces buffers SN74AHCT125N** (une puce dédiée par boîte de priorité) montées sur supports `DIP14`.

### Câblage pour chaque puce buffer ($U_1$ à $U_4$) :
* **Alimentation :**
  - **Pin 14** ──► +5.0V (sortie du régulateur Buck réglé précisément à 5.0V).
  - **Pin 7** ──► GND.
* **Condensateur de filtrage :** 1 condensateur céramique de **100 nF** connecté directement entre les pins 14 et 7 au plus près de chaque puce.
* **Mise en service permanente des canaux (Output Enable) :**
  Relier toutes les entrées $\overline{OE}$ à la masse (GND) pour laisser passer le signal en continu :
  - **Pin 1** ($1\overline{OE}$) ──► GND.
  - **Pin 4** ($2\overline{OE}$) ──► GND.
  - **Pin 10** ($3\overline{OE}$) ──► GND.
  - **Pin 13** ($4\overline{OE}$) ──► GND.

---

## 3. Schéma de Câblage : ESP32 ──► Buffers ──► MOSFET

> [!WARNING]
> **BROCHE CRITIQUE (DIVERGENCE CHECKLIST VS CODE) : Vert Box 4**
> * **Checklist papier d'origine :** Indique le GPIO 5 pour le Vert de la Box 4.
> * **Code de production réel (`esp32-priority.ino`) :** Utilise le **GPIO 15** pour le Vert de la Box 4, et le **GPIO 5** pour le relais du klaxon.
>
> **Pourquoi cette recommandation ?**
> 1. Le GPIO 5 est une broche spéciale de démarrage (*strapping pin*). Si elle est connectée à la logique du buffer au boot, l'ESP32 peut refuser de démarrer.
> 2. Utiliser le GPIO 5 pour la Box 4 crée un conflit direct avec le klaxon (sonner le klaxon allumerait le vert, et inversement).
>
> **Solution :** Câblez le Vert de la Box 4 sur le **GPIO 15** de l'ESP32.

### Grille de Câblage Logique :

| Box (Priorité) | Canal LED | GPIO ESP32 | Entrée Buffer (SN74AHCT125N) | Sortie Buffer ──► MOSFET |
| :---: | :---: | :---: | :---: | :---: |
| **Box 1 (P1)** | R (Rouge) | **GPIO 18** | Entrée R ($U_1$) | Sortie R ($U_1$) ──► **PWM 1** |
| | G (Vert) | **GPIO 19** | Entrée G ($U_1$) | Sortie G ($U_1$) ──► **PWM 2** |
| | B (Bleu) | **GPIO 21** | Entrée B ($U_1$) | Sortie B ($U_1$) ──► **PWM 3** |
| | W (Blanc) | **GPIO 22** | Entrée W ($U_1$) | Sortie W ($U_1$) ──► **PWM 4** |
| **Box 2 (P2)** | R (Rouge) | **GPIO 23** | Entrée R ($U_2$) | Sortie R ($U_2$) ──► **PWM 1** |
| | G (Vert) | **GPIO 25** | Entrée G ($U_2$) | Sortie G ($U_2$) ──► **PWM 2** |
| | B (Bleu) | **GPIO 26** | Entrée B ($U_2$) | Sortie B ($U_2$) ──► **PWM 3** |
| | W (Blanc) | **GPIO 27** | Entrée W ($U_2$) | Sortie W ($U_2$) ──► **PWM 4** |
| **Box 3 (P3)** | R (Rouge) | **GPIO 32** | Entrée R ($U_3$) | Sortie R ($U_3$) ──► **PWM 1** |
| | G (Vert) | **GPIO 33** | Entrée G ($U_3$) | Sortie G ($U_3$) ──► **PWM 2** |
| | B (Bleu) | **GPIO 16** | Entrée B ($U_3$) | Sortie B ($U_3$) ──► **PWM 3** |
| | W (Blanc) | **GPIO 17** | Entrée W ($U_3$) | Sortie W ($U_3$) ──► **PWM 4** |
| **Box 4 (P4)** | R (Rouge) | **GPIO 4** | Entrée R ($U_4$) | Sortie R ($U_4$) ──► **PWM 1** |
| | G (Vert) | **GPIO 15** | Entrée G ($U_4$) | Sortie G ($U_4$) ──► **PWM 2** |
| | B (Bleu) | **GPIO 13** | Entrée B ($U_4$) | Sortie B ($U_4$) ──► **PWM 3** |
| | W (Blanc) | **GPIO 14** | Entrée W ($U_4$) | Sortie W ($U_4$) ──► **PWM 4** |

* Note : Le GND de l'ESP32 doit être relié au GND de la plaque buffer et au GND logique d'entrée des cartes MOSFET.

---

## 4. Alimentation de Puissance & Sorties LED (Boxes)

### Alimentation des MOSFET :
* Pour chaque carte MOSFET :
  - **DC+** ──► Bornier **+24V** général.
  - **DC-** ──► Bornier **GND** puissance général.

> [!NOTE]
> **Modif Hardware MOSFET (Non nécessaire avec les buffers) :**
> Grâce à la plaque buffer (`SN74AHCT125N`), le signal de commande arrive sur les entrées des cartes MOSFET en **5.0V** (et non en 3.3V). Par conséquent, **il n'est plus nécessaire de shunter (court-circuiter) les LEDs bleues indicatrices** des opto-coupleurs L817 sur les cartes ANMBEST. Le signal 5V est amplement suffisant pour piloter l'opto-coupleur et ouvrir pleinement la grille du MOSFET sans modification physique de la carte.


### Câblage des Sorties vers les Boxes (Connecteurs 5 fils) :
* Pour chaque box de priorité, câblez le connecteur de sortie de sa carte MOSFET respective :
  - **Fil 1 :** **+24V commun** (provenant de l'alimentation 24V de la carte).
  - **Fil 2 :** **R** (Sortie commutée R du MOSFET).
  - **Fil 3 :** **G** (Sortie commutée G du MOSFET).
  - **Fil 4 :** **B** (Sortie commutée B du MOSFET).
  - **Fil 5 :** **W** (Sortie commutée W du MOSFET).

---

## 5. Câblage du Klaxon (Horn 24V)

Le klaxon de série nécessite un relais intermédiaire pour supporter le fort courant d'appel du compresseur sans endommager la logique ou provoquer une baisse de tension générale.

### Schéma de Câblage du Klaxon :
1. **Commande de l'ESP32 :**
   - Connectez le **GPIO 5** à l'entrée `IN` du petit relais bleu (Songle 5V).
   - Alimentez le relais en 5V (`VCC` ──► 5.0V Buck, `GND` ──► GND commun).
2. **Relais Automobile de Puissance :**
   - Utilisez le petit relais bleu comme interrupteur de commande pour alimenter la bobine d'un **Relais Automobile 24V 40A**.
   - Ce relais de puissance automobile ferme ensuite le circuit de puissance 24V relié directement au compresseur de klaxon.
3. **Section des Câbles de Puissance :**
   - Le circuit allant de la batterie 24V au relais auto et au compresseur doit être câblé avec du fil de cuivre épais de **1.5 mm² ou 2.5 mm²** de section.
   - *Ne jamais utiliser de fins câbles Arduino pour cette partie sous peine de surchauffe ou de blocage du compresseur (simple bourdonnement sonore sans klaxonner).*

---

## 6. Checklist de Validation avant Allumage

1. **Mesure de tension logique :** Branchez le 24V principal, mais **déconnectez physiquement l'ESP32**. Utilisez un multimètre pour vérifier que la sortie du régulateur Buck affiche bien **5.0 V**. Branchez l'ESP32 seulement après validation.
2. **Continuité des Masses (GND) :** Vérifiez que la masse logique (ESP32, plaque buffer) est bien reliée électriquement au GND de puissance (batterie, cartes MOSFET, convertisseur).
3. **Test unitaire :** Testez d'abord le comportement avec une seule box connectée avant de raccorder les quatre autres pour faciliter la localisation d'éventuels court-circuits.
