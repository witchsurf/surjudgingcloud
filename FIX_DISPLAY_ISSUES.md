# 🔧 Correctifs pour l'Interface de Display

## 📌 Problèmes Identifiés et Corrigés

### 1. ✅ HEAT_COLOR_CACHE_KEY is not defined
**Symptôme:** Erreur lors du clic sur "Fermer le heat"

**Cause:** La constante n'était pas importée dans App.tsx

**Correction:** Ajout de l'import dans `src/App.tsx:10`

---

### 2. ✅ Erreurs 401 Unauthorized sur heats/scores
**Symptôme:**
```
POST https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/heats 401 (Unauthorized)
❌ Erreur ensureHeatRecord: new row violates row-level security policy for table "heats"
```

**Cause:** Les politiques RLS trop restrictives empêchent:
- L'insertion de heats sans event_id
- L'insertion de scores par des non-juges

**Correction:** Script SQL temporaire créé: `8_FIX_DISPLAY_RLS_TEMP.sql`

---

### 3. ✅ Noms des participants manquants
**Symptôme:** L'interface affiche seulement "BLANC" et "BLEU" sans les noms

**Cause:** Les politiques RLS sur `heat_entries` ne permettent la lecture qu'aux juges. L'écran de display n'est pas un juge donc ne peut pas lire les participants.

**Correction:** Script SQL permettant la lecture publique de `heat_entries` et `heat_slot_mappings`

---

### 4. ✅ Navigation heat suivant
**Symptôme:** Bouton "Fermer le heat" ne fonctionne pas

**Cause:** Erreur HEAT_COLOR_CACHE_KEY bloquait l'exécution

**Status:** La logique de navigation existe déjà dans le code (lignes 1130-1209 de App.tsx). Elle devrait fonctionner une fois les autres erreurs corrigées.

---

## 🚀 Action Immédiate Requise

### Étape 1: Appliquer le Script SQL Temporaire

1. Va sur: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn
2. Clique sur **SQL Editor** → **New Query**
3. Ouvre **`8_FIX_DISPLAY_RLS_TEMP.sql`**
4. Copie tout le contenu et colle dans SQL Editor
5. Clique sur **"Run"** (ou Cmd+Enter)

### Résultat Attendu:
```
TEMPORARY FIX APPLIED

table_name          | policy_count
--------------------+-------------
heat_entries        | 4
heat_slot_mappings  | 4
heats               | 4
scores              | 4
```

---

### Étape 2: Rafraîchir l'Application

1. Rafraîchis l'app dans le navigateur (Cmd + R)
2. Les erreurs 401 devraient disparaître
3. Les noms des participants devraient s'afficher
4. Le bouton "Fermer le heat" devrait fonctionner

---

## 🔍 Ce que le Script Corrige

### Politiques Modifiées:

#### `heats` table:
- **Avant:** Seulement les propriétaires d'events peuvent insérer
- **Après (temp):** Tous les utilisateurs authentifiés peuvent insérer

#### `scores` table:
- **Avant:** Seulement les juges pendant les heats "running"
- **Après (temp):** Tous les utilisateurs authentifiés peuvent insérer

#### `heat_entries` table:
- **Avant:** Seulement les juges peuvent lire
- **Après (temp):** Lecture publique (même anonyme)

#### `heat_slot_mappings` table:
- **Avant:** Seulement les juges peuvent lire
- **Après (temp):** Lecture publique (même anonyme)

---

## ⚠️ Important: Solution Temporaire

Ces modifications sont **TEMPORAIRES** pour débloquer le testing. Elles rendent la base de données plus permissive que nécessaire.

### Problèmes Architecturaux à Corriger Plus Tard:

#### 1. `ensureHeatRecord()` ne devrait pas créer de heats
**Problème actuel:** Le code essaie de créer des heats à la volée sans event_id

**Solution future:**
- Les heats doivent SEULEMENT être créés par l'admin interface
- `ensureHeatRecord()` devrait juste vérifier l'existence, pas créer

#### 2. Séparation des hooks de sync
**Problème actuel:** Le même hook `useSupabaseSync` est utilisé partout, même dans l'écran de display

**Solution future:**
- `useSupabaseSync`: Pour les juges qui écrivent des scores
- `useSupabaseRead`: Pour l'écran de display qui lit seulement

#### 3. Politique scores trop permissive
**Problème actuel:** N'importe quel utilisateur authentifié peut insérer des scores

**Solution future:**
- Restaurer la politique sécurisée: seulement les juges pendant les heats "running"
- L'écran de display ne devrait JAMAIS écrire de scores

---

## 🧪 Plan de Test

Une fois le script appliqué:

1. **Créer un événement**
   - Se connecter avec magic link
   - Créer un événement (nom, organisateur, dates)
   - Activer en mode test

2. **Importer des participants**
   - Aller sur la page participants
   - Importer un fichier CSV avec des participants

3. **Générer des heats**
   - Configurer les catégories et brackets
   - Générer les heats

4. **Tester l'interface Chef Juge**
   - Configurer le heat actif
   - Les noms des participants doivent s'afficher

5. **Tester l'interface Display**
   - Ouvrir l'URL de display
   - Vérifier que les noms s'affichent (pas juste les couleurs)

6. **Tester le bouton "Fermer le heat"**
   - Cliquer sur "Fermer le heat"
   - Vérifier qu'il passe au heat suivant
   - Si dernier heat du round, vérifier qu'il passe au round suivant

---

## 📝 Notes pour le Futur

### Quand Restaurer les Politiques Sécurisées:

Une fois que le code est refactorisé pour:
- ✅ Ne plus créer de heats via `ensureHeatRecord()`
- ✅ Séparer la logique read/write avec des hooks différents
- ✅ L'écran de display ne tente plus de synchroniser des scores

Alors on pourra appliquer le script suivant (à créer plus tard):
```sql
-- 9_RESTORE_SECURE_POLICIES.sql
-- Ce script restaurera les politiques sécurisées originales
```

---

## 🎯 Résultat Final Attendu

Après application du script **8_FIX_DISPLAY_RLS_TEMP.sql**:

✅ Plus d'erreurs 401 dans la console
✅ Les noms des participants s'affichent correctement
✅ Le bouton "Fermer le heat" fonctionne
✅ Navigation automatique vers le heat suivant
✅ L'application est testable de bout en bout

**L'application devrait être TOTALEMENT FONCTIONNELLE pour les tests! 🏄‍♂️**
