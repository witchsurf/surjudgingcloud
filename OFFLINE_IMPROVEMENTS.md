# 🏄‍♂️ Audit de Robustesse et Améliorations Offline

Ce document présente l'état de l'art actuel de la résilience du système de Jugement de Surf face aux pertes de connexion et liste les prochaines étapes concrètes (Roadmap) pour atteindre un niveau de fiabilité PWA (Progressive Web App).

## 📊 1. État Actuel : Ce qui est DÉJÀ en place

Le système dispose actuellement de plusieurs couches de protection "Pro Max" implémentées dans l'interface juge (`JudgeInterface.tsx`) et le stockage local (`ScoreRepository.ts`) :

1. **🔒 Verrouillage Double-Tap (UI Prevention)** : 
   - Désactivation immédiate du bouton de validation pendant la résolution de la requête réseau (`isSubmittingScore`) pour prévenir les doublons accidentels induits par des clics répétés (souvent liés à de la latence).
2. **⚠️ Sécurité de Fermeture (beforeunload)** : 
   - L'application bloque préventivement le juge s'il tente de fermer ou rafraîchir la page alors que des notes sont en attente de synchronisation (`synced: false`).
3. **🔴 Feedback Visuel d'Attente (Badge)** : 
   - Un badge rouge dynamique est positionné sur le bouton "Synchroniser" affichant publiquement le nombre de `pendingSyncCount` en local, invitant le juge à une action de rattrapage dès le retour du réseau (selon la préconisation UX de visibilité de l'état du système).
4. **💾 Fallback LocalStorage (ScoreRepository)** :
   - Sauvegarde synchrone des scores dans `localStorage` avant l'envoi réseau Supabase. Permet de retrouver les notes même après un rafraichissement mortel (si le réseau était tombé).
5. **🛡️ Intégrité Côté Serveur (Supabase)** :
   - Contraintes `CHECK` strictes assurant que le score final est verrouillé mathématiquement entre `0.00` et `10.00`.

---

## 🚀 2. Roadmap : Véritable PWA & Offline-First

Malgré ces sécurités, le système repose toujours sur l'accessibilité initiale au serveur pour charger le HTML/JS. Si le réseau tombe **avant** le chargement de la page, rien ne fonctionnera. Voici le plan cible :

### Étape 1 : Service Worker (Mise en Cache Offline Actif)
Actuellement **non implémenté**, c'est la condition sine qua non pour démarrer l'app en "Airplane Mode".
- **Action** : Créer `sw.js` via Vite-PWA.
- **Stratégie** : *Network First* pour les appels API json, *Cache First* pour les assets statiques (HTML, CSS, JS, Fonts).

### Étape 2 : Migration vers IndexedDB
`localStorage` est excellent mais synchrone (bloquant le thread principal sur de grosses écritures) et limité à 5Mo.
- **Action** : Introduire la librairie `idb` pour remplacer `localStorage`.
- **Intérêt** : Permettre de stocker l'intégralité de la base des participants (`heats` complets, `surfers`) pour permettre à l'algorithme "d'avancement des heats" de tourner même totalement offline.

### Étape 3 : Exponential Backoff
Actuellement, la synchro manuelle (ou via hook automatique) réessaye brutalement ou échoue. 
- **Action** : Ajouter une logique de `retry` qui attend 1s, puis 2s, puis 4s, etc., avec un *jitter* (aléa) pour éviter que 15 tablettes de juges bombardent Supabase à la milliseconde exacte où le réseau de la plage redémarre (Thundering Herd Problem).

### UX/UI : Recommandations PWA
- **Toast Accessibles (`role="alert"`)** : S'assurer que les messages de pertes de connexion utilisent `aria-live` pour être immédiatement identifiables physiquement par les tablettes.
- **Désaturation Visuelle** : Appliquer un filtre CSS de légère désaturation (ex: `grayscale-30`) sur l'en-tête lorsque `isConnected === false`, en plus de la pilule actuelle.

---

*Document mis à jour après audit de sécurité du système le 1er Mars 2026.*
