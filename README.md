# Drivers Ed

A browser-based, first-person driving sandbox built with TypeScript and WebGL through Three.js. Phase 1 is a deliberately simple foundation for a realistic simulator, with placeholder geometry and a lightweight driving model.

## Run locally

Requires Node.js 22.18+ (or Node.js 24) and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm run build   # Type-check and create a production build in dist/
npm run preview # Serve the production build locally
npm test        # Driving and world-layout tests using Node's built-in runner
```

Use a browser with WebGL 2 and hardware acceleration enabled. All scenery is generated locally; the game loads no external models, textures, or fonts.

## Controls

| Input | Action |
| --- | --- |
| W / Up | Accelerate forward; brake first if reversing |
| S / Down | Brake, then reverse while held |
| A / Left, D / Right | Steer |
| R / Reset button | Return to the starting position |

Releasing steering centers the wheel. Releasing the accelerator lets the car coast down. Holding both direction keys brakes. Direction selection is automatic, with D/R/N shown on the speed display; there are no manual gears. Touch devices get steering and direction buttons. Switching away from the page clears input and pauses motion.

## Phase 1

- A generic, unstyled sedan with a fixed driver's-seat camera, a plain dashboard, and a steering wheel.
- A 200 × 120 metre rectangular road loop, with a central street connecting the two longer sides. Streets are 10 metres wide.
- Placeholder houses, trees, sidewalks, lawns, and a visible hedge boundary.
- Forward/reverse acceleration, braking before direction changes, speed-sensitive steering, and drag. Road speed is capped at about 40 mph; grass and reverse are slower.
- A sedan-sized collision footprint against houses, tree trunks, and the outer boundary.
- A small live map, speed and direction display, and reset control.

The current physics use a fixed 120 Hz planar bicycle model. Suspension, tire slip, drivetrain ratios, damage, traffic, pedestrians, objectives, audio, and detailed vehicle art are future phases and are not implemented.

## Structure

- `src/simulation.ts`: Renderer-independent vehicle state, input, movement, and collision detection, in metres/seconds/radians.
- `src/world-layout.ts`: Shared road, house, tree, and obstacle data used by both rendering and simulation.
- `src/scene.ts`: Three.js scene, placeholder geometry, lighting, and cockpit camera.
- `src/main.ts`: Input handling, fixed-step loop, instruments, and map.
- `src/style.css`: Responsive interface and touch controls.
- `tests/simulation.test.mjs`: Acceleration, braking/reverse, steering, speed limits, collision recovery, and layout checks.

Three.js, TypeScript, and Vite were approved for this phase; `@types/three` supplies Three.js's TypeScript definitions. Ask the project owner before adding any other third-party libraries. Keep subsequent work within the phase explicitly requested.
