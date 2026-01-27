# Fix: Winner Advancement Between Rounds

## 🐛 Problème Identifié

Lors des compétitions sur le terrain, les noms des surfeurs qualifiés n'apparaissaient pas dans les rounds suivants (R2, R3, Finales). À la place, on voyait :
- Des placeholders "R1-H1 (P1)" au lieu des noms
- Seulement les couleurs de jersey sans participants associés
- Impossible de juger correctement les rounds suivants

## 🔍 Cause Racine

**Mismatch entre génération et parsing des placeholders :**

### Avant la correction :
1. **Génération** (`bracket.ts:56`) produisait :
   ```typescript
   return `${base}-${ref.position} (P${ref.position})`;
   // Résultat: "R1-H1-3 (P3)"
   ```

2. **Parsing** (`supabaseClient.ts:503`) attendait :
   ```typescript
   const match = normalized.match(/^(RP?)(\d+)-H(\d+)-P(\d+)$/);
   // Attend: "R1-H1-P3"
   ```

3. **Conséquence :**
   - Le regex ne matchait JAMAIS → `source_round`, `source_heat`, `source_position` étaient NULL en DB
   - `useHeatManager.ts:171` filtrait tous les mappings → Aucun gagnant n'était avancé
   - Les heats suivants restaient avec des placeholders

## ✅ Solution Appliquée

### Fichiers modifiés :

#### 1. `frontend/src/utils/bracket.ts` (ligne 50-56)
**Avant :**
```typescript
return `${base}-${ref.position} (P${ref.position})`;
// Générait: "R1-H1-3 (P3)"
```

**Après :**
```typescript
return `${base}-P${ref.position}`;
// Génère: "R1-H1-P3" ✅
```

#### 2. `frontend/src/utils/pdfExport.ts` (lignes 68-102)
- Réorganisé la logique de parsing pour prioriser le nouveau format
- Ajouté support pour `RP` (repechage)
- Supprimé le code dupliqué

**Ordre de parsing :**
1. Match direct : `"R1-H1-P3"` ou `"RP1-H1-P2"`
2. Extraction depuis format avec parenthèses : `"R1-H1 (P3)"`
3. Extraction depuis format avec préfixe : `"QUALIFIÉ R1-H1 (P1)"`

## 🧪 Comment Tester

### Test 1: Génération de bracket
```bash
cd frontend
npm run dev
```

1. Créer un événement avec 8 participants minimum
2. Générer les heats en format "Single Elimination"
3. **Vérifier** que les heats R2 affichent des placeholders au format `"R1-H1-P1"`

### Test 2: Avancement des gagnants
1. Compléter un heat R1-H1 avec des scores
2. Fermer le heat (bouton "Clore Heat")
3. **Vérifier** que les 2 premiers surfeurs apparaissent dans R2 avec leurs VRAIS NOMS
4. **Vérifier** que les couleurs de jersey sont correctement assignées

### Test 3: Repechage
1. Compléter plusieurs heats R1
2. **Vérifier** que les surfeurs en position 3-4 apparaissent dans le Repechage R1
3. Compléter un heat de repechage
4. **Vérifier** que les gagnants avancent vers les rounds suivants

### Test 4: Export PDF
1. Générer un PDF des heats
2. **Vérifier** que les placeholders sont visibles : `"R1-H1-P1"`
3. Une fois les heats complétés, régénérer le PDF
4. **Vérifier** que les noms réels remplacent les placeholders

## 🗄️ Vérification Base de Données

### Requête SQL pour diagnostiquer les mappings :
```sql
-- Avant le fix: source_round/source_heat/source_position = NULL
-- Après le fix: Valeurs correctes

SELECT
  heat_id,
  position,
  placeholder,
  source_round,
  source_heat,
  source_position
FROM heat_slot_mappings
WHERE heat_id LIKE '%_r2_%'
ORDER BY heat_id, position;
```

**Résultat attendu APRÈS le fix :**
```
heat_id                        | position | placeholder  | source_round | source_heat | source_position
-------------------------------|----------|--------------|--------------|-------------|----------------
djegane_surf_trophy_open_r2_h1 | 1        | R1-H1-P1     | 1            | 1           | 1
djegane_surf_trophy_open_r2_h1 | 2        | R1-H2-P1     | 1            | 2           | 1
djegane_surf_trophy_open_r2_h1 | 3        | R1-H1-P2     | 1            | 1           | 2
djegane_surf_trophy_open_r2_h1 | 4        | R1-H2-P2     | 1            | 2           | 2
```

