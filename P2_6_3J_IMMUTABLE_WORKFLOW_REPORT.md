# P2.6.3J — Immutable Frontend Deployment Workflow

Date : 2026-08-08

## Objectif

Remplacer le rebuild frontend historique sur le VPS par le déploiement de l'archive unique signée :

- commit applicatif : `30705d1fc8153659654d676618f17567ba9b849e`;
- RELEASE_ID : `surfjudging-2026.08.08-p2.6.3i-30705d1`;
- archive : `releases/surfjudging-2026.08.08-p2.6.3i-30705d1-frontend.tar.gz`;
- SHA-256 : `6b413eae3b68b88fc278be4a85a8772302d85a70fd6a7b39259e95b3edf74b85`.

Le commit d'infrastructure qui porte le workflow ne change pas l'identité du commit applicatif ni celle de l'archive.

## Avant

Le workflow GitHub :

1. ouvrait une session SSH sur le VPS;
2. exécutait `/opt/judging/deploy.sh`;
3. faisait `git reset --hard origin/main`;
4. exécutait `npm ci` et `npm run build` sur le VPS;
5. exécutait `docker compose down`, puis `docker compose up -d --build`.

Le service `surfjudging` utilisait une image contenant une copie de `frontend/dist`. Aucun répertoire release ni symlink actif n'existait dans le Compose versionné. Le rollback exigeait un retour Git et un nouveau build.

## Après

### GitHub Actions

Le workflow :

1. checkout le dépôt contenant l'archive préconstruite;
2. vérifie l'existence du commit applicatif;
3. vérifie le SHA-256 de l'archive;
4. copie uniquement l'archive, `deploy.sh` et le Compose sur le VPS;
5. appelle le déploiement immuable;
6. vérifie HTTP `/admin` et `/RELEASE_ID`;
7. sérialise les déploiements avec une concurrency group sans annulation en cours.

Il ne contient plus `npm ci`, `npm run build`, `docker compose down` ni `docker compose ... --build`.

### VPS

Layout cible :

```text
/opt/surfjudging/releases/<RELEASE_ID>/dist
/opt/surfjudging/current -> /opt/surfjudging/releases/<RELEASE_ID>
```

Le script :

- refuse un RELEASE_ID, chemin ou SHA invalide;
- extrait dans un répertoire temporaire neuf;
- vérifie `index.html`, `sw.js` et le chunk XLSX;
- écrit les marqueurs `ARCHIVE_SHA256` et `dist/RELEASE_ID`;
- sauvegarde le frontend du conteneur existant comme première release legacy;
- active le nouveau symlink avec `os.replace`, donc atomiquement;
- recrée uniquement `surfjudging` avec `docker compose up -d --no-build --no-deps`;
- vérifie HTTP et RELEASE_ID;
- restaure le symlink précédent et recrée le seul frontend si le health-check échoue.

### Nginx / Compose

Le service frontend monte désormais :

```text
${SURFJUDGING_CURRENT_DIR:-/opt/surfjudging/current}/dist
  -> /usr/share/nginx/html:ro
```

Traefik, n8n et les bases ne sont ni reconstruits ni redémarrés par ce déploiement frontend.

## Validation locale

- `bash -n deploy.sh` : PASS;
- parsing YAML du workflow : PASS;
- `docker compose config --quiet` avec variables factices : PASS;
- recherche des commandes de build interdites : aucune dans le chemin de déploiement;
- SHA-256 archive : PASS;
- extraction/symlink/marqueurs avec Docker et curl simulés : PASS;
- portabilité du renommage atomique Linux/macOS : assurée via Python 3 `os.replace`;
- aucun build frontend exécuté.

## Rollback opérateur

Le script affiche `ROLLBACK_TARGET`. Un rollback consiste à repointer atomiquement `/opt/surfjudging/current` sur ce répertoire, puis exécuter uniquement :

```bash
cd /opt/judging/infra
SURFJUDGING_CURRENT_DIR=/opt/surfjudging/current \
  docker compose up -d --no-build --no-deps surfjudging
```

## Limites

- Le premier déploiement dépend de l'image frontend actuellement présente sur le VPS; elle est réutilisée sans build puis reçoit le montage read-only.
- Python 3 doit être présent sur le VPS et le Mac pour le renommage atomique.
- Le marqueur RELEASE_ID est ajouté lors de l'extraction, car l'archive figée ne contient pas littéralement cet identifiant dans son bundle. Les hashes signés de l'archive et des assets restent inchangés.
- La validation terrain Cloud/Mac appartient à la reprise opérationnelle de P2.6.3J après le push et l'exécution du workflow.
