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

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export const DEFAULT_WHATSAPP_TIME_ZONE = "America/Argentina/Tucuman";

export type EventDateRange = {
  from: string;
  to: string;
};

type ParsedDate = EventDateRange & { hasYear: boolean };

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

function sameRange(left: EventDateRange, right: EventDateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

function range(from: string, to = from): EventDateRange | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) return null;
  return { from, to };
}

function weekRange(value: string, offset = 0): EventDateRange {
  const weekday = dateParts(new Date(`${value}T12:00:00Z`), "UTC").weekday;
  const monday = addDays(value, -(weekday === 0 ? 6 : weekday - 1) + offset * 7);
  return { from: monday, to: addDays(monday, 6) };
}

function monthRange(value: string, offset = 0): EventDateRange {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const from = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return { from, to: addDays(date.toISOString().slice(0, 10), -1) };
}

function dateFromDayAndMonth(day: number, month: number, year: number): string | null {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(value) ? value : null;
}

function parseExplicitDate(value: string, fallbackYear: number): ParsedDate | null {
  const normalized = normalizeText(value).trim();
  const iso = normalized.match(/^(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (iso) {
    const date = dateFromDayAndMonth(Number(iso[3]), Number(iso[2]), Number(iso[1]));
    return date ? { from: date, to: date, hasYear: true } : null;
  }

  const numeric = normalized.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (numeric) {
    const hasYear = Boolean(numeric[3]);
    const parsedYear = numeric[3] ? Number(numeric[3]) : fallbackYear;
    const year = parsedYear < 100 ? 2000 + parsedYear : parsedYear;
    const date = dateFromDayAndMonth(Number(numeric[1]), Number(numeric[2]), year);
    return date ? { from: date, to: date, hasYear } : null;
  }

  const named = normalized.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{2,4}))?$/);
  if (!named) return null;
  const month = SPANISH_MONTHS[named[2]];
  if (!month) return null;
  const hasYear = Boolean(named[3]);
  const parsedYear = named[3] ? Number(named[3]) : fallbackYear;
  const year = parsedYear < 100 ? 2000 + parsedYear : parsedYear;
  const date = dateFromDayAndMonth(Number(named[1]), month, year);
  return date ? { from: date, to: date, hasYear } : null;
}

function explicitDates(text: string, fallbackYear: number): ParsedDate[] {
  const matches: Array<{ index: number; value: string }> = [];
  const addMatches = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      if (match.index !== undefined) matches.push({ index: match.index, value: match[0] });
    }
  };
  addMatches(/\b20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}\b/g);
  addMatches(/(?<![\d-])\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g);
  addMatches(new RegExp(`\\b\\d{1,2}\\s+(?:de\\s+)?(?:${Object.keys(SPANISH_MONTHS).join("|")})(?:\\s+(?:de\\s+)?\\d{2,4})?\\b`, "g"));
  return matches
    .sort((left, right) => left.index - right.index)
    .map(({ value }) => parseExplicitDate(value, fallbackYear))
    .filter((parsed): parsed is ParsedDate => parsed !== null);
}

function nextOccurrenceOfWeekday(value: string, target: number): string {
  const today = dateParts(new Date(`${value}T12:00:00Z`), "UTC");
  return addDays(value, (target - today.weekday + 7) % 7 || 7);
}

function weekdayInRange(eventRange: EventDateRange, target: number): string | null {
  let value = eventRange.from;
  for (let index = 0; index <= 370 && value <= eventRange.to; index += 1) {
    if (dateParts(new Date(`${value}T12:00:00Z`), "UTC").weekday === target) return value;
    value = addDays(value, 1);
  }
  return null;
}

export function currentDateInTimeZone(now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): string {
  return dateParts(now, timeZone).iso;
}

