/**
 * Intérêts des prêts, sans dépendance à Foundry.
 * Intérêts simples, calculés sur le capital à chaque période complète écoulée
 * (temps du monde de Foundry, en secondes).
 */

/** Nombre de périodes complètes écoulées depuis `start`. */
export function periodsElapsed(start, now, periodSeconds) {
  if (!(periodSeconds > 0)) return 0;
  return Math.max(0, Math.floor((now - start) / periodSeconds));
}

/** Total dû (capital + intérêts), avant remboursements. */
export function amountDueGross(debt, now, secondsPerDay = 86400) {
  const rate = Math.max(0, Number(debt.rate) || 0) / 100;
  const periods = periodsElapsed(debt.start ?? 0, now, (Number(debt.periodDays) || 0) * secondsPerDay);
  return Math.round(Math.max(0, Number(debt.principal) || 0) * (1 + rate * periods));
}

/** Reste à payer. */
export function amountOwed(debt, now, secondsPerDay = 86400) {
  return Math.max(0, amountDueGross(debt, now, secondsPerDay) - (Number(debt.repaid) || 0));
}
