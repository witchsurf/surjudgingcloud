# P1 — spécification du health-check terrain

Le diagnostic doit rester utilisable sans WAN et ne doit effectuer aucun appel Internet en mode terrain.

États requis : frontend disponible, base accessible et Realtime abonné. Supabase local est visible séparément dans le panneau navigateur. L’ESP32 est optionnel : `ok` s’il répond, `absent` sinon, sans dégrader le scoring ni le statut des contrôles requis.

La fonction Supabase détecte le mode terrain avec `FIELD_MODE=true` ou une `SUPABASE_URL` locale. Dans ce mode, N8N et Stripe valent `skipped` et ne sont jamais contactés. `FRONTEND_HEALTH_URL` n’est sondée que si elle est locale. `ESP32_HEALTH_URL` vaut `http://priority.local` par défaut.

Le script `hp-healthcheck.sh` ne compare plus le bundle public par défaut. Cette vérification ne peut être activée que volontairement avec `SURF_HP_CHECK_CLOUD=1`, hors health-check terrain normal. Une panne ESP32 produit un avertissement non bloquant.