export function resolveNaturalDate(text: string, now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): string | null {
  const normalized = normalizeText(text);
  const today = dateParts(now, timeZone);

  const firstExplicit = explicitDates(normalized, Number(today.iso.slice(0, 4)))[0];
  if (firstExplicit) {
    let date = firstExplicit.from;
    if (!firstExplicit.hasYear && date < today.iso) date = dateFromDayAndMonth(Number(date.slice(8, 10)), Number(date.slice(5, 7)), Number(today.iso.slice(0, 4)) + 1) ?? date;
    return date;
  }

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

export function resolveEventDateRange(
  text: string,
  now = new Date(),
  timeZone = DEFAULT_WHATSAPP_TIME_ZONE,
  previousRange?: EventDateRange,
): EventDateRange | null {
  const normalized = normalizeText(text);
  const today = dateParts(now, timeZone);
  const year = Number(today.iso.slice(0, 4));
  const monthNames = Object.keys(SPANISH_MONTHS).join("|");

  const namedRange = normalized.match(new RegExp(`\\b(?:del|desde|entre)?\\s*(?:el\\s+)?(\\d{1,2})\\s*(?:al|hasta|a|y)\\s*(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+(?:de\\s+)?(\\d{2,4}))?\\b`));
  if (namedRange) {
    const parsedYear = namedRange[4] ? Number(namedRange[4]) : year;
    const rangeYear = parsedYear < 100 ? 2000 + parsedYear : parsedYear;
    const from = dateFromDayAndMonth(Number(namedRange[1]), SPANISH_MONTHS[namedRange[3]], rangeYear);
    const to = dateFromDayAndMonth(Number(namedRange[2]), SPANISH_MONTHS[namedRange[3]], rangeYear);
    if (from && to) return range(from, to);
  }

  const dayRange = normalized.match(/\b(?:del|desde|entre)?\s*(?:el\s+)?(\d{1,2})\s*(?:al|hasta|a|y)\s*(?:el\s+)?(\d{1,2})\b/);
  if (dayRange) {
    const from = dateFromDayAndMonth(Number(dayRange[1]), Number(today.iso.slice(5, 7)), year);
    const to = dateFromDayAndMonth(Number(dayRange[2]), Number(today.iso.slice(5, 7)), year);
    if (from && to) return range(from, to) ?? range(to, from);
  }

  const parsedDates = explicitDates(normalized, year);
  if (parsedDates.length >= 2 && (/\b(?:al|hasta|a|y)\b/.test(normalized) || /\s[-–—]\s/.test(normalized))) {
    const from = parsedDates[0].from;
    const to = parsedDates[1].from;
    return range(from, to) ?? range(to, from);
  }
  if (parsedDates.length === 1) {
    let date = parsedDates[0].from;
    if (!parsedDates[0].hasYear && date < today.iso) {
      date = dateFromDayAndMonth(Number(date.slice(8, 10)), Number(date.slice(5, 7)), year + 1) ?? date;
    }
    return range(date);
  }

  if (/\b(?:esta semana|semana actual)\b/.test(normalized)) return weekRange(today.iso);
  if (/\b(?:la semana que viene|semana que viene|la proxima semana|proxima semana|semana proxima|la que viene)\b/.test(normalized)) return weekRange(today.iso, 1);
  if (/\b(?:la semana pasada|semana pasada|semana anterior)\b/.test(normalized)) return weekRange(today.iso, -1);

  if (/\b(?:este mes|mes actual)\b/.test(normalized)) return monthRange(today.iso);
  if (/\b(?:el mes que viene|mes que viene|el proximo mes|proximo mes)\b/.test(normalized)) return monthRange(today.iso, 1);
  if (/\b(?:el mes pasado|mes pasado|mes anterior)\b/.test(normalized)) return monthRange(today.iso, -1);

  const monthOnly = normalized.match(new RegExp(`\\b(?:en|durante|de)?\\s*(${monthNames})\\b`));
  if (monthOnly) {
    const month = SPANISH_MONTHS[monthOnly[1]];
    return monthRange(`${year}-${String(month).padStart(2, "0")}-01`);
  }

  if (previousRange) {
    const weekday = normalized.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/)?.[1];
    if (weekday) {
      const date = weekdayInRange(previousRange, SPANISH_WEEKDAYS[weekday]);
      if (date) return range(date);
    }
    if (/\bpasado manana\b/.test(normalized)) {
      const date = addDays(today.iso, 2);
      if (date >= previousRange.from && date <= previousRange.to) return range(date);
    }
    if (/\bmanana\b/.test(normalized)) {
      const date = addDays(today.iso, 1);
      if (date >= previousRange.from && date <= previousRange.to) return range(date);
    }
    if (/\bhoy\b/.test(normalized) && today.iso >= previousRange.from && today.iso <= previousRange.to) return range(today.iso);
    if (/\b(?:y|pero|tambien|ademas|entonces)\b/.test(normalized)) return previousRange;
  }

  if (/\bpasado manana\b/.test(normalized)) return range(addDays(today.iso, 2));
  if (/\bmanana\b/.test(normalized)) return range(addDays(today.iso, 1));
  if (/\bhoy\b/.test(normalized)) return range(today.iso);

  const weekday = normalized.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/)?.[1];
  if (weekday) return range(nextOccurrenceOfWeekday(today.iso, SPANISH_WEEKDAYS[weekday]));

  return null;
}

export function describeEventDateRange(eventRange: EventDateRange, now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): string {
  const today = currentDateInTimeZone(now, timeZone);
  if (sameRange(eventRange, weekRange(today))) return "esta semana";
  if (sameRange(eventRange, weekRange(today, 1))) return "la semana que viene";
  if (sameRange(eventRange, monthRange(today))) return "este mes";
  if (sameRange(eventRange, monthRange(today, 1))) return "el mes que viene";
  return eventRange.from === eventRange.to ? eventRange.from : `${eventRange.from} al ${eventRange.to}`;
}

export function isDateInCurrentWeek(value: string, now = new Date(), timeZone = DEFAULT_WHATSAPP_TIME_ZONE): boolean {
  const currentWeek = weekRange(currentDateInTimeZone(now, timeZone));
  return isValidIsoDate(value) && value >= currentWeek.from && value <= currentWeek.to;
}
