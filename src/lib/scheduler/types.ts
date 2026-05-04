export type IsoDate = string; // 'YYYY-MM-DD'
export type HHmm = string;     // 'HH:mm'

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Requirement = {
  startDate: IsoDate;
  endDate: IsoDate;
  startTime: HHmm;
  endTime: HHmm;
  durationMin: number;
  daysOfWeek: DayOfWeek[];
  explicitSlots: ExplicitSlot[];
};

export type ExplicitSlot = {
  id: string;
  date: IsoDate;
  start: HHmm;
  end: HHmm;
};

export type Attendee = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  note?: string;
  customFields?: Record<string, string>;
};

export type ConfirmedSlot = {
  id: string;
  attendeeId: string;
  date: IsoDate;
  start: HHmm;
  end: HHmm;
};

export type CalendarMode = 'month' | 'week' | 'day';

export const DEFAULT_REQUIREMENT: Requirement = {
  startDate: '',
  endDate: '',
  startTime: '10:00',
  endTime: '18:00',
  durationMin: 60,
  daysOfWeek: [1, 2, 3, 4, 5],
  explicitSlots: [],
};
