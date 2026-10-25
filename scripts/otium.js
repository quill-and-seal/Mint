/**
 * Pont avec Otium (module de tavernes de l'atelier Quill & Seal).
 *
 * Otium paie les commandes en écrivant directement la monnaie de la fiche dnd5e, celle que
 * Mint lit : les bourses restent donc cohérentes sans rien faire. Mint ajoute les commandes
 * de taverne à son historique, et met à disposition d'Otium (et de ses futurs mini-jeux)
 * l'API de paiement et de cagnottes : api.pay, api.receive, api.pot.
 */

import { MODULE_ID, SETTINGS, t } from "./constants.js";
import { getConfig } from "./currencies.js";
import { historyApi } from "./history.js";

const OTIUM_ID = "otium";

/** Montant Otium (en pièces de cuivre dnd5e) → unités de base de Mint, si une pièce est reliée à « cp ». */
function fromCopper(cp) {
  const copper = getConfig().currencies.find((c) => c.sheetKey === "cp");
  return copper ? { amount: Math.round(cp * copper.value), system: copper.system } : { amount: null, system: null };
}

export function registerOtiumBridge() {
  if (!game.modules.get(OTIUM_ID)?.active) return;

  // Le hook est appelé sur le client du joueur qui commande
  Hooks.on(`${OTIUM_ID}.orderPlaced`, ({ actor, tavern, lines, total } = {}) => {
    if (!actor || !game.settings.get(MODULE_ID, SETTINGS.otiumHistory)) return;
    const items = (lines ?? []).map(({ item, qty }) => `${qty}× ${item?.name ?? "?"}`).join(", ");
    const { amount, system } = fromCopper(Number(total) || 0);
    historyApi
      .add({
        type: "otium",
        icon: "fa-beer-mug-empty",
        text: t("History.OtiumOrder", { name: actor.name, tavern: tavern?.name || t("History.Tavern"), items }),
        actors: [actor.uuid],
        amount,
        system
      })
      .catch((err) => console.warn("Mint | commande Otium non inscrite à l'historique", err));
  });
}
