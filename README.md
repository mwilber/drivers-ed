# Drivers Ed

A browser-based, first-person driving sandbox built with TypeScript and WebGL through Three.js. Phase 4 adds persistent collision damage, placeholder panel dents and scratches, optional handling effects, and in-place repair to the Rapier sedan.

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

Use a browser with WebGL 2, WebAssembly, and hardware acceleration enabled. All scenery is generated locally; the game loads no external models, textures, or fonts. Rapier's WebAssembly is bundled with the application. Its compatibility package increases the production download size; Vite currently reports a large-bundle advisory.

## Controls

| Input | Action |
| --- | --- |
| W / Up | Accelerate forward; brake first if reversing |
| S / Down | Brake, then reverse while held |
| A / Left, D / Right | Steer |
| R / Reset button | Return to the starting position |
| Test area button | Reset upright on the approach to the suspension test ramp |
| Repair car button | Restore appearance and handling in place, preserving position and motion |
| Handling effects checkbox | Enable/disable damage-related handling changes; body damage remains visible |

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
- Rate-limited steering. Full steering lock stays available at every speed and remains held while a direction key is down. Speed reduces how quickly steering builds, rather than unwinding the held wheel; releasing the key centers it.
- Grip-limited handling. Phase 3 now applies tire forces at each suspension contact, replacing the original planar turn limiter.
- A 115 mph forward governor, with a measured sustained speed around 112.5 mph after drag and rolling resistance. Reverse remains limited to about 11 mph, with slower driving and greater resistance on grass.

The current measurements below use the same Rapier vehicle as the browser, on an obstacle-free flat test pad in code. The neighborhood's short streets do not provide room for a full top-speed run. The stopping test starts applying the brakes at 30 mph and excludes human reaction time. The turning measurement follows the car's center path at approximately 1 m/s, rather than measuring an outer-wheel or body turning circle. Full steering lock does not guarantee a tight turn at speed: tire grip limits the trajectory.

| Check | Acceptance target | Current measurement |
| --- | --- | --- |
| 0–30 mph acceleration | 5–7 s | 5.32 s |
| 30–0 mph stopping distance | 12–17 m | 12.32 m |
| 30–0 mph stopping time | 1.5–2.2 s | 1.77 s |
| Speed after 5 s coasting from 30 mph | 22–26 mph | 23.52 mph |
| Low-speed full-lock center-path radius | 4.8–5.7 m | 5.34 m |
| Sustained speed after 180 s at full throttle | 110–115 mph | 112.45 mph |
| Same timed rigid-body maneuver at 30/60/144 Hz | Identical resulting position, orientation, and speed | Pass |

Run `npm run handling:check` to reproduce the measurements and `npm test` to check their acceptance bounds, held-steering behavior, direction transitions, transmission behavior, grip limits, braking and obstacle collisions from 115 mph, collision recovery, and frame-rate consistency.

## Phase 3 — Suspension, ground contact, and collisions

- A dynamic 1,500 kg chassis runs at 120 Hz with four raycast suspension contacts. Each wheel has spring travel, compression/rebound damping, contact-dependent drive/brake forces, and lateral friction.
- The cockpit follows the physical body, so slopes, bumps, acceleration, and braking can produce pitch and roll. Wheel positions follow suspension travel; front wheels steer visually and physically.
- Gravity acts on slopes and while airborne. Airborne wheels cannot propel the vehicle. Holding both direction keys applies the brakes to hold a shallow slope; releasing them permits gravity-driven rollback.
- Houses, tree trunks, hedges, pavement, and sidewalks have 3D colliders. Glancing impacts retain tangential movement instead of forcing a complete stop. Continuous collision detection is enabled on the chassis and is tested against a thin wall at 115 mph.
- Sidewalks now have actual 15 cm raised edges. Their geometry is cut around intersections, lot entrances, and driveways so those routes remain flush. Rendering and collision construction share the same layout dimensions.
- Reset clears the chassis, wheel controller, motion, and pending controls, then settles a fresh suspension at a known safe spawn. An overturned car displays a recovery hint. **R** returns to the neighborhood start; **Test area** places the car before the ramp.

The **T** area is east of the parking lot, connected through its southeast side. It contains a 10 m-wide ramp with a 1.2 m rise, shallow 12 m approaches and an 8 m plateau, plus a separate 15 cm raised curb pad. Approach slowly to observe pitching over the ramp or drive one side of the car over the curb pad to observe roll. The original parking lot stays open for turning practice.

