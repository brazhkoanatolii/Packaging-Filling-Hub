const runtimeConfig = globalThis.__PACKAGING_FILLING_CONFIG__ ?? {};

export const APP_CONFIG = Object.freeze({
  name: "Packaging-Filling-Hub",
  version: "0.7.1",
  locale: "ru-RU",
  timeZone: "Europe/Vilnius",
  refreshIntervalMs: 60_000,
  workstationRole: ["manager", "senior"].includes(runtimeConfig.workstationRole)
    ? runtimeConfig.workstationRole
    : null,
  workstationId: typeof runtimeConfig.workstationId === "string"
    ? runtimeConfig.workstationId
    : null,
  workstationLabel: typeof runtimeConfig.workstationLabel === "string"
    ? runtimeConfig.workstationLabel
    : null,
  integration: {
    mode: runtimeConfig.mode === "gateway" ? "gateway" : "demo",
    googleWritesEnabled: runtimeConfig.googleWritesEnabled === true,
    gatewayBaseUrl: runtimeConfig.gatewayBaseUrl ?? "",
    spreadsheetId: "1An019JRwrya4wl9EtqY4zNELfRNzaq26sidhQce3Tc8",
    sheetId: 1257425673,
    sheetName: "Контроль 50г"
  }
});

export const LANGUAGES = Object.freeze([
  Object.freeze({ code: "ru", label: "RU", locale: "ru-RU", name: "Русский" }),
  Object.freeze({ code: "en", label: "EN", locale: "en-GB", name: "English" }),
  Object.freeze({ code: "lt", label: "LT", locale: "lt-LT", name: "Lietuvių" })
]);

export const MODULES = Object.freeze([
  { id: "dashboard", labels: { ru: "Главная", en: "Home", lt: "Pagrindinis" }, icon: "home" },
  { id: "attendance", labels: { ru: "Табель", en: "Attendance", lt: "Darbo laikas" }, icon: "attendance" },
  { id: "journals", labels: { ru: "Контроль весов", en: "Scale control", lt: "Svarstyklių kontrolė" }, icon: "scales" },
  { id: "packaging", labels: { ru: "Расход упаковки", en: "Packaging usage", lt: "Pakuotės sunaudojimas" }, icon: "package" },
  { id: "maintenance", labels: { ru: "Ремонт и ТО станков", en: "Machine maintenance", lt: "Įrenginių priežiūra" }, icon: "tools" },
  { id: "nonconformities", labels: { ru: "Несоответствия", en: "Nonconformities", lt: "Neatitiktys" }, icon: "alert" },
  { id: "specifications", labels: { ru: "Спецификация продуктов", en: "Product specifications", lt: "Produktų specifikacijos" }, icon: "specification" },
  { id: "production", labels: { ru: "Учёт продукции и брака", en: "Production and scrap", lt: "Produkcija ir brokas" }, icon: "production" },
  { id: "spare-parts", labels: { ru: "Склад запчастей", en: "Spare parts", lt: "Atsarginių dalių sandėlis" }, icon: "warehouse" },
  { id: "ppe-warehouse", labels: { ru: "Склад СИЗ", en: "PPE warehouse", lt: "AAP sandėlis" }, icon: "ppe" },
  { id: "cyclones", labels: { ru: "Очистка циклонов", en: "Cyclone cleaning", lt: "Ciklonų valymas" }, icon: "cyclone" },
  { id: "documents", labels: { ru: "Документы", en: "Documents", lt: "Dokumentai" }, icon: "documents" },
  { id: "personnel", labels: { ru: "Персонал", en: "Personnel", lt: "Personalas" }, icon: "personnel" },
  { id: "vacations", labels: { ru: "График отпусков", en: "Vacation schedule", lt: "Atostogų grafikas" }, icon: "vacation" },
  { id: "statistics", labels: { ru: "Статистика", en: "Statistics", lt: "Statistika" }, icon: "statistics", managerOnly: true },
  { id: "settings", labels: { ru: "Настройки", en: "Settings", lt: "Nustatymai" }, icon: "settings", managerOnly: true }
].map(module => Object.freeze(module)));

export const ACCOUNTS = Object.freeze([
  {
    id: "manager",
    role: "manager",
    title: "Начальник участка",
    description: "Все журналы, настройки, сотрудники и права доступа"
  },
  {
    id: "senior-mechanic",
    role: "senior",
    title: "Старший механик",
    description: "Работа со сменой и разрешёнными журналами"
  }
]);

export const SCALES = Object.freeze(Array.from({ length: 13 }, (_, index) => {
  const number = index + 1;
  return Object.freeze({
    id: `scale-f${number}`,
    code: `F${number}`,
    manufacturer: "Radwag",
    model: "WTC 600",
    name: `WTC 600 (F${number})`
  });
}));

export const JOURNALS = Object.freeze([
  {
    id: "scale-check-50g",
    title: "Контроль весов 50 г",
    description: "Ежедневная проверка контрольной гирей 50 г",
    source: "Google Sheets",
    sheetName: "Контроль 50г",
    refreshSeconds: 60,
    permissions: ["manager", "senior"],
    scales: SCALES,
    scaleOptions: SCALES.map(scale => scale.name),
    nominal: 50,
    tolerance: 0.05
  }
]);
