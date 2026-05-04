import type { DayOfWeek, HHmm, IsoDate, Requirement } from './types';

export function toIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIso(s: IsoDate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function startOfWeek(d: Date): Date {
  const c = new Date(d);
  c.setDate(c.getDate() - c.getDay());
  c.setHours(0, 0, 0, 0);
  return c;
}

export function minutesFromHHmm(s: HHmm): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function hhmmFromMinutes(min: number): HHmm {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function dateInRange(d: IsoDate, req: Requirement): boolean {
  if (!req.startDate || !req.endDate) return false;
  return d >= req.startDate && d <= req.endDate;
}

export function isRequirementDay(d: Date, req: Requirement): boolean {
  const iso = toIso(d);
  if (!dateInRange(iso, req)) return false;
  return req.daysOfWeek.includes(d.getDay() as DayOfWeek);
}

export function expandRequirementSlots(req: Requirement): {
  date: IsoDate;
  start: HHmm;
  end: HHmm;
}[] {
  const out: { date: IsoDate; start: HHmm; end: HHmm }[] = [];
  if (!req.startDate || !req.endDate) return out;
  const startMin = minutesFromHHmm(req.startTime);
  const endMin = minutesFromHHmm(req.endTime);
  if (endMin <= startMin || req.durationMin <= 0) return out;

  const start = fromIso(req.startDate);
  const end = fromIso(req.endDate);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (!req.daysOfWeek.includes(d.getDay() as DayOfWeek)) continue;
    const iso = toIso(d);
    for (let m = startMin; m + req.durationMin <= endMin; m += req.durationMin) {
      out.push({
        date: iso,
        start: hhmmFromMinutes(m),
        end: hhmmFromMinutes(m + req.durationMin),
      });
    }
  }
  for (const s of req.explicitSlots) {
    if (s.date && s.start && s.end) {
      out.push({ date: s.date, start: s.start, end: s.end });
    }
  }
  return out;
}

export function slotKey(date: IsoDate, start: HHmm): string {
  return `${date}T${start}`;
}
