/** Fictional generic sedan tuning, in SI units. No rendering dependencies. */
export const CAR = {
  width: 1.8,
  length: 4.5,
  wheelbase: 2.7,
  eyeHeight: 1.22,
  mass: 1500,
  tireRadius: 0.31,
} as const;

export const SUSPENSION = {
  centerOfMassHeight: 0.61,
  trackWidth: 1.56,
  restLength: 0.38,
  travel: 0.2,
  stiffness: 30,
  compression: 4.4,
  relaxation: 5.2,
  maxForce: 18000,
  tireFriction: 1.2,
  sideStiffness: 1,
} as const;

/** Authored game damage thresholds, not a real crash or safety model. */
export const DAMAGE = {
  minimumImpactSpeed: 1.2,
  heavyImpactSpeed: 5,
  fullSeveritySpeed: 18,
  impactCooldown: 0.3,
  minimumScrapeSpeed: 0.8,
  scratchPerMetre: 0.012,
  scrapeEventInterval: 0.25,
  maximumPowerLoss: 0.35,
  maximumSteeringBias: 0.055,
  maximumSuspensionLoss: 0.25,
} as const;

export const HANDLING = {
  gravity: 9.81,
  forwardSpeedLimit: 51.4096, // 115 mph governor; drag puts sustained speed slightly below it.
  reverseSpeedLimit: 5,
  speedGovernorRange: 1.2,
  brakeDeceleration: 7.5,
  parkingBrakeDeceleration: 4,
  rollingResistance: 0.012,
  aerodynamicDrag: 0.4, // Newtons per (metre/second)^2.
  engineBraking: 0.28, // Base coast deceleration in an engaged gear.
  engineBrakingPerSpeed: 0.012,
  throttleRiseRate: 2.5,
  throttleFallRate: 5,
  brakeRiseRate: 5,
  brakeFallRate: 8,
  steeringLock: 0.5,
  steeringRate: 0.85,
  steeringReturnRate: 1.1,
  steeringRateSpeedScale: 24,
  yawResponseTime: 0.14,
  dryGrip: 0.9,
  grassGrip: 0.5,
  grassRollingResistance: 0.085,
  grassSpeedLimit: 7,
} as const;

export const TRANSMISSION = {
  forwardRatios: [3.6, 2.15, 1.45, 1.05, 0.82, 0.68],
  reverseRatio: 3.3,
  finalDrive: 3.65,
  efficiency: 0.87,
  idleRpm: 850,
  launchRpm: 1600,
  redlineRpm: 6000,
  upshiftRpm: 3200,
  downshiftRpm: 1300,
  shiftDuration: 0.24,
  shiftCooldown: 0.8,
  directionChangeDelay: 0.35,
  selectionStopSpeed: 0.03,
  suspensionJitterSpeed: 0.1,
  // Engine speed (rpm), torque (Nm). Interpolate between these tuning points.
  torqueCurve: [[850, 110], [1600, 150], [3000, 180], [4500, 180], [6000, 150]],
} as const;
