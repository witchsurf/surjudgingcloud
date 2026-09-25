# legacy/

Contenu archivé lors de la migration vers le workflow **Electron packagé (.dmg / .exe)** en septembre 2026.

## Pourquoi archivé ?

Le HP (Hot Point) était un serveur Docker local embarquant Supabase + nginx,
déployé sur un Mac/PC fixe le jour d'événement.

Depuis la version 0.6.23, le workflow terrain est :
- **`desktop/`** — Application Electron packagée (`.dmg` Mac, `.exe` Win)
- Supabase est **embarqué dans le runtime bundlé** à l'intérieur du `.dmg/.exe`
- Les tablettes juges et l'écran display se connectent directement à l'app Electron via LAN

Le HP Docker externe n'est plus nécessaire. Ces fichiers sont conservés à titre de référence.

## Contenu

- `scripts/hp-*.sh`, `field-menu.sh`, `field-ops.sh` — Scripts de déploiement et maintenance HP Docker
- `scripts/hp-*.mjs` — Tests smoke HP
- `docs/hp-operations-runbook.md`, `docs/cloudflare-display-hp.md` — Runbooks et docs opérateur HP
- `event-box`, `beach`, `home` — Scripts wrappers terrain HP
