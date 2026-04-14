# 🏄 Guide de Câblage — Tableau LED COB RGBW (ESP32)

## Vue d'Ensemble du Câblage

```
            ┌─────────────────────────────────────────────────────┐
            │              BANDE SUPÉRIEURE (Vert/Jaune)          │
            │              100 LED — 1.5m de ruban                │
            ├──────────┬──────────┬──────────┬──────────┬─────────┤
            │          │          │  :       │          │         │
            │  DIGIT 1 │  DIGIT 2 │  POINT   │  DIGIT 3 │ DIGIT 4│
            │  (60cm)  │  (60cm)  │  sép.    │  (60cm)  │ (60cm) │
            │  70 LED  │  70 LED  │          │  70 LED  │ 70 LED │
            │          │          │          │          │         │
            ├──────────┴──────────┴──────────┴──────────┴─────────┤
            │                                                     │
            │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
            │  │ PRIORITÉ │ │ PRIORITÉ │ │ PRIORITÉ │ │PRIORITÉ││
            │  │   P1     │ │   P2     │ │   P3     │ │  P4    ││
            │  │ (40x40)  │ │ (40x40)  │ │ (40x40)  │ │(40x40) ││
            │  │  60 LED  │ │  60 LED  │ │  60 LED  │ │ 60 LED ││
            │  └──────────┘ └──────────┘ └──────────┘ └────────┘│
            └─────────────────────────────────────────────────────┘
```

## Chaîne de Données (Data) — Bus Unique

L'ESP32 contrôle toutes les LED via **un seul fil de données** (Data).  
Les LED sont chaînées en série dans cet ordre :

```
ESP32 (GPIO 16)
   │
   ▼ (Data)
┌──────────────────────────────────────────────────┐
│  DIGIT 1 (LED 0-69)  ──►  DIGIT 2 (LED 70-139)  │
│       ──►  DIGIT 3 (LED 140-209)                 │
│       ──►  DIGIT 4 (LED 210-279)                 │
│       ──►  PRIORITÉ P1 (LED 280-339)             │
│       ──►  PRIORITÉ P2 (LED 340-399)             │
│       ──►  PRIORITÉ P3 (LED 400-459)             │
│       ──►  PRIORITÉ P4 (LED 460-519)             │
│       ──►  BANDE SUP. (LED 520-619)              │
└──────────────────────────────────────────────────┘
```

**Total : 620 LED**

## Schéma Électrique

```
                    ┌─────────────────────────────┐
  220V AC ━━━━━━━━━▶│  MEAN WELL LRS-350-24       │
       ou           │  Input: 110-240V AC          │
  24V Batterie ━━━━▶│  Output: 24V / 14.6A         │
                    └──────┬──────────────────┬────┘
                           │                  │
                    ┌──────┴───────┐   ┌──────┴────────┐
                    │  24V+ / GND  │   │  24V+ / GND   │
                    │  vers LED    │   │  vers ESP32    │
                    │  chaîne      │   │  (via DC-DC    │
                    │  (Alim LED)  │   │   24V→5V)     │
                    └──────────────┘   └───────────────┘
```

### Connexions ESP32

| Pin ESP32   | Destination                | Câble       |
|:------------|:---------------------------|:------------|
| **GPIO 16** | Data IN du 1er ruban LED   | Jaune       |
| **GND**     | GND commun (Alim + LED)    | Noir        |
| **5V (Vin)**| Sortie du convertisseur DC-DC 24V→5V | Rouge |

> [!WARNING]
> **Ne JAMAIS alimenter l'ESP32 directement en 24V !** Utilisez un petit convertisseur DC-DC (type LM2596) pour abaisser le 24V en 5V avant de l'envoyer sur la broche Vin de l'ESP32.

### Level Shifter (Optionnel mais recommandé)

