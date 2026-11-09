// Utilidades de fecha en español para la app de asistencia.

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isClassDay(ymd: string): boolean {
  const d = parseYMD(ymd);
  const w = d.getDay(); // 0..6
  return w === 2 || w === 4; // martes o jueves
}

export function formatLongDate(ymd: string): string {
  const d = parseYMD(ymd);
  return `${capitalize(WEEKDAYS[d.getDay()])}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function formatShortDate(ymd: string): string {
  const d = parseYMD(ymd);
  const w = WEEKDAYS[d.getDay()].slice(0, 3);
  return `${capitalize(w)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function monthLabel(year: number, month: number): string {
  return `${capitalize(MONTHS[month - 1])} ${year}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Meses del curso: Oct 2026 - Jun 2027
export const COURSE_MONTHS: { year: number; month: number }[] = [
  { year: 2026, month: 10 },
  { year: 2026, month: 11 },
  { year: 2026, month: 12 },
  { year: 2027, month: 1 },
  { year: 2027, month: 2 },
  { year: 2027, month: 3 },
  { year: 2027, month: 4 },
  { year: 2027, month: 5 },
  { year: 2027, month: 6 },
];

// Día de clase por defecto: hoy si es clase, si no el último día de clase pasado, o el primero del curso.
export function defaultClassDay(days: string[]): string | undefined {
  if (days.length === 0) return undefined;
  const t = todayYMD();
  const past = days.filter((d) => d <= t);
  return past.length ? past[past.length - 1] : days[0];
}

export function currentCourseMonth(): { year: number; month: number } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const match = COURSE_MONTHS.find((x) => x.year === y && x.month === m);
  return match ?? COURSE_MONTHS[0];
}
