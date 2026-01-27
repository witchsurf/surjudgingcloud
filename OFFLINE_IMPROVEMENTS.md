# Améliorations Offline & Fallback Robuste

## 🎯 Objectif

Améliorer la résilience du système lors de pertes de connexion Internet temporaires.

**Problèmes Actuels :**
- ❌ Retry immédiat (pas d'exponential backoff)
- ❌ Avancement des gagnants impossible offline
- ❌ Pas de Service Worker (app ne charge pas offline)
- ❌ Pas de détection de qualité réseau
- ❌ localStorage limité à 5-10MB

---

## 🚀 Améliorations Prioritaires

### 1. Service Worker pour Cache Offline

**Fichier à créer :** `frontend/public/sw.js`

```javascript
// Service Worker pour cache offline
const CACHE_NAME = 'surfjudging-v1.2.0';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/judge',
  '/display',
  '/admin',
  // Sera généré automatiquement par Vite
];

// Installation - Cache les ressources statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activation - Nettoie les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch - Stratégie Network First, fallback vers Cache
self.addEventListener('fetch', event => {
  const { request } = event;

  // API Supabase : Toujours tenter le réseau
  if (request.url.includes('supabase.co') || request.url.includes(':8000')) {
    event.respondWith(
      fetch(request)
        .catch(() => new Response(JSON.stringify({
          error: 'offline',
          message: 'Connexion perdue - données en cache'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Ressources statiques : Cache First
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request))
      .catch(() => caches.match('/index.html'))
  );
});
```

**Enregistrer dans `frontend/src/main.tsx` :**

```typescript
// Enregistrer Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('✅ Service Worker enregistré', reg.scope))
      .catch(err => console.error('❌ Erreur Service Worker', err));
  });
}
```

---

### 2. Exponential Backoff pour Retry

**Fichier à modifier :** `frontend/src/hooks/useSupabaseSync.ts`

**Ajouter cette fonction :**

```typescript
/**
 * Exponential backoff avec jitter
 * @param attempt Numéro de tentative (0, 1, 2, ...)
 * @param baseDelay Délai de base en ms (default: 1000)
 * @param maxDelay Délai max en ms (default: 30000)
 * @returns Délai en ms avant prochaine tentative
 */
function calculateBackoff(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 0.3 * exponentialDelay; // ±30% jitter
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Retry avec backoff
 * @param fn Fonction async à exécuter
 * @param maxRetries Nombre max de tentatives (default: 5)
 * @returns Résultat ou throw error
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Si dernière tentative, throw
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculer délai
      const delay = calculateBackoff(attempt);
      console.log(`⏳ Tentative ${attempt + 1}/${maxRetries} échouée, retry dans ${delay}ms`);

      // Attendre avant retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
```

**Utilisation dans `syncPendingScores` :**

```typescript
const syncPendingScores = useCallback(async () => {
  if (!navigator.onLine || !isSupabaseConfigured() || !supabase) {
    console.log('⚠️ Offline ou Supabase non configuré');
    return;
  }

  const pendingScores = getLocalScores().filter(s => !s.synced);
  if (pendingScores.length === 0) return;

  setSyncStatus(prev => ({ ...prev, pendingScores: pendingScores.length }));

  try {
    // Retry avec backoff
    await retryWithBackoff(async () => {
      const { error } = await supabase!
        .from('scores')
        .upsert(pendingScores.map(score => ({
          id: score.id,
          heat_id: score.heat_id,
          competition: score.competition,
          division: score.division,
          round: score.round,
          judge_id: score.judge_id,
          judge_name: score.judge_name,
          surfer: score.surfer,
          wave_number: score.wave_number,
          score: score.score,
          timestamp: score.timestamp,
          event_id: score.event_id,
        })), { onConflict: 'id' });

      if (error) throw new Error(error.message);
    }, 5); // Max 5 tentatives

    // Succès : Marquer comme synced
    pendingScores.forEach(score => {
      score.synced = true;
    });
    saveLocalScores(getLocalScores());

    setSyncStatus(prev => ({
      ...prev,
      pendingScores: 0,
      lastSync: new Date(),
      syncError: null
    }));

    console.log('✅ Sync réussie:', pendingScores.length, 'scores');
  } catch (error) {
    console.error('❌ Échec sync après retries:', error);
    setSyncStatus(prev => ({
      ...prev,
      syncError: 'Échec synchronisation après plusieurs tentatives'
    }));
  }
}, []);
```

---

### 3. IndexedDB pour Stockage Plus Grand

**Fichier à créer :** `frontend/src/lib/idbStorage.ts`

```typescript
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface SurfJudgingDB extends DBSchema {
  scores: {
    key: string;
    value: {
      id: string;
      heat_id: string;
      judge_id: string;
      surfer: string;
      wave_number: number;
      score: number;
      timestamp: string;
      synced: boolean;
      created_at: Date;
    };
    indexes: {
      'by-heat': string;
      'by-synced': boolean;
    };
  };

  heats: {
    key: string;
    value: {
      id: string;
      competition: string;
      division: string;
      round: number;
      heat_number: number;
      participants: any[];
      cached_at: Date;
    };
  };
}

let dbInstance: IDBPDatabase<SurfJudgingDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<SurfJudgingDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<SurfJudgingDB>('SurfJudging', 2, {
    upgrade(db, oldVersion) {
      // Scores
      if (!db.objectStoreNames.contains('scores')) {
        const scoresStore = db.createObjectStore('scores', { keyPath: 'id' });
        scoresStore.createIndex('by-heat', 'heat_id');
        scoresStore.createIndex('by-synced', 'synced');
      }

      // Heats
      if (!db.objectStoreNames.contains('heats')) {
        db.createObjectStore('heats', { keyPath: 'id' });
      }
    },
  });

  return dbInstance;
}

// Scores
export async function saveScoreIDB(score: any) {
  const db = await getDB();
  await db.put('scores', { ...score, created_at: new Date() });
}

export async function getUnsyncedScores() {
  const db = await getDB();
  return await db.getAllFromIndex('scores', 'by-synced', false);
}

export async function markScoresSynced(ids: string[]) {
  const db = await getDB();
  const tx = db.transaction('scores', 'readwrite');
  await Promise.all(ids.map(id =>
    db.get('scores', id).then(score => {
      if (score) {
        score.synced = true;
        return tx.store.put(score);
      }
    })
  ));
  await tx.done;
}

// Heats (Cache pour offline advancement)
export async function cacheHeatData(heatId: string, participants: any[]) {
  const db = await getDB();
  await db.put('heats', {
    id: heatId,
    participants,
    cached_at: new Date(),
  });
}

export async function getCachedHeat(heatId: string) {
  const db = await getDB();
  return await db.get('heats', heatId);
}
```

**Installation :**
```bash
npm install idb
```

---

### 4. Circuit Breaker Pattern

**Fichier à créer :** `frontend/src/lib/circuitBreaker.ts`

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;  // Nombre d'échecs avant ouverture
  successThreshold: number;  // Nombre de succès pour fermer
  timeout: number;           // Durée d'ouverture (ms)
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt: number = Date.now();

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Si ouvert, vérifier si on peut réessayer
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker ouvert - service indisponible');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        console.log('✅ Circuit breaker fermé - service rétabli');
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.successCount = 0;

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.options.timeout;
      console.warn('🔴 Circuit breaker ouvert - service instable');
    }
  }

  getState() {
    return this.state;
  }
}

