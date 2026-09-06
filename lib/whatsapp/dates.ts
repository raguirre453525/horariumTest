const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const SPANISH_WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

export const DEFAULT_WHATSAPP_TIME_ZONE = "America/Argentina/Tucuman";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    weekday: "long",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    iso: `${values.year}-${values.month}-${values.day}`,
    weekday: WEEKDAY_INDEX[(values.weekday ?? "Sunday").toLowerCase()] ?? 0,
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromDayAndMonth(day: number, month: number, year: number): string | null {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(value) ? value : null;
}

export function currentDateInTimeZone(now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): string {
  return dateParts(now, timeZone).iso;
}

export function resolveNaturalDate(text: string, now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): string | null {
  const normalized = normalizeText(text);
  const today = dateParts(now, timeZone);

  const iso = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso && isValidIsoDate(iso)) return iso;

  if (/\bpasado manana\b/.test(normalized)) return addDays(today.iso, 2);
  if (/\bmanana\b/.test(normalized)) return addDays(today.iso, 1);
  if (/\bhoy\b/.test(normalized)) return today.iso;

  const weekday = normalized.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/)?.[1];
  if (weekday) {
    const target = SPANISH_WEEKDAYS[weekday];
    const distance = (target - today.weekday + 7) % 7 || 7;
    return addDays(today.iso, distance);
  }

  const numeric = normalized.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const parsedYear = numeric[3] ? Number(numeric[3]) : Number(today.iso.slice(0, 4));
    const year = parsedYear < 100 ? 2000 + parsedYear : parsedYear;
    const sameYear = dateFromDayAndMonth(day, month, year);
    if (!sameYear) return null;
    return sameYear < today.iso && !numeric[3] ? dateFromDayAndMonth(day, month, year + 1) : sameYear;
  }

  return null;
}

export function isDateInCurrentWeek(value: string, now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): boolean {
  if (!isValidIsoDate(value)) return false;
  const today = dateParts(now, timeZone);
  const monday = addDays(today.iso, -(today.weekday === 0 ? 6 : today.weekday - 1));
  return value >= monday && value <= addDays(monday, 6);
}
