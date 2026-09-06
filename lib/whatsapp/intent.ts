function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const EVENT_READ_STOP_WORDS = new Set([
  "al",
  "busca",
  "buscame",
  "buscar",
  "calendario",
  "como",
  "con",
  "de",
  "del",
  "desde",
  "fecha",
  "fechas",
  "el",
  "en",
  "entre",
  "esta",
  "este",
  "dame",
  "eventos",
  "evento",
  "hay",
  "hoy",
  "la",
  "las",
  "lista",
  "listar",
  "los",
  "manana",
  "mes",
  "mis",
  "mostrame",
  "mostrar",
  "pasado",
  "para",
  "pero",
  "por",
  "proxima",
  "proximo",
  "proximas",
  "proximos",
  "que",
  "semana",
  "si",
  "tengo",
  "tambien",
  "entonces",
  "una",
  "un",
  "ver",
  "y",
  "viene",
  "hasta",
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  ...Object.keys({ enero: 1, febrero: 1, marzo: 1, abril: 1, mayo: 1, junio: 1, julio: 1, agosto: 1, septiembre: 1, setiembre: 1, octubre: 1, noviembre: 1, diciembre: 1 }),
]);

export function extractEventSearchQuery(text: string): string | undefined {
  const tokens = normalizeText(text).match(/[a-z0-9áéíóúüñ]+/g) ?? [];
  const query = tokens.filter((token) => !EVENT_READ_STOP_WORDS.has(token) && !/^\d+$/.test(token)).join(" ");
  return query || undefined;
}

export function isFallbackText(text: string): boolean {
  return /^(?:[¿?!.…]+)$/.test(text.trim());
}