// Instance globale pour Supabase
export const supabaseCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,    // 5 échecs consécutifs
  successThreshold: 2,    // 2 succès pour réouvrir
  timeout: 30000,         // 30 secondes d'ouverture
});
```

**Utilisation :**

```typescript
import { supabaseCircuitBreaker } from '../lib/circuitBreaker';

const saveScore = async (score: Score) => {
  try {
    await supabaseCircuitBreaker.execute(async () => {
      const { error } = await supabase!.from('scores').insert(score);
      if (error) throw error;
    });
  } catch (error) {
    // Fallback : sauver en local
    saveScoreLocally(score);
  }
};
```

---

### 5. Cache Heat Advancement Data

**Fichier à modifier :** `frontend/src/hooks/useHeatManager.ts`

**Dans `closeHeat()`, ajouter cache avant fetch :**

```typescript
const closeHeat = async () => {
  try {
    // ... code existant ...

    // NOUVEAU : Tenter avec cache si offline
    let sequence, entries, mappings;

    if (navigator.onLine) {
      // Online : Fetch depuis DB
      sequence = await fetchOrderedHeatSequence(activeEventId, division);
      entries = await fetchHeatEntriesWithParticipants(currentHeatId);
      mappings = await fetchHeatSlotMappings(heatId);

      // Cache pour offline
      await cacheHeatData(currentHeatId, { sequence, entries, mappings });
    } else {
      // Offline : Utiliser cache
      const cached = await getCachedHeat(currentHeatId);
      if (!cached) {
        throw new Error('Données heat non disponibles offline');
      }
      ({ sequence, entries, mappings } = cached);
    }

    // ... reste du code advancement ...
  } catch (error) {
    console.error('❌ Erreur closeHeat:', error);
    alert('Impossible de clôturer offline - connexion requise');
  }
};
```

---

## 📊 Comparaison Avant/Après

| Aspect | AVANT | APRÈS |
|--------|-------|-------|
| **App Offline** | ❌ Ne charge pas | ✅ Service Worker cache HTML |
| **Retry Logic** | ⚠️ Immédiat | ✅ Exponential backoff + jitter |
| **Stockage** | ⚠️ 5-10MB localStorage | ✅ IndexedDB illimité |
| **Résilience** | ❌ Retry infini | ✅ Circuit breaker |
| **Heat Advancement** | ❌ Impossible offline | ✅ Cache participants |
| **UX Erreur** | ⚠️ Console seulement | ✅ Messages utilisateur |

---

## 🚀 Plan d'Implémentation

### Phase 1 : Améliorations Immédiates (1-2h)
- [x] Service Worker basique
- [x] Exponential backoff
- [x] Circuit breaker

### Phase 2 : Stockage Robuste (2-3h)
- [x] IndexedDB setup
- [x] Migration localStorage → IndexedDB
- [x] Cache heat data

### Phase 3 : Tests & Validation (1h)
- [ ] Test mode avion
- [ ] Test perte connexion pendant heat
- [ ] Test retry avec backoff
- [ ] Test circuit breaker

---

## ⚠️ Points d'Attention

1. **Service Worker uniquement en HTTPS**
   - `localhost` fonctionne
   - IP locale (192.168.x.x) nécessite HTTPS ou flag Chrome

2. **IndexedDB vs localStorage**
   - Migrer progressivement
   - Garder localStorage comme fallback
   - Tester compatibilité Safari

3. **Circuit Breaker Timeout**
   - 30s peut être long sur le terrain
   - Ajuster selon conditions réelles

---

Toutes ces améliorations sont **compatibles** avec la solution réseau local ! 🎉
