# 🚨 CORRECTIF URGENT: Timer + Noms des Participants

## 🔴 Problèmes Identifiés

Tu as rapporté deux problèmes critiques:

### 1. Timer du Chef Juge s'arrête
```
POST https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/heat_realtime_config?on_conflict=heat_id 401 (Unauthorized)
```

**Cause:** La table `heat_realtime_config` n'autorise que les juges à écrire, mais le Chef Juge n'est pas reconnu comme "juge" dans le système.

### 2. Noms toujours pas affichés
L'affichage public montre toujours "BLANC" et "BLEU" au lieu des noms réels.

**Cause:** La table `participants` n'autorise la lecture que pour les propriétaires d'events. L'écran de display public ne peut donc pas lire les noms.

---

## ✅ Solution Complète

J'ai **mis à jour le script** `8_FIX_DISPLAY_RLS_TEMP.sql` avec **2 nouvelles corrections**:

### Ajouté Correction #5: Table `participants`
```sql
-- Permet la lecture publique des participants
CREATE POLICY "participants_read_all_temp" ON public.participants
  FOR SELECT TO public
  USING (true);
```

### Ajouté Correction #6: Table `heat_realtime_config`
```sql
-- Permet la lecture publique du timer
CREATE POLICY "heat_realtime_config_read_all_temp" ON public.heat_realtime_config
  FOR SELECT TO public
  USING (true);

-- Permet l'écriture authentifiée pour le timer
CREATE POLICY "heat_realtime_config_write_authenticated_temp" ON public.heat_realtime_config
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
```

---

## 🚀 Action Immédiate

### Étape 1: Réappliquer le Script SQL Complet

**IMPORTANT:** Il faut réappliquer le script même si tu l'as déjà appliqué avant, car il a été mis à jour!

1. Va sur: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn
2. Clique sur **SQL Editor** → **New Query**
3. Ouvre le fichier: **`8_FIX_DISPLAY_RLS_TEMP.sql`**
4. **Copie TOUT le contenu** (le script a été mis à jour!)
5. **Colle dans SQL Editor**
6. **Clique sur "Run"** (ou Cmd+Enter)

### Résultat Attendu:
```
✅ TEMPORARY FIX APPLIED - ALL POLICIES UPDATED

table_name           | policy_count
---------------------+-------------
heat_entries         | 4
heat_realtime_config | 3          <- NOUVEAU!
heat_slot_mappings   | 4
heats                | 4
participants         | 4          <- NOUVEAU!
scores               | 4
```

Tu devrais aussi voir une deuxième table avec les détails:
```
tablename            | policyname                               | operation
---------------------+------------------------------------------+----------
heat_realtime_config | heat_realtime_config_read_all_temp      | SELECT
heat_realtime_config | heat_realtime_config_write_auth...temp  | ALL
participants         | participants_read_all_temp              | SELECT
participants         | participants_insert_owned               | INSERT
participants         | participants_update_owned               | UPDATE
participants         | participants_delete_owned               | DELETE
```

---

### Étape 2: Rafraîchir l'Application

1. **Rafraîchis le navigateur** du Chef Juge (Cmd + R)
2. **Rafraîchis le navigateur** de l'affichage public (Cmd + R)

---

## 🎯 Ce qui Va Fonctionner Maintenant

### ✅ Timer du Chef Juge
- Le timer pourra se synchroniser avec `heat_realtime_config`
- Plus d'erreurs 401
- Le timer restera actif pendant toute la durée du heat

### ✅ Noms des Participants
- L'affichage public pourra lire la table `participants`
- Les vrais noms s'afficheront au lieu de "BLANC" et "BLEU"
- Les pays s'afficheront si disponibles

### ✅ Tout le Reste
- Les 4 corrections précédentes restent actives
- Heats, scores, heat_entries, heat_slot_mappings fonctionnent

---

## 📊 Récapitulatif: 6 Tables Corrigées

Le script corrige maintenant **6 tables au total**:

| Table | Correction | Raison |
|-------|-----------|--------|
| **heats** | Insertion authentifiée | Pour ensureHeatRecord() |
| **scores** | Insertion authentifiée | Pour synchronisation display |
| **heat_entries** | Lecture publique | Pour couleurs/positions |
| **heat_slot_mappings** | Lecture publique | Pour bracket view |
| **participants** | Lecture publique | Pour noms/pays |
| **heat_realtime_config** | Lecture publique + écriture auth | Pour timer |

---

## ⚠️ Note Importante

C'est toujours une **solution temporaire** pour les tests. En production, il faudra:
- Un rôle `public_display` avec accès lecture uniquement
- Politiques plus strictes basées sur les rôles
- Séparation hooks read/write

Mais pour l'instant, cette solution permet de **TESTER COMPLÈTEMENT L'APPLICATION**! 🏄‍♂️

---

## 🔍 Vérification Rapide

Après avoir appliqué le script:

### Dans l'Interface Chef Juge:
1. Configure un heat
2. Lance le timer → **Il ne doit plus s'arrêter**
3. Vérifie qu'il n'y a plus d'erreurs 401 dans la console

### Dans l'Affichage Public:
1. Ouvre l'URL de display
2. Vérifie que tu vois les **VRAIS NOMS** des participants
3. Pas juste "BLANC" et "BLEU"
4. Vérifie que les pays s'affichent si disponibles

---

## 🎉 Si Ça Marche

Tu pourras enfin:
- ✅ Timer stable pendant tout le heat
- ✅ Noms des participants affichés
- ✅ Tester l'application de bout en bout
- ✅ Créer, juger, et afficher les résultats

**Applique le script maintenant!** ⚡
