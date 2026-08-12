# P2.7.17C — Podium B runtime certification

1. Runtime initial: ancien build `surfjudging-2026.08.11-p2.7.16-display-convergence`.
2. Ancien bundle: `configStore-DALjxYBc.js`; Podium B sans heat faisait encore `config: INITIAL_CONFIG`.
3. Build local vérifié: `configStore-BLnvhYQ.js` (bundle réellement nommé `configStore-BLnvhYqL.js`).
4. Déploiement: backup `releases/mac-runtime/backups/dist-before-p2.7.17b-podium-b-context-20260812-165044/`.
5. Copie Field effectuée par `rsync --delete` vers `releases/mac-runtime/current/dist/`.
6. Frontend redémarré avec `docker restart surfjudging`.
7. Manifest LAN vérifié: `surfjudging-2026.08.12-p2.7.17b-podium-b-context`.
8. Bundle LAN vérifié: `configStore-BLnvhYqL.js`.
9. Branche LAN vérifiée: `competition: resolveEventDisplayName(...)`, sans reset vers `INITIAL_CONFIG`.
10. Aucun code métier supplémentaire modifié pendant le déploiement.
11. Aucun juge, score, timer, Display ou donnée Mamelles modifié.
12. Playwright probe read-only exécuté sur le runtime redémarré; aucune écriture de scoring.
13. Certification UI complète A → B sans SAVE reste à confirmer manuellement sur le poste opérateur.

## Verdict

PODIUM B EVENT CONTEXT CERTIFIED (runtime/bundle)
