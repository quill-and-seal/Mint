# Mint

Économie pour **Foundry VTT v14** : monnaies personnalisées et change, boutiques aux prix qui suivent l'offre et la demande, marchands sur la scène, réputation et marchandage, prêts et dettes avec échéances, historique des transactions.

Mint est **agnostique** : il fonctionne avec n'importe quel système de jeu. Avec **dnd5e**, les pièces sont lues et écrites directement sur la fiche (`system.currency`), donc ce que montre Mint et ce que montre la fiche restent identiques.

Un module de l'atelier [Quill & Seal](https://github.com/quill-and-seal).

## Installation

Dans Foundry, **Modules complémentaires → Installer un module**, puis colle ce lien de manifeste :

```
https://github.com/quill-and-seal/Mint/releases/latest/download/module.json
```

## Où trouver Mint

- Dans la barre d'outils de gauche, groupe **Jetons** : **Bourse** (pièces), **Boutiques** et **Prêts et dettes**. Ces boutons sont visibles par tous les joueurs.
- Sur les fiches d'acteur : bouton **Bourse** dans le menu de l'en-tête (et **Boutique** sur la fiche d'un marchand).
- Sur la scène : **double-clic sur le token d'un marchand** pour ouvrir sa boutique. On peut aussi cibler le marchand puis cliquer sur **Boutiques**.
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
- **Revente** : le marchand rachète les articles cochés à un pourcentage de son prix.
- **Caisse** : illimitée, d'un montant fixe, ou **la bourse du marchand** (les achats l'enrichissent, et il ne rachète que ce qu'il peut payer).

Le paiement rend la monnaie automatiquement.

### Marchands sur la scène

Glisse un acteur ou un token dans l'éditeur de boutique pour en faire le **marchand**. Un double-clic sur son token ouvre la boutique pour les joueurs, même sans droit de voir sa fiche. Le MJ garde la fiche au double-clic, et ouvre la boutique avec **Alt + double-clic**. Son portrait apparaît dans la boutique.

Un réglage optionnel impose une **distance maximale** entre le personnage et le token du marchand pour commercer.

### Réputation et marchandage

L'onglet **Clientèle** de l'éditeur règle, pour chaque personnage, un **ajustement de prix** : −10 donne 10 % de remise à l'achat et une revente 10 % plus chère, +20 rend tout 20 % plus cher.

Le **marchandage** s'active par boutique. Le joueur clique sur **Marchander**, et le MJ fait le jet (Persuasion pour dnd5e, formule réglable) contre la difficulté de la boutique :

- réussite : 5 % de remise, plus 1 % par point au-dessus de la difficulté, jusqu'à un plafond ;
- échec de 5 ou plus : le marchand, vexé, majore ses prix ;
- le résultat dure un certain temps (en heures du temps du monde) avant de pouvoir remarchander.

Les prix affichés sont toujours ceux du personnage choisi.

## Prêts et dettes

- Un joueur **propose** une dette à un autre personnage. L'autre partie l'**accepte** ou la **refuse** (le MJ répond pour les PNJ sans joueur).
- **Prêt** : le créancier verse la somme au débiteur dès l'acceptation. Décoché, c'est une simple reconnaissance de dette.
- **Intérêts** simples : un pourcentage du capital à chaque période complète (en jours du temps du monde).
- **Échéance** optionnelle (en jours) avec **pénalité de retard** (un pourcentage du capital). Les parties sont prévenues la veille (réglable), puis quand la dette passe en retard.
- Le débiteur **rembourse** tout ou partie ; le créancier peut **effacer** la dette.
- Le MJ voit tout, **crée** des dettes directement (y compris avec une partie libre : banque, guilde, PNJ…) et peut les annuler.

## Historique

Chaque transaction est inscrite : dons, changes, achats, ventes, prêts, remboursements, retards, mises… La **Bourse** montre les dernières, et le bouton **Historique** ouvre la liste complète. Chaque joueur y voit ses personnages, le MJ voit tout. L'historique s'exporte en CSV.

## Otium

Avec [Otium](https://github.com/quill-and-seal/Otium) (tavernes), les deux modules partagent la même bourse dnd5e. Les commandes passées à la taverne apparaissent dans l'historique de Mint, et Otium (ou n'importe quel module de mini-jeux) peut utiliser l'API de paiement et de **cagnottes de mises** décrite plus bas.

## Réglages

- **Transactions dans le chat** : jamais, en message privé au MJ (par défaut) ou visibles par tous.
- **Taille de l'historique** (500 par défaut, 0 pour le désactiver).
- **Double-clic sur les marchands** et **distance aux marchands**.
- **Jet de marchandage** : formule avec les données du personnage.
- **Rappel avant échéance** (en jours).
- **Commandes Otium dans l'historique**.

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
mint.openWallet(actor); mint.openShops(); mint.openLedger(); mint.openHistory(actor);

// Paiements pour les autres modules (montants en unités de base)
await mint.pay(actor, 150, { reason: "Péage", source: "mon-module" });   // le joueur paie
await mint.receive(actor, 40, { reason: "Pourboire" });                  // MJ seulement

// Cagnottes de mises (mini-jeux) : l'argent quitte la bourse à la mise
const { id } = await mint.pot.create({ label: "Dés du menteur" });
await mint.pot.stake(id, actorA, 100);
await mint.pot.stake(id, actorB, 100);
await mint.pot.settle(id, [actorB]);       // ou [{ actor: a, share: 2 }, { actor: b, share: 1 }]
await mint.pot.refund(id);                 // tout le monde récupère sa mise

// Historique
await mint.history.add({ type: "otium", text: "…", actors: [actor.uuid] });
mint.history.for(actor);
```

Le hook `mint-economy.ready` est appelé avec l'API quand Mint est prêt. La cagnotte se règle par le MJ ou par l'utilisateur qui l'a ouverte.

## Développement

Aucune dépendance pour le module lui-même. Pour les vérifications :

```
npm test        # calculs (monnaie, prix, intérêts) + test de fumée dans un faux Foundry
npm run check   # syntaxe, imports, traductions, manifeste
```

## Licence

MIT