Le signal Data de l'ESP32 sort en 3.3V, mais les LED WS2814 attendent du 5V.
Sur des distances courtes (< 30cm entre l'ESP32 et la première LED), ça fonctionne souvent sans.
Pour la fiabilité **"BÉTON"**, ajoutez le Level Shifter TXS0108E :

```
ESP32 GPIO 16 ──► [TXS0108E A1] ──► [TXS0108E B1] ──► Data IN LED
ESP32 3.3V    ──► [TXS0108E VA]
5V (du DC-DC) ──► [TXS0108E VB]
GND           ──► [TXS0108E GND]
```

## Câblage Inter-Blocs (Connecteurs Étanches 4-Pin)

Entre chaque boîte PVC, utilisez les connecteurs étanches IP67 :

| Fil (Couleur) | Signal      |
|:--------------|:------------|
| **Rouge**     | 24V+        |
| **Noir**      | GND         |
| **Jaune**     | Data (Signal LED) |
| **Blanc**     | Réservé (futur: brightness sensor) |

```
[Bloc Cerveau] ──(4-pin)──► [Digit 1] ──(4-pin)──► [Digit 2]
    ──(4-pin)──► [Digit 3] ──(4-pin)──► [Digit 4]
    ──(4-pin)──► [Priorité P1] ──(4-pin)──► [Priorité P2]
    ──(4-pin)──► [Priorité P3] ──(4-pin)──► [Priorité P4]
    ──(4-pin)──► [Bande Supérieure]
```

## Détail du Câblage par Chiffre (7 Segments)

Chaque chiffre utilise 70 LED réparties en 7 segments de 10 LED :

```
        ┌── A (10 LED) ──┐
        │                 │
     F (10 LED)      B (10 LED)
        │                 │
        ├── G (10 LED) ──┤
        │                 │
     E (10 LED)      C (10 LED)
        │                 │
        └── D (10 LED) ──┘
```

**Ordre de câblage dans chaque chiffre :**
`A → B → C → D → E → F → G` (sens horaire puis milieu)

Le ruban est continu : coupez à la longueur du segment, puis soudez un petit câble de liaison pour aller au segment suivant (ou utilisez un mini-connecteur).

## Détail du Câblage par Panneau Priorité (40x40 cm)

Montage en serpentin avec 60 LED :

```
    ──────────────────────►  (rangée 1, 10 LED)
    ◄──────────────────────  (rangée 2, 10 LED)
    ──────────────────────►  (rangée 3, 10 LED)
    ◄──────────────────────  (rangée 4, 10 LED)
    ──────────────────────►  (rangée 5, 10 LED)
    ◄──────────────────────  (rangée 6, 10 LED)
```

Espacement entre rangées : **~6 cm** (pour remplir le panneau de 40 cm)

## Liste de Matériel Complète

| Composant | Qté | Utilisation |
|:----------|:----|:------------|
| Ruban COB WS2814 RGBW 24V (5m) | 5 rouleaux | Timer + Priorité + Bande |
| ESP32 DevKit v1 (38 pin) | 1 | Contrôleur principal |
| Mean Well LRS-350-24 (24V 350W) | 1 | Alimentation principale |
| Convertisseur DC-DC LM2596 (24V→5V) | 1 | Alimentation ESP32 |
| Level Shifter TXS0108E | 1 | Signal 3.3V → 5V |
| Connecteurs étanches 4-pin IP67 | 10 paires | Liaisons inter-blocs |
| PVC Expansé 10mm (noir ou à peindre) | 3 m² | Cadres des boîtes |
| PVC Expansé 5mm | 1 m² | Fonds des boîtes |
| Polycarbonate Opale 3mm | 1.5 m² | Diffuseurs face avant |
| Profilé Alu 2020 (1m) | 4 sections | Rails porteurs |
| Jonctions Alu 2020 internes | 3 | Assemblage des rails |
| Toggle Latches (Inox 304) | 12 | Fixation inter-blocs |
| Peinture Noir Mat (spécial PVC) | 1 bombe | Finition cadres |
| Vis papillon M5 + écrous | 20 | Fixation blocs/rails |
| Silicone transparent | 1 tube | Étanchéité plexi |

## Procédure de Test

1. **Test unitaire** : Branchez seulement le premier bloc (Digit 1). Flashez le firmware. Le chiffre "2" (de 20:00) doit s'afficher en blanc.
2. **Test chaîne** : Ajoutez les blocs un par un. Vérifiez que le numéro total de LED détectées correspond.
3. **Test réseau** : Connectez au WiFi de la plage. Lancez un heat depuis l'admin. Le timer doit décompter.
4. **Test autonome** : Coupez le WiFi. Le timer doit continuer à tourner sans saccade.
