# Drivers Ed

A browser-based, first-person driving sandbox built with TypeScript and WebGL through Three.js. Phase 2 adds tuned flat-road handling and an automatic drivetrain to the original placeholder neighborhood and sedan.

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
npm run handling:check # Repeatable flat-road handling measurements
```

Use a browser with WebGL 2 and hardware acceleration enabled. All scenery is generated locally; the game loads no external models, textures, or fonts.

## Controls

| Input | Action |
| --- | --- |
| W / Up | Accelerate forward; brake first if reversing |
| S / Down | Brake, then reverse while held |
| A / Left, D / Right | Steer |
| R / Reset button | Return to the starting position |

Releasing steering centers the wheel. Releasing the accelerator lets the car coast down with engine braking. Holding both direction keys brakes and holds the car at a stop. Holding the opposite direction first brakes to a complete stop, then engages that direction after a short stationary delay; releasing it cancels the pending change. Direction selection and forward shifts are automatic, with D1/D2/D3…/R/N shown on the speed display; there are no manual gears. The display retains the selected gear when stopped. Touch devices get steering and direction buttons. Switching away from the page clears input and pauses motion.

## Phase 1

- A generic, unstyled sedan with a fixed driver's-seat camera, a plain dashboard, and a steering wheel.
- A 200 × 120 metre rectangular road loop, with a central street connecting the two longer sides. Streets are 10 metres wide.
- Placeholder houses, trees, sidewalks, lawns, and a visible hedge boundary.
- Forward/reverse acceleration, braking before direction changes, steering, and drag. Phase 2 refines this handling and raises the forward speed limit; grass and reverse remain slower.
- A sedan-sized collision footprint against houses, tree trunks, and the outer boundary.
- A small live map, speed and direction display, and reset control.

For turning practice, drive straight ahead from the starting position along the center street. Cross the north T-junction into the wide parking-lot entrance, marked **P** on the map. The lot is 120 × 90 metres, with a 16-metre entrance, perimeter parking spaces, and a large clear center for circles and figure eights. Both the entrance and lot have normal asphalt grip. The outer hedge boundary sits beyond the lot.

## Phase 2 — Implemented handling

The reference vehicle is a fictional 1,500 kg sedan, 4.5 m long and 1.8 m wide, with a 2.7 m wheelbase and 0.31 m tire radius. These are authored tuning values, not specifications or measured validation for a real car. Vehicle configuration is independent of the renderer.

- Progressive throttle and brake response, engine torque, rolling resistance, aerodynamic drag, and engine braking.
- Six available automatic forward ratios and a reverse ratio, with shift hysteresis, brief power interruptions during shifts, and first-gear selection for launch. Sustained high-speed driving uses all six forward ratios.
- A complete-stop interlock and 0.35-second selection delay when changing direction, followed by brake release and throttle buildup. There is no automatic creep with this simplified control scheme.
- Rate-limited steering with a short yaw response time. Full steering lock stays available at every speed and remains held while a direction key is down. Speed reduces how quickly steering builds, rather than unwinding the held wheel; releasing the key centers it.
- An aggregate tire-grip budget shared between longitudinal and lateral acceleration: hard braking reduces available cornering force, and excessive steering demand widens the turn.
- A 115 mph forward governor, with a measured sustained speed around 112.5 mph after drag and rolling resistance. Reverse remains limited to about 11 mph, with slower driving and greater resistance on grass.

Repeatable checks run on an obstacle-free flat test pad in code, without adding a new area to the playable world. The current neighborhood's short streets do not provide room for a full top-speed run. The stopping test starts applying the brakes at 30 mph and excludes human reaction time. The turning measurement follows the car's center path at approximately 1 m/s, rather than measuring an outer-wheel or body turning circle. Full steering lock does not guarantee a tight turn at speed: the tire-grip limit still widens the trajectory.

| Check | Acceptance target | Current measurement |
| --- | --- | --- |
| 0–30 mph acceleration | 5–7 s | 5.32 s |
| 30–0 mph stopping distance | 12–17 m | 12.37 m |
| 30–0 mph stopping time | 1.5–2.2 s | 1.77 s |
| Speed after 5 s coasting from 30 mph | 22–26 mph | 23.52 mph |
| Low-speed full-lock center-path radius | 4.7–5.3 m | 4.94 m |
| Sustained speed after 180 s at full throttle | 110–115 mph | 112.46 mph |
| Same timed maneuver at 30/60/144 Hz and uneven frame times | Identical simulation steps and resulting state | Pass |

Run `npm run handling:check` to reproduce the measurements and `npm test` to check their acceptance bounds, held-steering behavior, direction transitions, transmission behavior, grip limits, braking and obstacle collisions from 115 mph, collision recovery, and frame-rate consistency.

The simulation remains a fixed 120 Hz planar bicycle model. Grip saturation limits turning authority; it does not model individual tire slip, sideways skids, or spinouts. Collision handling still stops the car at obstacles. Suspension, weight transfer, richer collision response, damage, traffic, pedestrians, objectives, audio, and detailed vehicle art remain future work.

## Structure

- `src/simulation.ts`: Renderer-independent vehicle state, input, movement, and collision detection, in metres/seconds/radians.
- `src/vehicle-config.ts`: Sedan dimensions, mass, engine torque curve, transmission ratios, and handling targets.
- `src/simulation-clock.ts`: Fixed-step accumulator shared by the browser and frame-rate regression checks.
- `src/world-layout.ts`: Shared road, house, tree, and obstacle data used by both rendering and simulation.
- `src/scene.ts`: Three.js scene, placeholder geometry, lighting, and cockpit camera.
- `src/main.ts`: Input handling, fixed-step loop, instruments, and map.
- `src/style.css`: Responsive interface and touch controls.
- `tests/simulation.test.mjs`: Acceleration, braking/reverse, steering, speed limits, collision recovery, and layout checks.
- `tests/handling.test.mjs`: Phase 2 performance targets, transmission interlocks, grip, and frame-rate regressions.
- `tests/parking-lot.test.mjs`: Paved access, obstacle clearance, and complete practice circles in the parking lot.
- `scripts/handling-scenarios.mjs`: Repeatable flat-road maneuvers used by tests and `npm run handling:check`.

Three.js, TypeScript, and Vite were approved for this phase; `@types/three` supplies Three.js's TypeScript definitions. Ask the project owner before adding any other third-party libraries. Keep subsequent work within the phase explicitly requested.

## Development roadmap

This is a proposed sequence after Phase 1, not authorization to implement later phases. Confirm each phase's scope with the project owner before starting. Keep free driving available throughout, retain placeholder art until the underlying systems work, and request permission with justification before adding third-party libraries.

Each phase should deliver a small playable increment. Agree on measurable acceptance criteria at its start, test the new behavior in isolation, and then check it in the existing neighborhood. Keep earlier driving checks passing and resolve significant regressions before moving on. Use repeatable starting positions and input sequences to make behavior changes easy to compare.

### Phase 2 — Core vehicle handling (completed)

**Focus:** Make driving on a flat, dry road believable before introducing more complex terrain or other road users.

- Define reference dimensions and performance targets for the generic sedan.
- Refine acceleration, braking, coasting, automatic transmission behavior, steering response, and tire grip. Keep vehicle tuning separate from rendering.
- Establish repeatable checks for stopping distance, turning radius, low-speed maneuvers, and forward/reverse transitions.

**Testing checkpoint:** The sedan behaves predictably at parking and neighborhood speeds, and the same maneuver produces comparable results across different rendering frame rates.

### Phase 3 — Suspension, road contact, and collisions

**Focus:** Make the vehicle respond to the ground and physical obstacles.

- Introduce wheel contact, suspension, body pitch and roll, slopes, and curb traversal in a small test area.
- Replace stop-on-contact behavior with appropriate collision response, including glancing impacts and recovery from getting stuck.
- Evaluate whether a physics library is needed; seek approval before adopting one. Defer cosmetic damage.

**Testing checkpoint:** The car remains stable on flat ground, slopes, and curbs; cannot pass through obstacles at supported speeds; and can recover or reset without invalid state.

### Phase 4 — Driver controls

**Focus:** Complete the sedan's basic operating controls while keeping automatic shifting.

- Add explicit automatic gear selection, a parking brake, indicators, headlights, and a horn.
- Organize keyboard and touch bindings, allow remapping, and add analog controller support if requested.
- Make input handling reliable when controls overlap, focus changes, or an input device disconnects.

**Testing checkpoint:** Each control has a clear effect and visible state; unsafe direction changes are handled consistently; no input remains stuck after interruption.

### Phase 5 — Cockpit visibility and instruments

**Focus:** Give the driver the information and sightlines needed for realistic maneuvers.

- Refine seating position, field of view, and dashboard instruments without requiring finished vehicle art.
- Add controlled head movement, rearview and side mirrors, and ways to check blind spots.
- Offer view and camera-motion settings for comfort.

**Testing checkpoint:** Drivers can judge lane position, reverse, and check surrounding traffic positions. Mirrors show the correct views and remain within the agreed rendering budget.

### Phase 6 — Streets and traffic rules

**Focus:** Turn the existing neighborhood into a consistent road network.

- Define lanes, intersection connections, stop lines, crossings, parking spaces, speed zones, signs, and signals using shared world data.
- Confirm the intended driving side and jurisdiction before implementing specific rule behavior.
- Add a few controlled intersection and parking examples within the current map.

**Testing checkpoint:** Road markings, collision geometry, lane connections, and signal states agree. Every route and intersection can be driven manually without ambiguous or impossible geometry.

### Phase 7 — Vehicle traffic

**Focus:** Add predictable AI drivers on the validated road network.

- Start with one vehicle following a lane, then add following distance, braking, intersection priority, and signal compliance.
- Introduce spawning, removal, and adjustable traffic density only after individual vehicles behave correctly.
- Use repeatable traffic scenarios to diagnose collisions and deadlocks.

**Testing checkpoint:** Vehicles maintain spacing, yield as intended, and complete routes without routine collisions or deadlocks. Test player interference and performance as traffic density increases.

### Phase 8 — Pedestrians and cyclists

**Focus:** Add interactions with vulnerable road users separately from vehicle traffic development.

- Begin with pedestrians using designated crossings and integrate vehicle yielding.
- Add cyclists and their road interactions as a separate increment within this phase.
- Keep movements and spawn locations consistent with visibility and road layout.

**Testing checkpoint:** Crossing, yielding, and stopping behavior works in repeatable encounters, including partial occlusion and a player who fails to yield.

### Phase 9 — Lighting, weather, and surface conditions

**Focus:** Vary driving conditions after dry-road behavior is stable.

- Introduce dusk and night first, including useful headlights and readable road markings.
- Add rain, wet-road grip, and reduced visibility one condition at a time; add wipers when rain affects the windshield.
- Keep each condition configurable so it can be compared against the dry daytime baseline.

**Testing checkpoint:** Changes in visibility and stopping distance are consistent and measurable. Lighting, mirrors, and weather effects remain usable at the target frame rate.

### Phase 10 — Driving audio

**Focus:** Provide sound that communicates the vehicle's behavior and surroundings.

- Add engine and transmission response, tire and surface sounds, indicators, the horn, and restrained environmental audio.
- Connect sounds to simulation state, with appropriate spatial positioning and volume controls.
- Handle browser audio activation, muting, and pause/resume behavior.

**Testing checkpoint:** Sounds track acceleration, speed, surfaces, and nearby events without clipping, abrupt looping, or continuing incorrectly while paused.

### Phase 11 — World expansion and visual detail

**Focus:** Expand the sandbox and replace placeholders without changing validated driving behavior.

- Add road variety and new neighborhood sections in small increments, reusing the shared road and scenery definitions.
- Refine the sedan, houses, vegetation, road materials, and landmarks while preserving accurate proportions and collision boundaries.
- Introduce asset loading and distance-based detail as needed, with explicit performance budgets.

**Testing checkpoint:** New areas remain navigable by both player and traffic. Visual changes preserve sightlines and collision alignment, and larger scenes stay within memory and frame-time targets.

### Phase 12 — Optional practice and feedback

**Focus:** Support learning without turning the open sandbox into a mandatory progression system.

- If requested, add optional exercises for starting and stopping, turns, parking, intersections, and hazard awareness.
- Provide understandable feedback based on the established vehicle and road rules, with easy retry and reset.
- Save preferences and optional practice progress locally; keep unrestricted free drive available.

**Testing checkpoint:** Exercises detect success and mistakes consistently, explain feedback clearly, and can be entered or exited without disrupting sandbox play. Saved data survives reloads and handles older formats safely.

### Phase 13 — Browser compatibility and release readiness

**Focus:** Stabilize the complete agreed feature set for regular play.

- Define supported browsers, devices, input methods, and performance targets with the project owner.
- Profile representative busy scenes; tune rendering, physics, traffic, loading, and memory use where measurements show problems.
- Finish settings, accessible interface controls, loading/error states, documentation, and production packaging.

**Testing checkpoint:** Run the full regression suite and sustained driving sessions across the supported browser/device matrix, including resize, focus loss, reload, graphics-context interruption, and saved-settings recovery. Treat publication as a separate explicitly authorized step.
