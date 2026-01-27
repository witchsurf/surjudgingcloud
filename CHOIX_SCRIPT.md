# 🎯 Deux Options pour Appliquer les Correctifs

Tu as eu une erreur parce que tu as déjà appliqué une version précédente du script. Tu as **2 options** maintenant:

---

## Option 1: Script Incrémental (RECOMMANDÉ ✅)

### Plus Simple et Plus Rapide

Applique **uniquement** les 2 nouvelles corrections (participants + timer):

**Fichier:** `9_ADD_PARTICIPANTS_TIMER_POLICIES.sql`

### Étapes:
1. Va sur: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn
2. SQL Editor → New Query
3. Copie **TOUT** le contenu de `9_ADD_PARTICIPANTS_TIMER_POLICIES.sql`
4. Colle et Run

### Résultat Attendu:
```
✅ PARTICIPANTS AND TIMER POLICIES ADDED

table_name           | policy_count
---------------------+-------------
heat_realtime_config | 3
participants         | 4
```

---

## Option 2: Script Complet Révisé

### Si tu veux tout réappliquer

Applique le script complet maintenant **idempotent** (peut être relancé plusieurs fois):

**Fichier:** `8_FIX_DISPLAY_RLS_TEMP.sql` (mis à jour)

### Étapes:
1. Va sur: https://supabase.com/dashboard/project/xwaymumbkmwxqifihuvn
2. SQL Editor → New Query
3. Copie **TOUT** le contenu de `8_FIX_DISPLAY_RLS_TEMP.sql`
4. Colle et Run

### Résultat Attendu:
```
✅ TEMPORARY FIX APPLIED - ALL POLICIES UPDATED

table_name           | policy_count
---------------------+-------------
heat_entries         | 4
heat_realtime_config | 3
heat_slot_mappings   | 4
heats                | 4
participants         | 4
scores               | 4
```

---

## 🎯 Quelle Option Choisir?

### ✅ **Option 1** si:
- Tu veux juste ajouter les 2 corrections manquantes
- Tu veux aller vite
- Le premier script a bien fonctionné pour les 4 premières tables

### ✅ **Option 2** si:
- Tu veux réappliquer tout proprement
- Tu n'es pas sûr de l'état de ta base de données
- Tu préfères tout recommencer

---

## ⚡ Ma Recommandation

**Utilise l'Option 1** (`9_ADD_PARTICIPANTS_TIMER_POLICIES.sql`)

C'est plus rapide et ça ajoute exactement ce qui manque:
- ✅ Lecture publique de `participants` → Noms affichés
- ✅ Lecture/écriture de `heat_realtime_config` → Timer fonctionne

---

## 🔍 Après Application

Une fois que tu as appliqué **l'un** des scripts:

1. **Rafraîchis le navigateur** (Cmd + R) sur:
   - Interface Chef Juge
   - Affichage public

2. **Vérifie que:**
   - ✅ Le timer ne s'arrête plus (pas d'erreur 401)
   - ✅ Les noms s'affichent (pas juste "BLANC", "BLEU")

---

## 🎉 Résultat Final

Après application:
- Timer stable ✅
- Noms affichés ✅
- Application totalement fonctionnelle ✅

**Choisis une option et applique maintenant!** ⚡
