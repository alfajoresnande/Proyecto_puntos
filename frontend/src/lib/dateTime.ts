const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";

type DateLike = string | number | Date | null | undefined;

function parseDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatBuenosAiresDateTime(
  value: DateLike,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    ...options,
    timeZone: BUENOS_AIRES_TIME_ZONE,
  }).format(date);
}

export function formatBuenosAiresDate(
  value: DateLike,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  },
): string {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    ...options,
    timeZone: BUENOS_AIRES_TIME_ZONE,
  }).format(date);
}

export function getBuenosAiresDateStamp(value: DateLike = new Date()): string {
  const date = parseDate(value);
  if (!date) return "";

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUENOS_AIRES_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

export { BUENOS_AIRES_TIME_ZONE };
