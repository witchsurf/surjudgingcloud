# Fix: Autoriser la Saisie des Scores Après la Fin du Timer (MAIS PAS AVANT LE DÉMARRAGE)

## 🎯 Problème sur le Terrain

**Situation 1 :** Quand le timer de 20 minutes atteint 0 :
- ❌ Les juges ne pouvaient plus entrer aucune note
- ❌ Les inputs étaient immédiatement bloqués
- ❌ Message "Timer arrêté - Notation bloquée" s'affichait
- ❌ Impossible de rentrer les dernières vagues jugées pendant les dernières secondes

**Situation 2 :** Avant le démarrage du timer :
- ⚠️ Les juges pouvaient entrer des notes AVANT que les surfeurs soient dans l'eau
- ⚠️ Créait des erreurs et de la confusion

## ✅ Solution Implémentée

### Nouvelle Logique Triple :

**1. BLOQUE avant le démarrage** (`waiting`) → Évite les erreurs
**2. AUTORISE pendant et après le timer** (`running`, `paused`, `finished`) → Flexibilité
**3. BLOQUE après la clôture** (`closed`) → Sécurité

| État du Heat | Timer | Saisie Autorisée ? |
|--------------|-------|--------------------|
| `waiting` | Pas démarré | ❌ NON (évite erreurs avant que surfeurs surfent) |
| `running` | En cours | ✅ OUI |
| `paused` | En pause | ✅ OUI |
| `finished` | Temps écoulé (0:00) | ✅ OUI (NOUVEAU !) |
| `closed` | Clôturé par chef juge | ❌ NON |

**Avantages :**
- ✅ Pas d'erreur avant le démarrage (surfeurs pas encore en eau)
- ✅ Les juges peuvent prendre leur temps après la fin du timer
- ✅ Seul le chef juge peut bloquer définitivement la saisie

---

## 🔧 Modifications Techniques

### 1. Frontend - Interface Juge

**Fichier :** `frontend/src/components/JudgeInterface.tsx`

#### Ligne 301-311 : Nouvelle logique `isTimerActive()`

**AVANT :**
```typescript
const isTimerActive = () => {
  if (!configSaved) return false;
  return timer.isRunning;  // ❌ Bloqué dès que timer s'arrête
};
```

**APRÈS :**
```typescript
const isTimerActive = () => {
  if (!configSaved) return false;
  // Bloquer si le timer n'a pas encore démarré (évite les erreurs avant que les surfeurs surfent)
  if (heatStatus === 'waiting') return false;
  // Bloquer si le heat est officiellement clos par le chef juge
  if (heatStatus === 'closed') return false;
  // Autoriser dans tous les autres cas: running, paused, finished
  return heatStatus !== undefined;
};
```

#### Ligne 50-57 : Ajout du paramètre `heatStatus`

```typescript
function JudgeInterface({
  // ... autres props
  heatStatus = 'waiting',  // ← Nouvelle prop avec valeur par défaut
  onHeatClose = () => { },
  isConnected = true
}: JudgeInterfaceProps) {
```

#### Ligne 518-537 : Messages contextuels

**AVANT :**
```typescript
<h3>Timer arrêté - Notation bloquée</h3>
<p>La notation est désactivée car le timer n'est pas en cours d'exécution.</p>
```

**APRÈS :**
```typescript
{heatStatus === 'waiting' ? (
  <>
    <h3>Timer Non Démarré - Notation Bloquée</h3>
    <p>Attendez que le chef juge démarre le timer avant de noter les vagues.</p>
  </>
) : (
  <>
    <h3>Heat Clos - Notation Bloquée</h3>
    <p>La notation est désactivée car le heat a été clôturé par le chef juge.</p>
  </>
)}
```

#### Ligne 408-420 : Messages d'erreur contextuels

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Saisie bloquée')) {
    if (message.includes('non démarré')) {
      alert('Impossible de saisir un score : le timer n\'a pas encore été démarré.');
    } else {
      alert('Impossible de saisir un score : le heat a été clôturé par le chef juge.');
    }
  } else {
    alert('Erreur lors de la soumission du score');
  }
}
```

### 2. Frontend - Page Juge

**Fichier :** `frontend/src/pages/JudgePage.tsx`

#### Ligne 17 : Récupération du `heatStatus`

```typescript
const { timer, setTimer, heatStatus, setHeatStatus } = useJudgingStore();
```

#### Ligne 207 : Passage du `heatStatus` en prop

```typescript
<JudgeInterface
    heatStatus={heatStatus}  // ← Nouvelle prop
    // ... autres props
/>
```

### 3. Backend - Trigger SQL

**Fichier :** `backend/supabase/migrations/20260127000000_allow_scoring_until_heat_closed.sql`

#### Nouvelle fonction de blocage

**AVANT (`fn_block_scoring_when_not_running`) :**
```sql
if v_status is distinct from 'running' then
  raise exception 'Saisie bloquée : heat non running (%)';
end if;
```
- Bloquait dans : `waiting`, `paused`, `finished`, `closed`
- Autorisait seulement : `running`

**APRÈS (`fn_block_scoring_when_closed`) :**
```sql
-- Block if timer not started yet (waiting)
if v_status = 'waiting' then
  raise exception 'Saisie bloquée : heat non démarré (attendez que le timer démarre)';
end if;

-- Block if heat is officially closed or status is missing
if v_status = 'closed' or v_status is null then
  raise exception 'Saisie bloquée : heat clos ou non configuré (status: %)';
