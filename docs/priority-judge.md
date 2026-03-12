# Interface Juge Priorite

## Objectif

Cette interface permet au chef juge de gerer manuellement la priorite pendant une serie, avec une interaction tres simple sur tablette.

## Comment y acceder

La priorite a maintenant sa propre route dediee.

Chemin d'acces:

1. Ouvrir `/priority`
2. Utiliser le lien partage depuis l'admin, idealement `/priority?eventId=...`
3. Entrer le nom du juge priorite sur la tablette
4. Utiliser le panneau `Priorité`

Important:

- Les URLs kiosque `/judge?position=J1`, `/judge?position=J2`, etc. sont pour les juges de notes, pas pour le juge priorite.
- Le chef juge peut encore voir la priorite depuis `/judge`, mais la tablette dediee recommandee est `/priority`.

## Fonctionnement

### 1. Debut de serie

Tous les surfeurs sont egaux.

Action:

- Appuyer sur `Egalite`

Effet:

- Le display montre `=` pour tous les surfeurs

### 2. Premiere attribution de priorite

Quand la priorite initiale doit etre definie:

- Appuyer sur `Definir l'ordre`
- Toucher les surfeurs dans l'ordre reel: prioritaire d'abord, puis 2, puis 3, puis 4
- Appuyer sur `Valider l'ordre`

Effet:

- L'app enregistre l'ordre sous forme `P`, `2`, `3`, `4`
- Le display live reprend le meme ordre

### 3. Quand un surfeur part sur une vague

Si un surfeur actuellement dans le line-up part surfer:

- Toucher sa couleur dans la zone `Line-up`

Effet:

- Il sort de la file de priorite
- Les autres remontent automatiquement
- Le surfeur bascule dans `En vague / hors line-up`

Exemple:

- Avant: `ROUGE=P`, `BLEU=2`, `BLANC=3`, `JAUNE=4`
- Le rouge part: `BLEU=P`, `BLANC=2`, `JAUNE=3`
- `ROUGE` apparait en `Surf`

### 4. Quand un surfeur revient au lineup

Quand le surfeur a fini sa vague et revient au lineup:

- Toucher sa couleur dans `En vague / hors line-up`

Effet:

- Il revient automatiquement en fin de priorite

Exemple:

- Avant retour: `BLEU=P`, `BLANC=2`, `JAUNE=3`, `ROUGE=Surf`
- Apres retour du rouge: `BLEU=P`, `BLANC=2`, `JAUNE=3`, `ROUGE=4`

## Cas d'usage correspondant a ta regle

### Premiere vague de chaque surfeur

Le chef juge peut definir l'ordre initial en fonction de la position a l'interieur.

Ensuite, a chaque depart sur la premiere vague:

- toucher le surfeur qui part
- il sort de la priorite
- les autres avancent
- quand il revient, il prend la derniere place

Cela permet de reproduire la logique:

- premier surfeur a partir devient derniere priorite quand il revient
- puis le suivant prend la meme logique
- la file reste toujours visible et corrigeable en un tap

### Retour au lineup plus rapide qu'un autre

Si `BLANC` part jusqu'au bord et que `JAUNE` part ensuite mais revient avant lui:

- toucher `BLANC` quand il part
- toucher `JAUNE` quand il part
- toucher `JAUNE` des qu'il revient
- toucher `BLANC` seulement lorsqu'il revient vraiment

Resultat:

- `JAUNE` retrouve une meilleure priorite que `BLANC`, car il est remis dans la file avant lui

## Ce qui est volontairement manuel

L'application ne detecte pas automatiquement:

- le depart sur la vague
- le retour reel au lineup
- la position "le plus a l'interieur"

Le juge priorite garde donc la maitrise totale par simple tap, ce qui est plus robuste en situation de competition.
