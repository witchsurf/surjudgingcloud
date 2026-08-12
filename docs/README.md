# Documentation SurfJudging

Ce dossier contient les procédures à utiliser aujourd'hui. Les rapports `P0_*`,
`P1_*` et `P2_*` placés à la racine du dépôt sont des preuves d'audit : ils
décrivent l'état observé au moment de leur rédaction et ne sont pas des runbooks.

## Sources de vérité actuelles

- [Runbook HP/Event Box](hp-operations-runbook.md) : préparation, exploitation terrain, contrôles, sauvegarde et synchronisation.
- [SAVE Admin Field](admin-field-save-workflow.md) : configuration canonique d'un heat planifié et règles de succès/échec.
- [Modes d'exploitation](mode-exploitation.md) : maison, plage et réseau.
- [Provisioning Field](field-deployment-mode-provisioning.md) : mode autoritatif de la base locale.
- [Carte de synchronisation hors ligne](offline-sync-map.md) : WAL, files et reconnexion.
- [Checklist scripts opérateur](scripts-operations-checklist.md).
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) : releases et déploiements Cloud, HP et Event Box Mac.

## Documents spécialisés

- `priority-judge.md` et `esp32-priority-wiring-memo.md` : priorité et matériel.
- `cloudflare-display-hp.md` : diffusion Display Cloud depuis le terrain.
- `plans/` : conceptions futures, non applicables automatiquement au terrain.

## Documents historiques

`DEPLOY_RELEASE_P2_5_7.md` est une checklist de release historique. Elle reste
utile pour l'audit, mais ses versions de migrations et artefacts ne doivent plus
être appliquées comme procédure courante.

Avant de supprimer un rapport historique, vérifier qu'aucun rapport ultérieur
ne le référence. Une procédure obsolète doit être retirée des sources de vérité
ci-dessus ; elle peut rester dans l'historique si elle est clairement étiquetée.
