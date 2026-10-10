import { measurePhysics } from './physics-scenarios.mjs';

console.log('Generic sedan — Rapier rigid body; flat, dry road; no obstacles; 120 Hz');
const result = await measurePhysics();
console.table({
  '0–30 mph (seconds)': result.zeroTo30Seconds.toFixed(2),
  '30–0 mph distance (metres)': result.stoppingDistanceMetres.toFixed(2),
  '30–0 mph time (seconds)': result.stoppingTimeSeconds.toFixed(2),
  'Speed after 5s coasting from 30 mph (mph)': result.coastSpeedAfter5SecondsMph.toFixed(2),
  'Low-speed center-path turn radius (metres)': result.lowSpeedTurnRadiusMetres.toFixed(2),
  'Sustained speed after 180s full throttle (mph)': result.sustainedTopSpeedMph.toFixed(2),
  'Automatic ratios used during 0–30 mph': result.launchGears.join(' → '),
});
