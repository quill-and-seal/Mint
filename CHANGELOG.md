# Changelog

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
