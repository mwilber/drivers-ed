import { Quaternion, Vector3, Euler, PerspectiveCamera, PlaneGeometry } from 'three';
import { CAR, SUSPENSION } from './vehicle-config.ts';

export type MirrorQuality = 'off' | 'low' | 'standard';
export interface ViewSettings {
  fov: number;
  eyeHeight: number;
  seatZ: number;
  followBody: boolean;
  smoothLook: boolean;
  mirrors: MirrorQuality;
}
export const DEFAULT_VIEW: Readonly<ViewSettings> = {
  fov: 68, eyeHeight: CAR.eyeHeight, seatZ: 0.38, followBody: true, smoothLook: true, mirrors: 'standard',
};
export const VIEW_LIMITS = { fov: [55, 90], eyeHeight: [1.12, 1.38], seatZ: [0.18, 0.55] } as const;
export const MIRROR_BUDGET = {
  off: { width: 0, height: 0, hz: 0 }, low: { width: 256, height: 128, hz: 15 }, standard: { width: 512, height: 256, hz: 30 },
} as const;
// Car-local negative Z is forward; positive X is the passenger side.
export const MIRRORS = [
  { id: 'left', x: -1.02, y: 1.08, z: -0.72, yaw: Math.PI - 0.3, fov: 65 },
  { id: 'rear', x: 0, y: 1.43, z: -0.64, yaw: Math.PI, fov: 55 },
  { id: 'right', x: 1.02, y: 1.08, z: -0.72, yaw: Math.PI + 0.3, fov: 65 },
] as const;

export function loadView(serialized: string | null): ViewSettings {
  const fallback = { ...DEFAULT_VIEW };
  try {
    const data = JSON.parse(serialized ?? 'null');
    if (data?.version !== 1 || !data.settings) return fallback;
    const settings = data.settings;
    for (const key of ['fov', 'eyeHeight', 'seatZ'] as const) {
      const [min, max] = VIEW_LIMITS[key];
      if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) return fallback;
    }
    if (typeof settings.followBody !== 'boolean' || typeof settings.smoothLook !== 'boolean' || !['off', 'low', 'standard'].includes(settings.mirrors)) return fallback;
    return { fov: settings.fov, eyeHeight: settings.eyeHeight, seatZ: settings.seatZ, followBody: settings.followBody, smoothLook: settings.smoothLook, mirrors: settings.mirrors };
  } catch { return fallback; }
}
export function serializeView(settings: ViewSettings): string { return JSON.stringify({ version: 1, settings }); }

export interface LookInput { left: boolean; right: boolean; back: boolean }
/** Held shoulder checks return forward on release. Exponential movement agrees across frame rates. */
export class HeadLook {
  yaw = 0;
  update(input: LookInput, dt: number, smooth: boolean): void {
    const side = Number(input.left) - Number(input.right);
    const target = input.back ? (side < 0 ? -Math.PI : Math.PI) : side * 2.05;
    this.yaw += (target - this.yaw) * (smooth ? 1 - Math.exp(-18 * Math.max(0, dt)) : 1);
  }
  reset(): void { this.yaw = 0; }
}

export function placeDriverCamera(camera: PerspectiveCamera, position: Vector3, rotation: Quaternion, heading: number, settings: ViewSettings, yaw: number): void {
  camera.position.set(-0.38, settings.eyeHeight - SUSPENSION.centerOfMassHeight, settings.seatZ).applyQuaternion(rotation).add(position);
  camera.quaternion.copy(settings.followBody ? rotation : new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading));
  camera.quaternion.multiply(new Quaternion().setFromEuler(new Euler(-0.035, yaw, 0, 'YXZ')));
  if (camera.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

export function placeMirrorCamera(camera: PerspectiveCamera, mirror: typeof MIRRORS[number], position: Vector3, rotation: Quaternion): void {
  camera.position.set(mirror.x, mirror.y - SUSPENSION.centerOfMassHeight, mirror.z).applyQuaternion(rotation).add(position);
  camera.quaternion.copy(rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), mirror.yaw));
  camera.updateMatrixWorld();
}

export function mirrorGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return geometry;
}

/** One bounded batch, without catch-up work after pauses or slow frames. */
export class MirrorSchedule {
  private last = -Infinity;
  private quality: MirrorQuality = 'off';
  due(time: number, quality: MirrorQuality): boolean {
    if (quality !== this.quality) { this.last = -Infinity; this.quality = quality; }
    if (quality === 'off' || time - this.last < 1000 / MIRROR_BUDGET[quality].hz - 0.001) return false;
    this.last = time;
    return true;
  }
}
