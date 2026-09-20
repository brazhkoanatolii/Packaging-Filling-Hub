export const ROLE_LABELS = Object.freeze({
  "head-of-area": "Начальник участка",
  "production-manager": "Начальник производства",
  administrator: "Администратор",
  "warehouse-manager": "Начальник склада",
  "senior-mechanic": "Старший механик",
  mechanic: "Механик",
  "mechanic-operator": "Механик-оператор",
  packer: "Упаковщик"
});

export const ATTENDANCE_CODES = Object.freeze([
  { value: "11", label: "На работе · полная смена", tone: "worked", isWork: true },
  { value: "A", label: "Ежегодный отпуск", tone: "vacation" },
  { value: "L", label: "Болезнь или травма", tone: "sick" },
  { value: "NS", label: "Уход за больным", tone: "sick" },
  { value: "N", label: "Неоплачиваемая нетрудоспособность", tone: "unpaid" },
  { value: "MA", label: "Оплачиваемый учебный отпуск", tone: "vacation" },
  { value: "NA", label: "Неоплачиваемый учебный отпуск", tone: "unpaid" },
  { value: "PA", label: "Неоплачиваемый отпуск", tone: "unpaid" },
  { value: "G", label: "Отпуск по беременности и родам", tone: "parental" },
  { value: "AV", label: "Уход за ребёнком до 1 года", tone: "parental" },
  { value: "PV", label: "Уход за ребёнком от 1 до 3 лет", tone: "parental" },
  { value: "M", label: "Дополнительный день отдыха", tone: "mother-day" },
  { value: "TN", label: "Мамин / папин день", tone: "mother-day" },
  { value: "D", label: "День донора", tone: "mother-day" },
  { value: "K", label: "Командировка", tone: "worked", isWork: true },
  { value: "SK", label: "Стажировка или повышение квалификации", tone: "mother-day" },
  { value: "VV", label: "Государственные или общественные обязанности", tone: "mother-day" },
  { value: "PB", label: "Прогул", tone: "unauthorized" },
  { value: "ND", label: "Отсутствие с разрешения администрации", tone: "unpaid" },
  { value: "NP", label: "Отсутствие по уважительной причине", tone: "unpaid" },
  { value: "NN", label: "Отстранение от работы", tone: "unpaid" }
]);

export const WORKFORCE_PERSONNEL = Object.freeze([
  ["employee-0001", "Albert Krevski", "mechanic", "shift-team-a"],
  ["employee-0002", "Vladislav Balašov", "senior-mechanic", "shift-team-a"],
  ["employee-0003", "Valdemar Stacino", "mechanic-operator", "shift-team-a"],
  ["employee-0004", "Bohdan Nevmerzhytskyi", "mechanic-operator", "shift-team-a"],
  ["employee-0005", "Jaroslav Jankovski", "mechanic-operator", "shift-team-a"],
  ["employee-0006", "Serhii Rybalka", "mechanic-operator", "shift-team-a"],
  ["employee-0007", "Volodymyr Nazarenko", "mechanic-operator", "shift-team-a"],
  ["employee-0008", "Ievhenii Bevz", "mechanic-operator", "shift-team-a"],
  ["employee-0009", "Hanna Khalypenko", "packer", "shift-team-a"],
  ["employee-0010", "Gražina Stankevič", "packer", "shift-team-a"],
  ["employee-0011", "Alina Macutkevič", "packer", "shift-team-a"],
  ["employee-0012", "Alicija Girčienė", "packer", "shift-team-a"],
  ["employee-0013", "Ilona Curikova", "packer", "shift-team-a"],
  ["employee-0014", "Karina Ivaškevičiūtė", "packer", "shift-team-a"],
  ["employee-0017", "Viktor Minin", "senior-mechanic", "shift-team-b"],
  ["employee-0019", "Maksim Tsikhenia", "mechanic-operator", "shift-team-b"],
  ["employee-0020", "Vitalii Paliienko", "mechanic", "shift-team-b"],
  ["employee-0021", "Rolandas Asanovas", "mechanic-operator", "shift-team-b"],
  ["employee-0022", "Serhii Serikov", "mechanic-operator", "shift-team-b"],
  ["employee-0023", "Roman Vasylets", "mechanic-operator", "shift-team-b"],
  ["employee-0024", "Oleksandr Varchenko", "mechanic-operator", "shift-team-b"],
  ["employee-0025", "Renata Kazlauskienė", "packer", "shift-team-b"],
  ["employee-0026", "Kamila Babič", "packer", "shift-team-b"],
  ["employee-0027", "Irena Jurevič", "packer", "shift-team-b"],
  ["employee-0028", "Anžela Butėnienė", "packer", "shift-team-b"],
  ["employee-0029", "Alina Andriushchenko", "packer", "shift-team-b"]
].map(([id, fullName, role, shiftTeamId, active = true]) => Object.freeze({ id, fullName, role, shiftTeamId, active })));

export const SHIFT_TEAMS = Object.freeze([
  Object.freeze({ id: "shift-team-a", code: "A", name: "Смена A", anchorDate: "2026-07-01", cycleLengthDays: 4, workDayOffsets: [0, 1], shiftDurationHours: 12, accountingHours: 11, active: true }),
  Object.freeze({ id: "shift-team-b", code: "B", name: "Смена B", anchorDate: "2026-07-03", cycleLengthDays: 4, workDayOffsets: [0, 1], shiftDurationHours: 12, accountingHours: 11, active: true })
]);

export const OFFICE_SCHEDULE = Object.freeze({
  id: "office",
  code: "5/2",
  name: "Администрация",
  shiftDurationHours: 8,
  accountingHours: 8
});

export const LITHUANIAN_HOLIDAYS = Object.freeze([
  [1, 1, "Новый год"], [2, 16, "День восстановления государства"], [3, 11, "День восстановления независимости"],
  [5, 1, "День труда"], [6, 24, "Йонинес"], [7, 6, "День государственности"], [8, 15, "Успение"],
  [11, 1, "День всех святых"], [11, 2, "День поминовения"], [12, 24, "Сочельник"], [12, 25, "Рождество"], [12, 26, "Второй день Рождества"]
].map(([month, day, name]) => Object.freeze({ month, day, name })));
