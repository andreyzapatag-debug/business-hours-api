// src/lib/business.ts
/* eslint-disable @typescript-eslint/no-var-requires */
const fetch = require("node-fetch");
const { DateTime, Duration } = require("luxon");

export type HolidaysSet = Set<string>; // YYYY-MM-DD

export interface HolidayCache {
  ts: number;
  holidays: HolidaysSet;
}

const HOLIDAYS_URL = "https://content.capta.co/Recruitment/WorkingDays.json";
const COLOMBIA_ZONE = "America/Bogota";
const WORK_START_HOUR = 8;   // 08:00
const LUNCH_START_HOUR = 12; // 12:00
const LUNCH_END_HOUR = 13;   // 13:00
const WORK_END_HOUR = 17;    // 17:00

// Cache holidays for some minutes to avoid repeated fetches
let holidayCache: HolidayCache | null = null;
const HOLIDAY_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

// --- Fetch and parse holidays
export async function fetchHolidays(): Promise<HolidaysSet> {
  const now = Date.now();
  if (holidayCache && (now - holidayCache.ts) < HOLIDAY_CACHE_TTL_MS) {
    return holidayCache.holidays;
  }

  const res = await fetch(HOLIDAYS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch holidays: ${res.status}`);
  }
  const json: unknown = await res.json();

  const out: HolidaysSet = new Set<string>();

  // support multiple JSON shapes: array of strings, array of { date }, or object containing arrays
  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === "string") {
        out.add(item.split("T")[0]);
      } else if (item && typeof item === "object") {
        if (typeof (item as any).date === "string") out.add(((item as any).date as string).split("T")[0]);
        else if (typeof (item as any).fecha === "string") out.add(((item as any).fecha as string).split("T")[0]);
      }
    }
  } else if (json && typeof json === "object") {
    // search nested arrays
    const obj = json as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") out.add(item.split("T")[0]);
          else if (item && typeof item === "object") {
            if (typeof (item as any).date === "string") out.add(((item as any).date as string).split("T")[0]);
            else if (typeof (item as any).fecha === "string") out.add(((item as any).fecha as string).split("T")[0]);
          }
        }
      }
    }
  }

  // fallback: if empty, still set cache to avoid hammering
  holidayCache = { ts: now, holidays: out };
  return out;
}

// --- Helpers typed with Luxon DateTime
export function isWeekend(dt: typeof DateTime.prototype): boolean {
  // weekday: 1 = Monday, 7 = Sunday
  return (dt.weekday === 6 || dt.weekday === 7);
}

export function toYMD(dt: typeof DateTime.prototype): string {
  return dt.toISODate(); // YYYY-MM-DD
}

/**
 * isWorkingDay - Monday-Friday and not in holidays set
 */
export function isWorkingDay(dt: typeof DateTime.prototype, holidays: HolidaysSet): boolean {
  if (isWeekend(dt)) return false;
  const ymd = toYMD(dt);
  return !holidays.has(ymd);
}

/**
 * normalizeBackwardToWorkingSlot
 * If dt is outside working hours or not a working day, approximate backward to last valid working instant.
 * Rules (per spec):
 *  - If weekend/holiday -> go back to previous working day at WORK_END_HOUR (17:00)
 *  - If before WORK_START_HOUR -> go back to previous working day at 17:00
 *  - If in lunch (12:00-13:00) -> set to 12:00
 *  - If after WORK_END_HOUR -> set to 17:00 same day
 */
export function normalizeBackwardToWorkingSlot(dtIn: typeof DateTime.prototype, holidays: HolidaysSet): typeof DateTime.prototype {
  let dt = dtIn;

  // If not a working day, move backward day-by-day to previous working day and set to 17:00
  if (!isWorkingDay(dt, holidays)) {
    do {
      dt = dt.minus({ days: 1 }).set({ hour: WORK_END_HOUR, minute: 0, second: 0, millisecond: 0 });
    } while (!isWorkingDay(dt, holidays));
    return dt;
  }

  const hour = dt.hour + dt.minute / 60 + dt.second / 3600;

  // In lunch -> set to lunch start (12:00)
  if (hour >= LUNCH_START_HOUR && hour < LUNCH_END_HOUR) {
    return dt.set({ hour: LUNCH_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  }

  // After work -> set to 17:00 same day
  if (hour >= WORK_END_HOUR) {
    return dt.set({ hour: WORK_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }

  // Before work -> go to previous working day 17:00
  if (hour < WORK_START_HOUR) {
    let prev = dt.minus({ days: 1 });
    while (!isWorkingDay(prev, holidays)) {
      prev = prev.minus({ days: 1 });
    }
    return prev.set({ hour: WORK_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }

  // otherwise in working segment -> return dt as is
  return dt;
}

/**
 * addBusinessDays
 * Add n business days, preserving time-of-day.
 */
export function addBusinessDays(start: typeof DateTime.prototype, days: number, holidays: HolidaysSet): typeof DateTime.prototype {
  if (days <= 0) return start;
  let dt = start;
  let remaining = days;
  while (remaining > 0) {
    dt = dt.plus({ days: 1 });
    while (!isWorkingDay(dt, holidays)) {
      dt = dt.plus({ days: 1 });
    }
    remaining--;
  }
  return dt;
}

/**
 * addBusinessHours
 * Add hours respecting business segments: 08:00-12:00 and 13:00-17:00.
 * hours may be fractional (e.g. 1.5 hours).
 */
export function addBusinessHours(start: typeof DateTime.prototype, hours: number, holidays: HolidaysSet): typeof DateTime.prototype {
  if (hours <= 0) return start;
  let dt = start;
  let remaining = hours;

  while (remaining > 0) {
    // Ensure dt is on a working day/time (but note dt expected to be normalized already)
    if (!isWorkingDay(dt, holidays)) {
      // move to next working day at 08:00
      dt = dt.plus({ days: 1 }).set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
      while (!isWorkingDay(dt, holidays)) {
        dt = dt.plus({ days: 1 });
      }
      dt = dt.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
      continue;
    }

    const h = dt.hour + dt.minute / 60 + dt.second / 3600;

    // before working start -> move to 08:00
    if (h < WORK_START_HOUR) {
      dt = dt.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
      continue;
    }

    // in lunch -> skip to 13:00
    if (h >= LUNCH_START_HOUR && h < LUNCH_END_HOUR) {
      dt = dt.set({ hour: LUNCH_END_HOUR, minute: 0, second: 0, millisecond: 0 });
      continue;
    }

    // after end -> next working day 08:00
    if (h >= WORK_END_HOUR) {
      dt = dt.plus({ days: 1 });
      while (!isWorkingDay(dt, holidays)) dt = dt.plus({ days: 1 });
      dt = dt.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 });
      continue;
    }

    // determine segment end
    let segmentEnd = (h >= WORK_START_HOUR && h < LUNCH_START_HOUR) ? LUNCH_START_HOUR : WORK_END_HOUR;
    const available = segmentEnd - h; // hours available in this segment (fractional)

    const take = Math.min(available, remaining);
    // add `take` hours to dt
    const minutesToAdd = Math.round(take * 60);
    dt = dt.plus({ minutes: minutesToAdd });
    remaining -= take;

    // loop continues (if remaining > 0 we'll shift segments/days)
  }

  return dt;
}

/**
 * Public function: computeBusinessDate
 * Accepts startUtcIso: string | null (if null, uses now in Colombia)
 * days: integer >= 0
 * hours: integer >= 0 (can be 0)
 *
 * Returns DateTime (UTC) final.
 */
export async function computeBusinessDate(
  startUtcIso: string | null,
  days: number,
  hours: number
): Promise<typeof DateTime.prototype> {
  const holidays = await fetchHolidays();

  // Determine start in Colombia zone
  let startCol: typeof DateTime.prototype;
  if (startUtcIso) {
    const parsed = DateTime.fromISO(startUtcIso, { zone: "utc" });
    if (!parsed.isValid) throw new Error("InvalidDate");
    startCol = parsed.setZone(COLOMBIA_ZONE);
  } else {
    startCol = DateTime.now().setZone(COLOMBIA_ZONE);
  }

  // Normalize backward if needed
  const normalized = normalizeBackwardToWorkingSlot(startCol, holidays);

  // Apply days then hours
  let afterDays = normalized;
  if (days > 0) {
    afterDays = addBusinessDays(normalized, days, holidays);
  }

  let afterHours = afterDays;
  if (hours > 0) {
    afterHours = addBusinessHours(afterDays, hours, holidays);
  }

  // Convert to UTC and return
  return afterHours.setZone("utc");
}