Rapier was selected for its [raycast vehicle controller](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html) and [continuous collision detection](https://rapier.rs/docs/user_guides/javascript/rigid_body_ccd/), avoiding a custom 3D contact solver. The current implementation is still a simplified sedan: wheel contacts are rays rather than deformable tire shapes; all four contacts share drive force; there is no detailed tire model, suspension linkage geometry, crash deformation, or validated real-car calibration. Very sharp edges and extreme maneuvers may produce simplified responses. Use Reset if the car becomes stuck or overturned.

The test suite checks flat-ground settling, performance targets, held steering and reverse transitions, the drive-in route, ramp ascent/descent, braking on a slope, asymmetric curb traversal, airborne contact loss and landing, glancing impacts, high-speed wall collision, repeated recovery, and deterministic frame-rate behavior. Phase 2's planar model remains only as an isolated controls/drivetrain reference; the browser uses the Rapier model. Traffic, pedestrians, objectives, audio, and detailed vehicle art remain future phases.

## Phase 4 — Car damage and repair

- Rapier contact-force events supply contact locations and normals. Inward contact-point speed determines impact severity; tangential movement accumulates scratches by distance. Front, rear, left, right, and roof damage persist until repair or reset during the current session.
- Impacts below 1.2 m/s inward speed are ignored. Light impacts cause cosmetic damage; impacts at 5 m/s and above can weaken the closest wheel's suspension. A contact latch, a 0.3-second impact cooldown, and a solver-impulse threshold reject resting-force damage. Driving back into an obstacle after bouncing away counts as another impact.
- Separate placeholder body panels show shallow dents, darker damaged paint, and scratches. The hood is visible from the driver's seat; the dashboard diagram reports damage to every panel, with dent/scratch percentages available on hover and to assistive technology.
- Heavier frontal dents can reduce propulsion by at most 35%. Wheel damage can introduce up to 0.055 radians of steering bias and reduce spring/damping strength by at most 25%. These authored effects remain bounded, preserve braking, and leave the car driveable. Dashboard feedback describes the active effects.
- **Handling effects** disables the physical penalties immediately on the next simulation step while retaining cosmetic damage. Tests and tools can also pass `damageHandling: false` to `createVehiclePhysics` for the undamaged handling baseline.
- **Repair car** restores panels and wheel settings in place without moving or stopping the car. **Reset / R** and **Test area** restore an undamaged car at their safe spawn and preserve the handling-effects setting.
- `physics.damage.drainEvents()` exposes bounded impact and scrape-start/update/end events with simulation time, panel, severity, world contact point, normal, and obstacle material. Scrape updates are limited to one per 0.25 seconds per obstacle. Pause ends active scrapes; repair and reset discard pending impacts and emit end events for any active scrape. The browser consumes these events for notices; no audio is introduced in this phase.

The acceptance checks cover proportional light/heavy damage, front/rear/side location, glancing scrapes, repeated impacts, sustained resting contact with the accelerator held, stable maximum handling penalties, baseline equivalence with penalties disabled, repair/reset, restoration of original panel geometry/materials, and identical damage/events/vehicle state at 30/60/144 Hz. Earlier driving and terrain checks remain passing.

This is a game damage model, not crash deformation or a real vehicle safety/calibration model. Dents affect appearance without changing collision shapes. Wheel damage is localized to the strongest sampled contact; detailed structural damage, detached parts, broken glass, finished art, and saving damage across page reloads are outside this increment.

## Structure

- `src/simulation.ts`: Shared input and drivetrain forces plus the Phase 2 planar reference model, in metres/seconds/radians.
- `src/vehicle-physics.ts`: Rapier world, colliders, dynamic chassis, wheel suspension, state synchronization, and reset/recovery.
- `src/vehicle-damage.ts`: Persistent panel/wheel damage, bounded handling effects, contact latches, and future audio events.
- `src/damage-visuals.ts`: Independent placeholder body panels, dents/scratches, and restoration of original geometry and paint.
- `src/vehicle-config.ts`: Sedan dimensions, mass, engine torque curve, transmission ratios, and suspension/handling tuning.
- `src/simulation-clock.ts`: Fixed-step accumulator shared by the browser and frame-rate regression checks.
- `src/world-layout.ts`: Shared road, house, tree, and obstacle data used by both rendering and simulation.
- `src/scene.ts`: Three.js scene, placeholder geometry, lighting, and cockpit camera.
- `src/main.ts`: Input handling, fixed-step loop, instruments, and map.
- `src/style.css`: Responsive interface and touch controls.
- `tests/simulation.test.mjs`: Acceleration, braking/reverse, steering, speed limits, collision recovery, and layout checks.
- `tests/handling.test.mjs`: Phase 2 performance targets, transmission interlocks, grip, and frame-rate regressions.
- `tests/parking-lot.test.mjs`: Paved access, obstacle clearance, and complete practice circles in the parking lot.
- `tests/vehicle-physics.test.mjs`: Current rigid-body vehicle behavior, terrain, collisions, and recovery regressions.
- `tests/vehicle-damage.test.mjs`: Impact/scrape severity and location, resting contact, handling limits, frame-rate consistency, and repair/reset restoration.
- `scripts/handling-scenarios.mjs`: Phase 2 reference maneuvers used by isolated drivetrain tests.
- `scripts/physics-scenarios.mjs`: Current rigid-body measurements used by tests and `npm run handling:check`.

Three.js, TypeScript, and Vite were approved for Phase 1; `@types/three` supplies Three.js's TypeScript definitions. `@dimforge/rapier3d-compat` was approved for Phase 3. Ask the project owner before adding any other third-party libraries. Keep subsequent work within the phase explicitly requested.

## Development roadmap

This is a proposed sequence after Phase 1, not authorization to implement later phases. Confirm each phase's scope with the project owner before starting. Keep free driving available throughout, retain placeholder art until the underlying systems work, and request permission with justification before adding third-party libraries.

Each phase should deliver a small playable increment. Agree on measurable acceptance criteria at its start, test the new behavior in isolation, and then check it in the existing neighborhood. Keep earlier driving checks passing and resolve significant regressions before moving on. Use repeatable starting positions and input sequences to make behavior changes easy to compare.

### Phase 2 — Core vehicle handling (completed)

**Focus:** Make driving on a flat, dry road believable before introducing more complex terrain or other road users.

- Define reference dimensions and performance targets for the generic sedan.
- Refine acceleration, braking, coasting, automatic transmission behavior, steering response, and tire grip. Keep vehicle tuning separate from rendering.
- Establish repeatable checks for stopping distance, turning radius, low-speed maneuvers, and forward/reverse transitions.

**Testing checkpoint:** The sedan behaves predictably at parking and neighborhood speeds, and the same maneuver produces comparable results across different rendering frame rates.

### Phase 3 — Suspension, road contact, and collisions (completed)

**Focus:** Make the vehicle respond to the ground and physical obstacles.

- Introduce wheel contact, suspension, body pitch and roll, slopes, and curb traversal in a small test area.
- Replace stop-on-contact behavior with appropriate collision response, including glancing impacts and recovery from getting stuck.
- Evaluate whether a physics library is needed; seek approval before adopting one. Defer car damage to Phase 4.

**Testing checkpoint:** The car remains stable on flat ground, slopes, and curbs; cannot pass through obstacles at supported speeds; and can recover or reset without invalid state.

### Phase 4 — Car damage and repair (completed)

**Focus:** Make collisions produce understandable, persistent damage to the player's sedan, building on the validated collision response.

- Track impact severity and location from collision events, distinguishing minor scrapes from stronger impacts and avoiding repeated damage from resting contact.
- Add visible body damage with placeholder dents, scratches, and damaged panels before investing in detailed crash deformation or finished vehicle art.
- Introduce bounded effects on steering, suspension, or propulsion for heavier damage, with clear dashboard feedback. Make handling damage configurable so free driving and baseline handling checks remain available.
- Keep damage until repair or reset; both neighborhood and test-area resets restore an undamaged, driveable car. Expose impact and scrape events for the driving audio phase.

**Testing checkpoint:** Repeatable impacts produce consistent damage appropriate to severity and location across rendering frame rates. Glancing scrapes, repeated impacts, and sustained resting contact behave correctly; damage effects stay stable; repair and reset restore original appearance and handling without stale state.

### Phase 5 — Driver controls

**Focus:** Complete the sedan's basic operating controls while keeping automatic shifting.

- Add explicit automatic gear selection, a parking brake, indicators, headlights, and a horn.
- Organize keyboard and touch bindings, allow remapping, and add analog controller support if requested.
- Make input handling reliable when controls overlap, focus changes, or an input device disconnects.

**Testing checkpoint:** Each control has a clear effect and visible state; unsafe direction changes are handled consistently; no input remains stuck after interruption.

### Phase 6 — Cockpit visibility and instruments

**Focus:** Give the driver the information and sightlines needed for realistic maneuvers.

- Refine seating position, field of view, and dashboard instruments without requiring finished vehicle art.
- Add controlled head movement, rearview and side mirrors, and ways to check blind spots.
- Offer view and camera-motion settings for comfort.

**Testing checkpoint:** Drivers can judge lane position, reverse, and check surrounding traffic positions. Mirrors show the correct views and remain within the agreed rendering budget.

### Phase 7 — Streets and traffic rules

**Focus:** Turn the existing neighborhood into a consistent road network.

- Define lanes, intersection connections, stop lines, crossings, parking spaces, speed zones, signs, and signals using shared world data.
- Confirm the intended driving side and jurisdiction before implementing specific rule behavior.
- Add a few controlled intersection and parking examples within the current map.

**Testing checkpoint:** Road markings, collision geometry, lane connections, and signal states agree. Every route and intersection can be driven manually without ambiguous or impossible geometry.

### Phase 8 — Vehicle traffic

**Focus:** Add predictable AI drivers on the validated road network.

- Start with one vehicle following a lane, then add following distance, braking, intersection priority, and signal compliance.
- Introduce spawning, removal, and adjustable traffic density only after individual vehicles behave correctly.
- Use repeatable traffic scenarios to diagnose collisions and deadlocks.

**Testing checkpoint:** Vehicles maintain spacing, yield as intended, and complete routes without routine collisions or deadlocks. Test player interference and performance as traffic density increases.

### Phase 9 — Pedestrians and cyclists

**Focus:** Add interactions with vulnerable road users separately from vehicle traffic development.

- Begin with pedestrians using designated crossings and integrate vehicle yielding.
- Add cyclists and their road interactions as a separate increment within this phase.
- Keep movements and spawn locations consistent with visibility and road layout.

**Testing checkpoint:** Crossing, yielding, and stopping behavior works in repeatable encounters, including partial occlusion and a player who fails to yield.

### Phase 10 — Lighting, weather, and surface conditions

**Focus:** Vary driving conditions after dry-road behavior is stable.

- Introduce dusk and night first, including useful headlights and readable road markings.
- Add rain, wet-road grip, and reduced visibility one condition at a time; add wipers when rain affects the windshield.
- Keep each condition configurable so it can be compared against the dry daytime baseline.

**Testing checkpoint:** Changes in visibility and stopping distance are consistent and measurable. Lighting, mirrors, and weather effects remain usable at the target frame rate.

### Phase 11 — Driving audio

**Focus:** Provide sound that communicates the vehicle's behavior and surroundings.

- Add engine and transmission response, tire and surface sounds, indicators, the horn, collision impacts, body scrapes, and restrained environmental audio.
- Connect sounds to simulation state and the damage phase's impact and scrape events, scaling collision sounds by severity and material without retriggering them continuously during resting contact. Use appropriate spatial positioning and volume controls.
- Handle browser audio activation, muting, and pause/resume behavior.

**Testing checkpoint:** Sounds track acceleration, speed, surfaces, impacts, and nearby events without clipping, abrupt looping, or continuing incorrectly while paused. Verify distinct light/heavy impact feedback and that repair or reset clears active scrape sounds.

### Phase 12 — World expansion and visual detail

**Focus:** Expand the sandbox and replace placeholders without changing validated driving behavior.

- Add road variety and new neighborhood sections in small increments, reusing the shared road and scenery definitions.
- Refine the sedan, houses, vegetation, road materials, and landmarks while preserving accurate proportions and collision boundaries.
- Introduce asset loading and distance-based detail as needed, with explicit performance budgets.

**Testing checkpoint:** New areas remain navigable by both player and traffic. Visual changes preserve sightlines and collision alignment, and larger scenes stay within memory and frame-time targets.

### Phase 13 — Optional practice and feedback

**Focus:** Support learning without turning the open sandbox into a mandatory progression system.

- If requested, add optional exercises for starting and stopping, turns, parking, intersections, and hazard awareness.
- Provide understandable feedback based on the established vehicle and road rules, with easy retry and reset.
- Save preferences and optional practice progress locally; keep unrestricted free drive available.

**Testing checkpoint:** Exercises detect success and mistakes consistently, explain feedback clearly, and can be entered or exited without disrupting sandbox play. Saved data survives reloads and handles older formats safely.

### Phase 14 — Browser compatibility and release readiness

**Focus:** Stabilize the complete agreed feature set for regular play.

- Define supported browsers, devices, input methods, and performance targets with the project owner.
- Profile representative busy scenes; tune rendering, physics, traffic, loading, and memory use where measurements show problems.
- Finish settings, accessible interface controls, loading/error states, documentation, and production packaging.

**Testing checkpoint:** Run the full regression suite and sustained driving sessions across the supported browser/device matrix, including resize, focus loss, reload, graphics-context interruption, and saved-settings recovery. Treat publication as a separate explicitly authorized step.
