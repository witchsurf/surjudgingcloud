# AGENTS.md

Consignes projet pour les agents Codex travaillant dans ce dépôt.

## Contexte

Le projet `surjudgingcloud` est une app de jugement surf avec :

- **Frontend** React/Vite dans `frontend/`
- **Backend** Supabase dans `backend/supabase/`
- **App terrain** Electron dans `desktop/` — distribué en `.dmg` (Mac) et `.exe` (Windows)
- Scripts de CI/déploiement cloud dans `scripts/`

### Architecture terrain (depuis v0.6.23)

Le workflow terrain est **exclusivement Electron packagé** :

```
[Mac/PC opérateur]  ──  SurfJudging Field.dmg / .exe
                         └─ Supabase runtime embarqué (bundled)
                         └─ Frontend React servi localement
                         └─ LAN WiFi → tablettes juges + écran display
```

> ⚠️ Le HP Docker externe n'existe plus dans le workflow terrain.
> Les scripts `hp-*` et le runbook HP sont archivés dans `legacy/`.

## Priorités

- Préserver la **fiabilité du .dmg/.exe** — c'est la seule stack terrain.
- Ne pas casser le build Electron : `npm --prefix desktop run package:mac` / `package:win`.
- Préférer les corrections robustes côté Supabase quand le besoin touche la logique métier.
- Le frontend `cloud` et le frontend `field` partagent la même base React — toute modif doit fonctionner dans les deux modes (`VITE_DEPLOYMENT_MODE=cloud|field`).

## Sources De Vérité

| Source | Rôle |
|--------|------|
| `desktop/` | App Electron — packaging .dmg/.exe, runtime Supabase embarqué |
| `frontend/` | Frontend React partagé (cloud + field) |
| `backend/supabase/functions` | Edge Functions Supabase |
| `backend/supabase/migrations` | Migrations DB |
| `DEPLOYMENT.md` | Procédures de release cloud et desktop |
| `docs/field-deployment-mode-provisioning.md` | Provisioning du runtime field |

## Règles De Travail

- Ne jamais supprimer ou écraser des données terrain sans confirmation explicite.
- Les scores sont attachés à la couleur de lycra ; un override de nom/participant ne doit pas modifier les scores.
- Les scripts de réparation de qualifiés sont du secours, pas le chemin normal.
- Après une modification terrain importante, vérifier au minimum :

```bash
npm --prefix frontend run build cloud
npx --prefix frontend tsc --noEmit
```

- Pour valider le packaging desktop :

```bash
npm --prefix desktop run verify:package-input
```

## Ce qui est archivé (ne plus référencer)

Le dossier `legacy/` contient les anciens scripts HP Docker (`hp-*.sh`, `hp-*.mjs`),
les wrappers `event-box`/`beach`/`home`, et le runbook HP.
Conservés à titre historique uniquement.

