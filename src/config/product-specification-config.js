export const PRODUCT_SPECIFICATION_SOURCE = Object.freeze({
  spreadsheetId: "1BCfwR8P2UqjlbnDyrEp95n2AmbQpx0N4SDZV540GpA8",
  sheetName: "Для фасовки",
  title: "Спецификации продуктов"
});

// Only a visual fallback for the safe demo mode. The gateway always loads the full Google source.
export const DEMO_PRODUCT_SPECIFICATIONS = Object.freeze([
  ["Extreme Edition", "Extreme Freeze", 70, 11.8, null, null, "сух.", 27, "Ч/ДЗ", "П/Кил"],
  ["Extreme Edition", "Extreme Strong", 60, 11, 15.4, 4.4, "мокр.", 22, "Ч/ДЗ", "П/Кил"],
  ["Standart", "Ice Cool", 35, 11.8, null, null, "сух.", 27, "Ч/ДЗ", "П/Кил"],
  ["Prime Collection", "Extreme", 15.5, 11, 15.4, 4.4, "мокр.", 22, "Б/ДЗ", "П/ДЗ"],
  ["MINI", "Mini Extreme", 50, 11.8, 13.5, 1.7, "мокр.", 35, "Ч/ДЗ", "П/Кил"],
  ["Finland", "Gold Mint", 16.5, 11, 15.4, 4.4, "мокр.", 22, "З/ДЗ", "З/ДЗ"]
].map((row, index) => Object.freeze({
  id: `demo-spec-${index + 1}`,
  line: row[0], product: row[1], variant: row[2], dryMass: row[3], wetMass: row[4], liquidVolume: row[5], processType: row[6], pouchCount: row[7], lidColor: row[8], canType: row[9]
})));