end if;

-- Allow scoring in: running, paused, finished
```
- Bloque : `waiting` (avant démarrage), `closed` (après clôture), `null`
- Autorise : `running`, `paused`, `finished`

---

## 🧪 Comment Tester

### Test 1 : Blocage Avant Démarrage Timer (NOUVEAU)

1. **Créer une nouvelle série** (config sauvegardée)
2. **État actuel** : `waiting` (timer pas démarré)
3. **En tant que juge**, essayer de cliquer sur une cellule pour rentrer une note
4. **✅ Vérifier** : Message **"Timer Non Démarré - Notation Bloquée"**
5. **✅ Vérifier** : L'input **ne s'ouvre pas**

### Test 2 : Saisie Après Timer Expiré

1. **Démarrer le timer** → État passe à `running`
2. **Laisser le timer arriver à 0:00** → État passe à `finished`
3. **En tant que juge**, essayer de rentrer une note
4. **✅ Vérifier** : L'input doit **s'ouvrir normalement**, pas de message d'erreur
5. **Soumettre la note** (valeur 0-10)
6. **✅ Vérifier** : La note est bien **enregistrée en base de données**

### Test 3 : Blocage Après Clôture

1. **Chef juge clique sur "Clôturer la série"** → État passe à `closed`
2. **En tant que juge**, essayer de rentrer une note
3. **✅ Vérifier** : Affichage du message **"Heat Clos - Notation Bloquée"**
4. **✅ Vérifier** : L'input **ne s'ouvre pas**

### Test 4 : États Intermédiaires

| Action | État Attendu | Saisie Autorisée ? |
|--------|--------------|---------------------|
| Timer non démarré | `waiting` | ❌ NON (surfeurs pas encore en eau) |
| Timer en cours | `running` | ✅ OUI |
| Timer en pause | `paused` | ✅ OUI |
| Timer expiré | `finished` | ✅ OUI (NOUVEAU !) |
| Heat clos | `closed` | ❌ NON |

---

## 🔄 Workflow Complet

### Scénario d'Utilisation Typique

```
0. Heat créé, config sauvegardée
   └─> heat_realtime_config.status = 'waiting'
   └─> Juges NE PEUVENT PAS saisir ❌ (surfeurs pas encore dans l'eau)
   └─> Message : "Timer Non Démarré - Notation Bloquée"

1. Chef juge lance le timer (20:00)
   └─> heat_realtime_config.status = 'running'
   └─> Juges peuvent saisir ✅

2. Timer atteint 5:00
   └─> Alarme sonore
   └─> Juges continuent de saisir ✅

3. Timer atteint 0:00
   └─> heat_realtime_config.status = 'finished' (automatiquement)
   └─> UI affiche "TEMPS ÉCOULÉ!" en rouge
   └─> Juges peuvent ENCORE saisir ✅ (NOUVEAU COMPORTEMENT)

4. Juges rentrent les dernières notes (2-3 minutes)
   └─> Pas de stress, tout est sauvegardé ✅

5. Chef juge vérifie que toutes les notes sont entrées
   └─> Clique sur "Clôturer la série"
   └─> heat_realtime_config.status = 'closed'

6. Saisie définitivement bloquée ❌
   └─> Message : "Heat Clos - Notation Bloquée"
   └─> Winners avancent au round suivant automatiquement
```

---

## 📊 Comparaison Avant/Après

### AVANT le Fix

```
Config sauvegardée → ✅ INPUTS ACTIFS (erreur!)
        ↓
Timer: 20:00 → 10:00 → 5:00 → 1:00 → 0:00 → 🔴 INPUTS BLOQUÉS
                                       ↑
                              Juges stressés,
                            dernières notes perdues
```

### APRÈS le Fix

```
Config sauvegardée → ❌ INPUTS BLOQUÉS (sécurisé!)
        ↓
   Chef démarre →
        ↓
Timer: 20:00 → 10:00 → 5:00 → 1:00 → 0:00 → ✅ INPUTS ACTIFS
                                       ↓
                               Juges tranquilles,
                           toutes les notes rentrées
                                       ↓
                          Chef juge clique "Clôturer"
                                       ↓
                               🔴 INPUTS BLOQUÉS
```

---

## 🚀 Déploiement

### Compilation et Test

```bash
cd frontend
npm run build
```

✅ Build réussit sans erreur

### Appliquer la Migration SQL

```bash
cd backend/supabase
supabase db push
```

Ou via Supabase Dashboard → SQL Editor → Exécuter `20260127000000_allow_scoring_until_heat_closed.sql`

---

## 📝 Checklist de Validation

- [x] Frontend : Modifier `isTimerActive()` pour bloquer `waiting` et `closed`
- [x] Frontend : Messages contextuels selon `heatStatus`
- [x] Frontend : Passer `heatStatus` en prop depuis JudgePage
- [x] Backend : Migration SQL bloque `waiting` + `closed`
- [x] Tests : Build réussit sans erreur
- [ ] Tests : Tests manuels (waiting → running → finished → closed)
- [ ] Déploiement : Migration SQL appliquée en production
- [ ] Validation : Test sur le terrain

---

**Date du Fix :** 2026-01-27
**Version :** v1.2.0
**Sécurité :** Empêche les saisies avant démarrage ET après clôture
**Flexibilité :** Permet les saisies après expiration du timer
