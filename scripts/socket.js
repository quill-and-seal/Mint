/**
 * Requêtes exécutées par le MJ.
 *
 * Toutes les opérations qui modifient l'argent, les boutiques ou les dettes passent
 * par ici : le client du MJ actif les valide (droits du joueur, fonds suffisants…)
 * puis les applique. Un joueur ne peut donc pas modifier une autre bourse que par
 * une opération autorisée.
 */

import { SOCKET, MintError, t } from "./constants.js";

const handlers = new Map();
const pending = new Map();
const TIMEOUT = 15000;

/** Enregistre une opération exécutée côté MJ : fn(data, user) → résultat. */
export function registerHandler(name, fn) {
  handlers.set(name, fn);
}

function isActiveGM() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

async function run(action, data, userId) {
  const fn = handlers.get(action);
  if (!fn) throw new MintError("UnknownAction", { action });
  const user = game.users.get(userId);
  if (!user) throw new MintError("NoUser");
  return fn(data ?? {}, user);
}

export function initSocket() {
  game.socket.on(SOCKET, async (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "request" && isActiveGM()) {
      let reply;
      try {
        reply = { ok: true, result: await run(msg.action, msg.data, msg.userId) };
      } catch (err) {
        if (!(err instanceof MintError)) console.error("Mint |", err);
        reply = { ok: false, key: err?.key ?? "Unexpected", data: err?.data ?? {} };
      }
      game.socket.emit(SOCKET, { type: "response", id: msg.id, to: msg.userId, ...reply });
      return;
    }

    if (msg.type === "response" && msg.to === game.user.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new MintError(msg.key, msg.data));
      return;
    }

    if (msg.type === "notify" && msg.users?.includes(game.user.id)) {
      ui.notifications.info(t(msg.key, msg.data ?? {}));
    }
  });
}

/** Exécute une opération sur le client du MJ actif (directement si on est ce MJ). */
export async function gmCall(action, data) {
  if (game.user.isGM && (isActiveGM() || !game.users.activeGM)) return run(action, data, game.user.id);
  if (!game.users.activeGM) throw new MintError("NoGM");
  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new MintError("Timeout"));
    }, TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    game.socket.emit(SOCKET, { type: "request", id, action, data, userId: game.user.id });
  });
}

/** Message d'information affiché à certains utilisateurs (clé de traduction MINT.*). */
export function notifyUsers(userIds, key, data = {}) {
  const users = [...new Set(userIds)].filter(Boolean);
  if (!users.length) return;
  if (users.includes(game.user.id)) ui.notifications.info(t(key, data));
  game.socket.emit(SOCKET, { type: "notify", users, key, data });
}