### Requête pour vérifier l'avancement des gagnants :
```sql
-- Après avoir clos un heat, vérifier que les gagnants sont dans le heat suivant
SELECT
  he.heat_id,
  he.position,
  he.color,
  p.name,
  p.country,
  he.seed
FROM heat_entries he
JOIN participants p ON he.participant_id = p.id
WHERE he.heat_id LIKE '%_r2_%'
ORDER BY he.heat_id, he.position;
```

**Résultat attendu :**
- Les gagnants de R1-H1 (1er et 2e) apparaissent avec leurs noms réels
- Plus de participant_id NULL ou absent

## 🔄 Flux Complet de l'Avancement

```
┌──────────────────────────────────────┐
│ R1-H1 se termine                     │
│ 1er: Ali (ID=123, Score=16.5)       │
│ 2e: Fatou (ID=456, Score=16.2)      │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ useHeatManager.closeHeat() s'exécute │
│ - Calculate rankings                 │
│ - Fetch heat_slot_mappings           │
│ - Filter by source_round=1           │
│ - Filter by source_heat=1            │
└────────────┬─────────────────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
source_position=1  source_position=2
(1er place)        (2e place)
Ali → R2-H1-Slot1  Fatou → R2-H1-Slot3
    │                 │
    ▼                 ▼
┌──────────────────────────────────────┐
│ replaceHeatEntries(R2-H1, [          │
│   { position: 1, participant_id: 123 }│
│   { position: 3, participant_id: 456 }│
│ ])                                    │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ UI Judge/Admin rafraîchit             │
│ R2-H1 affiche maintenant:            │
│ ROUGE: Ali Mohamed                   │
│ JAUNE: Fatou Sall                    │
└──────────────────────────────────────┘
```

## 📋 Checklist de Déploiement

- [x] Modifier `bracket.ts` pour générer le bon format
- [x] Mettre à jour `pdfExport.ts` pour parser les nouveaux formats
- [x] Vérifier que les tests passent
- [ ] Rebuild l'application : `npm run build`
- [ ] Tester en local avec des données réelles
- [ ] Déployer en production
- [ ] Supprimer les anciens heats générés avec le mauvais format
- [ ] Régénérer les heats pour les événements en cours

## ⚠️ Action Requise pour les Événements Existants

**Si vous avez déjà généré des heats avec l'ancien format :**

1. **Option A : Régénération complète** (Recommandé si aucun heat n'est commencé)
   - Supprimer tous les heats de l'événement
   - Régénérer avec le nouveau code
   - Les nouveaux heats auront le format correct

2. **Option B : Migration SQL** (Si des heats sont déjà complétés)
   ```sql
   -- Script de migration pour corriger les placeholders existants
   UPDATE heat_slot_mappings
   SET
     placeholder = REGEXP_REPLACE(placeholder, '^(RP?)(\d+)-H(\d+)-(\d+) \(P\d+\)$', '\1\2-H\3-P\4'),
     source_round = CAST(REGEXP_REPLACE(placeholder, '^(RP?)(\d+)-H(\d+)-.*', '\2') AS INTEGER),
     source_heat = CAST(REGEXP_REPLACE(placeholder, '^.*-H(\d+)-.*', '\1') AS INTEGER),
     source_position = CAST(REGEXP_REPLACE(placeholder, '^.*-(\d+) \(P\d+\)$', '\1') AS INTEGER)
   WHERE placeholder ~ '^(RP?)(\d+)-H(\d+)-(\d+) \(P\d+\)$'
     AND (source_round IS NULL OR source_heat IS NULL OR source_position IS NULL);
   ```

## 🚀 Performances Attendues

Après ce fix, l'avancement des gagnants devrait être :
- **Automatique** : Dès qu'un heat est clos
- **Instantané** : Pas de délai entre clôture et apparition des noms
- **Fiable** : 100% des gagnants correctement identifiés et avancés
- **Visible** : Les juges voient immédiatement les noms dans leur interface

## 📝 Notes Complémentaires

### Format des Placeholders

| Format | Utilisation | Exemple |
|--------|-------------|---------|
| `R1-H1-P1` | Standard (Round 1, Heat 1, Position 1) | Winner de R1-H1 |
| `RP1-H1-P2` | Repechage (Prefix RP) | 2nd du Repechage R1-H1 |
| `R5-H1-P1` | Finales | Winner de la demi-finale |

### Code Key Points

- **Generation** : `bracket.ts:makePlaceholder()`
- **Parsing** : `supabaseClient.ts:parsePlaceholder()`
- **Advancement** : `useHeatManager.ts:closeHeat()` lignes 162-205
- **Display** : `useHeatParticipants.ts` (two-stage loading)
- **Export** : `pdfExport.ts` (PDF generation with placeholders)

---

**Date du Fix :** 2026-01-27
**Version :** v1.1.0
**Commit :** À créer après tests validés
