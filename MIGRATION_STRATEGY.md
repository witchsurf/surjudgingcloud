# 🔧 Stratégie de Migration - Analyse et Plan d'Action

## 📊 Situation Actuelle

### Migrations Locales vs Base de Données Distante

Tu as **20 migrations locales** dans `supabase/migrations/` mais ta base de données Supabase ne les a **pas toutes appliquées**.

### Ce qui a été appliqué manuellement:
✅ Tables créées (via `1_CREATE_MISSING_TABLES_FIXED.sql`)
✅ Politiques de sécurité (via `2_APPLY_SECURITY_FIXES_SUPABASE.sql`)
✅ Vues créées (`v_event_divisions`, `v_heat_lineup`, `v_current_heat`)
✅ Nettoyage des politiques (via scripts 4, 5, 6, 7)

### Ce qui manque:
❌ Colonne `config` dans la table `events`
❌ Table `event_last_config`
❌ Fonctions helper (`upsert_event_last_config`, `bulk_upsert_heats`)
❌ Triggers automatiques (avancement automatique de heat, blocage scoring)

---

## ⚠️ Problèmes Identifiés

### 1. Conflit de Politiques de Sécurité

Certaines migrations locales créent des **politiques permissives dangereuses**:

```sql
-- Migration 20251102170000_competition_workflow_additions.sql
-- DANGER: Permet à n'importe qui d'insérer/modifier
CREATE POLICY participants_insert_all
  ON public.participants
  FOR INSERT TO public
  WITH CHECK (true);  -- ❌ PERMISSIF!
```

Ces politiques **annulent les corrections de sécurité** qu'on a appliquées!

### 2. Colonnes Manquantes

Le code essaie de lire des colonnes qui n'existent pas:
- `events.config` → Erreur 400
- Cause des plantages dans l'interface

### 3. Fonctions Manquantes

Le code appelle des fonctions qui n'existent peut-être pas:
- `bulk_upsert_heats()`
- `upsert_event_last_config()`

---

## ✅ Solution: Migration Consolidée Sécurisée

J'ai créé **`CONSOLIDATED_MIGRATION_SAFE.sql`** qui:

### Ce qu'elle AJOUTE ✅
- ✅ Colonne `config` dans `events`
- ✅ Colonnes manquantes dans `heats` et `scores`
- ✅ Table `event_last_config` (avec RLS sécurisé!)
- ✅ Fonction `upsert_event_last_config()`
- ✅ Fonction `bulk_upsert_heats_secure()` (version SÉCURISÉE)

### Ce qu'elle NE fait PAS ❌
- ❌ N'ajoute PAS de politiques permissives
- ❌ Ne remplace PAS les politiques sécurisées existantes
- ❌ Ne crée PAS de triggers automatiques (pour l'instant)

### Pourquoi sans les triggers?

Les triggers automatiques (avancement auto de heat, blocage scoring) sont utiles mais peuvent causer des problèmes si mal configurés. On peut les ajouter plus tard une fois que le reste fonctionne bien.

---

## 🚀 Plan d'Application

### Étape 1: Appliquer la Migration Consolidée

```bash
# Dans Supabase SQL Editor
# Copier-coller le contenu de CONSOLIDATED_MIGRATION_SAFE.sql
```

**Résultat attendu:**
```
SUCCESS: Safe consolidated migration applied!

added_column: config column | status: EXISTS
added_table: event_last_config table | status: EXISTS
```

### Étape 2: Mettre à Jour le Code

Le code doit utiliser `bulk_upsert_heats_secure()` au lieu de `bulk_upsert_heats()`:

**Fichier à modifier:** `src/api/supabaseClient.ts`

Chercher: `bulk_upsert_heats`
Remplacer par: `bulk_upsert_heats_secure`

### Étape 3: Tester l'Application

1. Rafraîchir l'app
2. Créer un événement
3. Importer des participants
4. Générer des heats
5. Tester l'interface Chief Judge
6. Tester l'interface Juge

### Étape 4: (Optionnel) Ajouter les Triggers

Une fois que tout fonctionne, on pourra ajouter:
- Trigger pour bloquer le scoring quand heat non "running"
- Trigger pour avancer automatiquement au heat suivant

---

## 📋 Migrations à NE PAS Appliquer

Ces migrations contiennent des politiques permissives dangereuses:

❌ **20251102170000_competition_workflow_additions.sql**
- Lignes 287-324: Politiques `with check (true)`

❌ **20251109000000_fix_security_policies.sql**
- Déjà appliqué manuellement via `2_APPLY_SECURITY_FIXES_SUPABASE.sql`

❌ **20251109000001_consolidate_triggers.sql**
- Pas nécessaire pour l'instant

---

## 🔐 Politiques de Sécurité Actuelles (À GARDER!)

Ces politiques sont **CORRECTES** et doivent rester:

### Events
- `events_read_own_or_paid` - Lecture: ses propres events OU events payés
- `events_insert_own` - Création: utilisateur authentifié
- `events_update_own` - Modification: propriétaire uniquement

### Participants
- `participants_read_accessible` - Lecture: si accès à l'event
- `participants_insert_owned` - Création: propriétaire de l'event
- `participants_update_owned` - Modification: propriétaire de l'event

### Scores
- `scores_read_accessible` - Lecture: si juge de ce heat
- `scores_insert_accessible` - Création: si juge ET heat running
- `scores_update_accessible` - Modification: si juge de ce heat

### Heat Entries / Heat Slot Mappings
- `heat_entries_read_accessible` - Lecture: si juge
- `heat_entries_insert_owned` - Création: si juge
- `heat_entries_update_accessible` - Modification: si juge

---

## 📝 Commandes de Vérification

### Vérifier que la colonne config existe:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'events'
  AND column_name = 'config';
```

### Vérifier que event_last_config existe:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'event_last_config';
```

### Vérifier les fonctions:
```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('upsert_event_last_config', 'bulk_upsert_heats_secure');
```

### Compter les politiques par table:
```sql
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
```

---

## ⚡ Résumé

**Problème:** Migrations locales non appliquées + colonnes manquantes + politiques permissives

**Solution:** Migration consolidée sécurisée qui ajoute ce qui manque sans compromettre la sécurité

**Action immédiate:**
1. ✅ Appliquer `CONSOLIDATED_MIGRATION_SAFE.sql` dans Supabase SQL Editor
2. ✅ Rafraîchir l'app et tester

**Résultat:** App fonctionnelle sans erreurs 400, avec toutes les colonnes nécessaires! 🎉
