# P2.6.2a — Récupération de l’accès SSH HP existant

Date : 8 août 2026  
Cible : `admin-surfjudging@10.0.0.10`  
Nature du lot : diagnostic non mutant uniquement.

## Conclusion

**EXISTING_HP_SSH_ACCESS_NOT_FOUND**

La méthode d’accès historique n’a pas pu être reconstituée depuis les emplacements légitimes et les historiques disponibles sur ce Mac. Aucune clé n’a été créée, copiée ou déplacée ; `authorized_keys` n’a pas été consulté ou modifié ; aucune commande distante authentifiée et aucun déploiement n’ont été exécutés.

P2.6.3 reste arrêté au PREDEPLOY.

## Endroits vérifiés

| Source | Résultat |
|---|---|
| `scripts/hp-ops.sh`, `scripts/hp-backup.sh`, scripts HP associés | utilisateur par défaut `admin-surfjudging`; hôte fourni par profil/`SURF_HP_HOST`; appels SSH standards, sans `-i`, alias, port spécial, `ProxyJump` ou méthode d’authentification propre au HP |
| `docs/`, `AGENTS.md`, rapports P0/P1/P2 | commandes documentées avec l’utilisateur standard; anciennes adresses trouvées : `10.0.0.14`, `10.0.0.20`, `10.0.0.23`, `192.168.1.2`; aucune trace probante d’un accès réussi avec une identité explicite |
| historique Zsh disponible | aucune commande SSH/HP historique exploitable trouvée |
| historiques Codex disponibles sous `~/.codex/sessions` | aucune exécution réussie de `hp-ops`, backup, refresh ou déploiement SSH retrouvée; seules les tentatives récentes refusées ou expirées apparaissent |
| variables d’environnement | seulement `SSH_AUTH_SOCK`; aucune variable HP/SSH dédiée chargée |
| `~/.ssh/config` | inclut uniquement la configuration Colima; aucune section HP, aucun alias et aucun `IdentityFile` HP |
| emplacements de clés légitimes (`~/.ssh`, configuration incluse, dépôt, configuration Codex) | aucun fichier de clé privée/public standard ou explicitement référencé pour le HP |
| Trousseau macOS, compte `admin-surfjudging`, IP connues | aucune entrée Internet Password trouvée; aucun secret n’a été demandé ou affiché |

La recherche de fichiers est restée limitée à `~/.ssh`, `~/.codex`, à la configuration utilisateur connue et au dépôt. Aucun scan global du disque n’a été effectué.

## Agent SSH

L’agent sélectionné par l’environnement est le socket launchd macOS. Les deux contrôles demandés ont été exécutés sans recopier de matériau public dans ce rapport :

- `ssh-add -l` : **0 identité chargée** ; aucun fingerprint, type ou commentaire disponible ;
- `ssh-add -L` : **0 identité exportée**.

Deux sockets historiques ont également été découverts dans `~/.ssh/agent` :

- un socket orphelin daté du 5 août : connexion refusée ;
- un socket relié à un processus `/usr/bin/ssh-agent -l` daté du 8 août : la requête `ssh-add -l` ne répond pas et a dû être interrompue sans modifier le processus.

Ce second socket ne constitue donc pas une méthode récupérée : aucune identité, aucun fingerprint et aucune authentification HP n’ont pu être confirmés. Il n’a pas été redémarré, supprimé ou reconfiguré.

## Configuration SSH effective

`ssh -G admin-surfjudging@10.0.0.10` donne :

| Paramètre | Valeur effective |
|---|---|
| `user` | `admin-surfjudging` |
| `hostname` | `10.0.0.10` |
| `port` | `22` |
| `identitiesonly` | `no` |
| `proxyjump` / `proxycommand` | aucun |
| `identityfile` | uniquement les chemins OpenSSH standards sous `~/.ssh` |

Aucun des fichiers d’identité standards annoncés par cette configuration n’existe dans `~/.ssh`.

## Commandes historiques recherchées

La recherche a couvert les variantes suivantes :

- `ssh -i <chemin>` et `IdentityFile` ;
- alias SSH et hostname particulier ;
- agent SSH et socket d’agent dédié ;
- `SURF_HP_HOST`, `SURF_HP_USER`, port ou utilisateur alternatif ;
- `sshpass`, `SSH_ASKPASS`, wrapper `expect` ou variable de mot de passe ;
- commandes vers les IP actuelles et historiques documentées.

Le chemin historique le plus probable dans le code reste un SSH standard, éventuellement alimenté autrefois par un agent ou une session interactive. L’identité ou le moyen d’authentification correspondant n’est toutefois plus disponible de façon vérifiable dans l’environnement courant.

## Test non mutant

La tentative directe déjà caractérisée avec l’agent courant vide :

```text
ssh -o BatchMode=yes admin-surfjudging@10.0.0.10 true
```

atteint le serveur SSH mais échoue par `Permission denied (publickey,password)`.

Le test `hostname && whoami` n’a pas été lancé : aucune méthode historique authentifiée n’ayant été retrouvée, le prérequis de cette étape n’est pas satisfait. Aucune tentative interactive de deviner un mot de passe n’a été faite.

## Cause précise du blocage

Le HP est joignable sur `10.0.0.10:22`, mais l’environnement courant ne fournit ni fichier d’identité existant, ni identité chargée dans l’agent actif, ni alias/configuration spécifique, ni entrée de Trousseau, ni trace de commande réussie permettant de reproduire l’authentification historique. Le seul agent historique encore vivant est non répondant et ne permet pas d’établir qu’il contient une clé HP.

Conformément à la consigne, le lot s’arrête ici. La release cible reste inchangée et non déployée :

- commit : `36dba46dcd639c9ae7001291f76ba863fc8b0ff1` ;
- RELEASE_ID : `surfjudging-2026.08.08-p2.5.7-36dba46dcd63`.
