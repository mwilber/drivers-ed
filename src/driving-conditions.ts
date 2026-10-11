export const TIMES_OF_DAY = ['day', 'dusk', 'night'] as const;
export type TimeOfDay = typeof TIMES_OF_DAY[number];
export interface DrivingConditions { timeOfDay: TimeOfDay }
export const DEFAULT_CONDITIONS: Readonly<DrivingConditions> = { timeOfDay: 'day' };

/** Lighting only in this increment: all three presets retain dry-road physics. */
export const LIGHTING = {
  day: { label: 'Day', sky: 0xc6dce3, skyLight: 0xe7f3ff, groundLight: 0x728357, ambient: 2.5, sunColor: 0xffefd5, sun: 3.1, sunHeight: 130, sunShadows: true },
  dusk: { label: 'Dusk', sky: 0x666d88, skyLight: 0xb4bddf, groundLight: 0x6b625b, ambient: 0.65, sunColor: 0xffb779, sun: 0.65, sunHeight: 35, sunShadows: true },
  night: { label: 'Night', sky: 0x101b2d, skyLight: 0x9baed5, groundLight: 0x586258, ambient: 0.2, sunColor: 0xb7caff, sun: 0.12, sunHeight: 130, sunShadows: false },
} as const;

export function loadConditions(serialized: string | null): DrivingConditions {
  try {
    const data = JSON.parse(serialized ?? 'null');
    if (data?.version === 1 && TIMES_OF_DAY.includes(data.conditions?.timeOfDay)) return { timeOfDay: data.conditions.timeOfDay };
  } catch { /* Corrupt or unavailable storage retains the daytime baseline. */ }
  return { ...DEFAULT_CONDITIONS };
}
export function serializeConditions(conditions: DrivingConditions): string {
  return JSON.stringify({ version: 1, conditions });
}

export function lightingGuidance(timeOfDay: TimeOfDay, headlights: boolean): string {
  return `${LIGHTING[timeOfDay].label} · dry roads${timeOfDay !== 'day' && !headlights ? ' · switch on headlights' : ''}`;
}
