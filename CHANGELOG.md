# Changelog

## 0.3.0

- **Économie du monde** : régions qui produisent et consomment des biens, prix selon les stocks, routes commerciales où les marchands font l'arbitrage, prospérité des régions, pertes quotidiennes. Le monde avance avec le calendrier de Foundry ou à la main (+1 / +7 jours).
- **Monde d'exemple** équilibré : quatre régions, huit biens, quatre routes, quatre factions. Ou un monde vide.
- **Factions cotées** : guildes, compagnies et banques avec trésorerie, cours de l'action, dividendes. Les personnages achètent et vendent des actions.
- **Prêts des banques** : demande depuis la Bourse, réponse du MJ dans Prêts et dettes ; le prêt versé et les remboursements passent par la trésorerie de la banque.
- **Événements économiques** : famine, guerre, peste, ruée minière, festival, tempêtes, récolte abondante, embargo, sur une région ou partout ; alertes de pénurie.
- **Bourse** : nouvelle fenêtre (Marchés, Factions, Portefeuille, Monnaie, Événements) avec bandeau défilant des cours, courbes et indice des prix.
- **Éditeur du monde** pour le MJ : biens, régions, routes, factions, réglages de la simulation.
- **Boutiques indexées** : une boutique a une région, un article peut suivre le cours d'un bien.
- **Nouveau thème** « bourse cyberpunk » pour toutes les fenêtres de Mint.
- Les prix s'écrivent sans platine ni électrum par défaut (« 37 po 7 pc ») ; réglable pièce par pièce.

## 0.2.0

- **Marchands sur la scène** : un acteur tient la boutique. Double-clic sur son token pour l'ouvrir (Alt + double-clic pour le MJ), ou ciblage du marchand puis bouton Boutiques. Son portrait s'affiche dans la boutique, et un bouton Boutique apparaît sur sa fiche. Une distance maximale au marchand est réglable.
- **Caisse** : illimitée, montant fixe ou bourse du marchand (les achats l'enrichissent, les rachats la vident).
- **Réputation** : ajustement de prix par personnage et par boutique (remise ou majoration, à l'achat comme à la revente).
- **Marchandage** : jet fait par le MJ (Persuasion pour dnd5e, formule réglable) contre une difficulté. Réussite = remise plafonnée, échec de 5 ou plus = marchand vexé. L'effet dure un temps réglable.
- L'éditeur de boutique passe en trois onglets : Boutique, Articles, Clientèle.
- **Échéances** des dettes avec pénalité de retard, rappels la veille (réglable) et au retard.
- **Historique** des transactions : dernières entrées dans la bourse, fenêtre complète filtrée par personnage, export CSV.
- **Otium** : les commandes de taverne sont inscrites à l'historique.
- **API pour les autres modules** : `pay`, `receive` et **cagnottes de mises** (`pot.create`, `stake`, `settle`, `refund`), hook `mint-economy.ready`.

## 0.1.0

Première version.

- **Monnaies** : systèmes monétaires et devises configurables, préréglages fantasy et une seule monnaie, lien optionnel avec les champs de la fiche (dnd5e : `system.currency`).
- **Bourse** : pièces par système et total, don à un autre personnage, changeur entre systèmes (frais réglables), regroupement des pièces ; édition directe par le MJ.
- **Boutiques** : articles reliés à des objets (glisser-déposer, prix deviné) ou services, achat avec monnaie rendue, revente, caisse optionnelle.
- **Offre et demande** : prix selon le stock (élasticité, bornes), réassort selon le temps du monde, majoration de boutique et multiplicateur par article.
- **Prêts et dettes** : propositions entre joueurs avec acceptation, dettes créées par le MJ (parties libres possibles), versement du prêt, intérêts simples par période, remboursements partiels, dette effacée.
- Transactions annoncées dans le chat (jamais, MJ seul ou tout le monde).
- Toutes les opérations des joueurs sont validées par le MJ connecté.
- API publique : `game.modules.get("mint-economy").api`.
