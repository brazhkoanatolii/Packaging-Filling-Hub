export const PACKAGING_TARGET_RANGES = Object.freeze({
  rawMaterials: "'Расход сырья'!A3:D500",
  cans: "'Банки'!A4:K500"
});

export function packagingTargetValues(values = {}) {
  const amount = key => {
    const value = Number(values[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Некорректный итог расхода упаковки: ${key}`);
    return value;
  };
  return {
    rawMaterials: [amount("garantBox430"), amount("garantBox570"), amount("dochemsPaper")],
    cansPrimary: [amount("killaCanClear"), amount("killaCanGreen")],
    cansSecondary: [amount("killaLidGreen"), amount("dzCanClear"), amount("dzCanGreen"), amount("dzLidBlack"), amount("dzLidWhite"), amount("dzLidGreen")]
  };
}
