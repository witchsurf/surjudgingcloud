# Licences Field hors ligne

Cette couche protège une installation, pas seulement un fichier DMG ou EXE.

1. L’application crée au premier lancement une paire de clés Ed25519 dans le stockage sécurisé du système.
2. L’opérateur copie la demande d’activation depuis `Diagnostic avancé`.
3. L’émetteur crée un certificat signé avec sa clé privée, jamais incluse dans le dépôt ni dans l’installateur.
4. L’opérateur importe ce certificat JSON. L’application vérifie la signature, le produit, la période de validité et l’identité cryptographique de cette installation.

## Mise en production

La politique embarquée est volontairement `disabled` pendant le développement : elle affiche et teste le parcours sans interrompre les installations actuelles.

Avant de publier une version commerciale, remplacer `desktop/src/shared/license-policy.json` par une politique `required` contenant uniquement la ou les clés publiques Ed25519 de l’émetteur. Ne jamais committer la clé privée.

Créer le certificat depuis une machine d’émission contrôlée :

```bash
npm --prefix desktop run license:issue -- \
  --request activation-request.json \
  --issuer-private-key /chemin/protege/issuer-private.pem \
  --key-id issuer-2026-01 \
  --expires-at 2027-09-08T00:00:00.000Z \
  --out offline-license.json
```

La clé privée doit être sauvegardée chiffrée, avec un accès limité aux personnes habilitées à délivrer des licences. La rotation se fait en ajoutant la nouvelle clé publique à la politique, puis en réémettant les certificats. Une licence expirée ou modifiée est refusée au démarrage du runtime ; aucune coupure n’est appliquée au milieu d’un heat déjà en cours.
