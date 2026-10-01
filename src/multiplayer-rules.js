// First/Last tokens are assigned by the server; last-pick discard exemption
// also applies in round one, when the physical tokens are not used.
export function selectionAdjustment(selection, skip = false) {
  const penalty = skip && !selection.freeDiscard ? 2 : 0;
  const firstFee = selection.first ? 1 : 0;
  const lastBonus = selection.last && !skip ? 1 : 0;
  return {penalty, firstFee, lastBonus, total:lastBonus-firstFee-penalty};
}
