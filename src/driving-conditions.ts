export const TIMES_OF_DAY = ['day', 'dusk', 'night'] as const;
export type TimeOfDay = typeof TIMES_OF_DAY[number];
export const WEATHER = ['dry', 'rain'] as const;
export type Weather = typeof WEATHER[number];
export const WIPERS = ['off', 'slow', 'fast'] as const;
export type WiperMode = typeof WIPERS[number];
export interface DrivingConditions { timeOfDay: TimeOfDay; weather: Weather; wipers: WiperMode }
export const DEFAULT_CONDITIONS: Readonly<DrivingConditions> = { timeOfDay: 'day', weather: 'dry', wipers: 'slow' };
/** Authored comparison values, not a real tire/weather calibration. */
export const RAIN = { grip: 0.55, fogNear: 25, fogFar: 125, trafficSpeed: 0.8, trafficHeadway: 1.4 } as const;
export function pavedGrip(weather: Weather): number { return weather === 'rain' ? RAIN.grip : 1; }

/** Time of day affects visibility; weather independently controls surface grip. */
export const LIGHTING = {
  day: { label: 'Day', sky: 0xc6dce3, skyLight: 0xe7f3ff, groundLight: 0x728357, ambient: 2.5, sunColor: 0xffefd5, sun: 3.1, sunHeight: 130, sunShadows: true },
  dusk: { label: 'Dusk', sky: 0x666d88, skyLight: 0xb4bddf, groundLight: 0x6b625b, ambient: 0.65, sunColor: 0xffb779, sun: 0.65, sunHeight: 35, sunShadows: true },
  night: { label: 'Night', sky: 0x101b2d, skyLight: 0x9baed5, groundLight: 0x586258, ambient: 0.2, sunColor: 0xb7caff, sun: 0.12, sunHeight: 130, sunShadows: false },
} as const;

export function loadConditions(serialized: string | null): DrivingConditions {
  try {
    const data = JSON.parse(serialized ?? 'null');
    const settings = data?.conditions;
    if (!TIMES_OF_DAY.includes(settings?.timeOfDay)) return { ...DEFAULT_CONDITIONS };
    if (data.version === 1) return { ...DEFAULT_CONDITIONS, timeOfDay: settings.timeOfDay };
    if (data.version === 2 && WEATHER.includes(settings.weather) && WIPERS.includes(settings.wipers)) return { timeOfDay: settings.timeOfDay, weather: settings.weather, wipers: settings.wipers };
  } catch { /* Corrupt or unavailable storage retains the daytime baseline. */ }
  return { ...DEFAULT_CONDITIONS };
}
export function serializeConditions(conditions: DrivingConditions): string {
  return JSON.stringify({ version: 2, conditions });
}

export function lightingGuidance(timeOfDay: TimeOfDay, headlights: boolean, weather: Weather = 'dry'): string {
  return `${LIGHTING[timeOfDay].label} · ${weather === 'rain' ? 'rain / wet roads' : 'dry roads'}${(timeOfDay !== 'day' || weather === 'rain') && !headlights ? ' · switch on headlights' : ''}`;
}
