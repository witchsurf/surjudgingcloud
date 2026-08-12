# P2.7.20 — Runtime trace SAVE + Display

1. Runtime manifest: non lisible; `http://127.0.0.1:8080` refuse la connexion.
2. Runtime P2.7.19: non vérifiable dans cette session.
3. Click 1 vs Click 2: non reproduit; aucune divergence ne peut être affirmée sans runtime/browser.
4. SAVE root cause: non déterminée; aucun patch appliqué.
5. Display chain inspected: `subscribeToActiveHeatPointer` → `applyActiveHeatPointer` → `loadConfigFromDb(..., { force: true, podiumId })`.
6. Realtime event/callback/config-store/render timestamps: non observables runtime arrêté.
7. Realtime vs polling: non déterminé.
8. Exact Display root cause: non déterminée; aucun patch appliqué.
9. Files modified: aucun fichier applicatif.
10. Tests/build/deploy: non exécutés, conformément à l’arrêt avant cause prouvée.
11. Verdict: BLOCKED.

Reprendre après démarrage du runtime Field et fournir un accès Playwright au LAN; la trace devra comparer les deux clics et mesurer T0→callback→hydration→rendu.
