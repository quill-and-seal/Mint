# Mint

Économie pour **Foundry VTT v14** : monnaies personnalisées et change, boutiques aux prix qui suivent l'offre et la demande, prêts et dettes entre joueurs.

Mint est **agnostique** : il fonctionne avec n'importe quel système de jeu. Avec **dnd5e**, les pièces sont lues et écrites directement sur la fiche (`system.currency`), donc ce que montre Mint et ce que montre la fiche restent identiques.

Un module de l'atelier [Quill & Seal](https://github.com/quill-and-seal).

## Installation

Dans Foundry, **Modules complémentaires → Installer un module**, puis colle ce lien de manifeste :

```
https://github.com/quill-and-seal/Mint/releases/latest/download/module.json
```

## Où trouver Mint

- Dans la barre d'outils de gauche, groupe **Jetons** : **Bourse** (pièces), **Boutiques** et **Prêts et dettes**. Ces boutons sont visibles par tous les joueurs.
- Sur les fiches d'acteur : bouton **Bourse** dans le menu de l'en-tête.
- Configuration des monnaies (MJ) : **Paramètres du module → Mint → Configurer les monnaies**.

Les opérations des joueurs (dons, achats, remboursements…) sont validées et appliquées par le MJ : **un MJ doit être connecté**.

## Monnaies et change

- Un **système monétaire** regroupe des pièces qui se convertissent entre elles sans frais (cuivre, argent, or…). La plus petite pièce vaut 1, les autres sont des multiples.
- Plusieurs systèmes peuvent coexister (le royaume, une monnaie étrangère…). Chacun a un **taux** par rapport aux autres. Le **changeur** convertit de l'un à l'autre en gardant des frais réglables.
- Deux préréglages : **fantasy** (pp, po, pe, pa, pc, reliés à la fiche dnd5e) et **une seule monnaie** (crédits).
- Une pièce peut être reliée à un **champ de la fiche** (ex. `gp` pour dnd5e) ; sinon, Mint la stocke lui-même sur l'acteur.
- Les montants se tapent librement : `2 po 5 pa`, `2po5pa`, `1,5` (sans unité = devise principale).

La **Bourse** affiche les pièces d'un personnage par système, avec le total. On peut :

- **Donner** des pièces à un autre personnage (joueurs et tokens de la scène) ;
- **Changer** une somme d'un système à un autre ;
- **Regrouper** ses pièces (le moins de pièces possible, sans frais).

Le MJ peut modifier les quantités directement.

## Boutiques

Le MJ crée ses boutiques depuis la fenêtre **Boutiques**, puis les ouvre aux joueurs quand il le souhaite.

- **Articles** : glisse un objet (barre latérale ou compendium) dans l'éditeur ; son prix est deviné quand le système en fournit un. L'acheteur reçoit une copie de l'objet. Un article sans objet relié est un **service** (nuit à l'auberge, repas, réparation…).
- **Offre et demande** : chaque article a un stock normal. Quand le stock baisse, le prix monte ; quand les joueurs ont beaucoup revendu, il baisse. L'**élasticité** règle la force de l'effet, et des **bornes** encadrent le prix. Un stock vide laissé en blanc veut dire illimité, à prix fixe.
- **Réassort** : toutes les N heures du temps du monde, les stocks reviennent vers la normale, dans les deux sens. Un bouton permet aussi de réassortir tout de suite.
- **Modificateurs** du MJ : majoration ou remise de la boutique, multiplicateur par article.
- **Revente** : le marchand rachète les articles cochés à un pourcentage de son prix. Une **caisse** optionnelle limite ce qu'il peut payer.

Le paiement rend la monnaie automatiquement.

## Prêts et dettes

- Un joueur **propose** une dette à un autre personnage. L'autre partie l'**accepte** ou la **refuse** (le MJ répond pour les PNJ sans joueur).
- **Prêt** : le créancier verse la somme au débiteur dès l'acceptation. Décoché, c'est une simple reconnaissance de dette.
- **Intérêts** simples : un pourcentage du capital à chaque période complète (en jours du temps du monde).
- Le débiteur **rembourse** tout ou partie ; le créancier peut **effacer** la dette.
- Le MJ voit tout, **crée** des dettes directement (y compris avec une partie libre : banque, guilde, PNJ…) et peut les annuler.

## Réglages

- **Transactions dans le chat** : jamais, en message privé au MJ (par défaut) ou visibles par tous.

## API

`game.modules.get("mint-economy").api` expose les fonctions utiles à d'autres modules et aux macros :

```js
const mint = game.modules.get("mint-economy").api;
mint.format(250);                          // « 2 po 5 pa »
mint.parse("1 po 5 pa");                   // 150
mint.getWallet(actor);                     // { pp: 0, po: 12, ... }
mint.value(actor);                         // valeur totale, en unités de base
await mint.wallet.give(fromUuid, toUuid, { po: 2 });
await mint.shop.buy(shopId, itemId, actorUuid, 1);
await mint.debt.repay(debtId, 100);
mint.openWallet(actor); mint.openShops(); mint.openLedger();
```

## Développement

Aucune dépendance pour le module lui-même. Pour les vérifications :

```
npm test        # calculs (monnaie, prix, intérêts) + test de fumée dans un faux Foundry
npm run check   # syntaxe, imports, traductions, manifeste
```

## Licence

MIT
