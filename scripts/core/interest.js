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

/** Date d'échéance (temps du monde, en secondes), ou null si la dette n'en a pas. */
export function dueTime(debt, secondsPerDay = 86400) {
  const days = Number(debt.dueDays);
  return days > 0 ? (debt.start ?? 0) + days * secondsPerDay : null;
}

/** La dette est-elle en retard ? */
export function isOverdue(debt, now, secondsPerDay = 86400) {
  const due = dueTime(debt, secondsPerDay);
  return due !== null && now > due;
}

/** Pénalité de retard : un pourcentage du capital, appliqué une fois l'échéance passée. */
export function lateFee(debt, now, secondsPerDay = 86400) {
  if (!isOverdue(debt, now, secondsPerDay)) return 0;
  return Math.round(Math.max(0, Number(debt.principal) || 0) * Math.max(0, Number(debt.lateFee) || 0) / 100);
}

/** Reste à payer (intérêts et pénalité de retard compris). */
export function amountOwed(debt, now, secondsPerDay = 86400) {
  const gross = amountDueGross(debt, now, secondsPerDay) + lateFee(debt, now, secondsPerDay);
  return Math.max(0, gross - (Number(debt.repaid) || 0));
}

/** Jours restants avant l'échéance (négatif = jours de retard), ou null sans échéance. */
export function daysUntilDue(debt, now, secondsPerDay = 86400) {
  const due = dueTime(debt, secondsPerDay);
  return due === null ? null : Math.ceil((due - now) / secondsPerDay);
}
