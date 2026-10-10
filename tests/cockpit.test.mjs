import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { DEFAULT_VIEW, HeadLook, loadView, serializeView, MIRRORS, MIRROR_BUDGET, MirrorSchedule, mirrorGeometry, placeDriverCamera, placeMirrorCamera } from '../src/cockpit.ts';
import { ACTIONS, DEFAULT_BINDINGS, DriverInput } from '../src/driver-input.ts';

const origin = new Vector3();
const identity = new Quaternion();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function visible(camera, point) {
  const projected = point.clone().project(camera);
  return Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z > -1 && projected.z < 1;
}

test('driver sees both lane edges; head checks reveal adjacent and rear targets independent of steering', () => {
  const camera = new PerspectiveCamera(DEFAULT_VIEW.fov, 16 / 9, 0.035, 900);
  placeDriverCamera(camera, origin, identity, 0, DEFAULT_VIEW, 0);
  for (const x of [0, 5]) assert.ok(visible(camera, new Vector3(x, 0, -12)), 'lane edges visible ahead');
  const left = new Vector3(-8, 0.61, 3), right = new Vector3(8, 0.61, 3), rear = new Vector3(0, 0.61, 12);
  for (const point of [left, right, rear]) assert.equal(visible(camera, point), false);
  for (const [yaw, target] of [[2.05, left], [-2.05, right], [Math.PI, rear]]) {
    placeDriverCamera(camera, origin, identity, 0, DEFAULT_VIEW, yaw);
    assert.ok(visible(camera, target), 'shoulder/rear target visible on its check');
  }
});

test('mirror cameras see the rear, exclude the front, and overlap rear-adjacent views after rotation', () => {
  const geometry = mirrorGeometry();
  try {
    const uv = geometry.getAttribute('uv'), vertices = geometry.getAttribute('position');
    for (let i = 0; i < uv.count; i++) close(uv.getX(i), vertices.getX(i) < 0 ? 1 : 0);
    for (const heading of [0, 0.7, -Math.PI / 2]) {
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading);
      const position = new Vector3(17, 2, -22);
      const world = point => point.clone().applyQuaternion(rotation).add(position);
      for (const mirror of MIRRORS) {
        const camera = new PerspectiveCamera(mirror.fov, 2, 0.1, 220);
        placeMirrorCamera(camera, mirror, position, rotation);
        assert.ok(visible(camera, world(new Vector3(0, 0.8, 20))));
        assert.equal(visible(camera, world(new Vector3(0, 0.8, -20))), false);
        if (mirror.id !== 'rear') assert.ok(visible(camera, world(new Vector3(mirror.x < 0 ? -9 : 9, 0.8, 18))));
        const a = world(new Vector3(-1, 0.8, 20)).project(camera);
        const b = world(new Vector3(1, 0.8, 20)).project(camera);
        assert.ok(-a.x < -b.x, 'reflected image keeps driver-left on screen-left');
        assert.equal(visible(camera, world(new Vector3(-9, 0.8, 0))), false, 'side blind spot requires a head check');
      }
    }
  } finally { geometry.dispose(); }
});

test('comfort mode levels the horizon while preserving physical seat location, heading, and bounded FOV', () => {
  const rotation = new Quaternion().setFromEuler(new Euler(0.1, 0.7, -0.15, 'YXZ'));
  const position = new Vector3(10, 1, 20);
  const full = new PerspectiveCamera(), level = new PerspectiveCamera();
  placeDriverCamera(full, position, rotation, 0.7, DEFAULT_VIEW, 0);
  placeDriverCamera(level, position, rotation, 0.7, { ...DEFAULT_VIEW, followBody: false, fov: 90 }, 0);
  assert.ok(full.position.distanceTo(level.position) < 1e-12);
  const up = new Vector3(0, 1, 0).applyQuaternion(level.quaternion);
  close(up.x, -Math.sin(0.035) * Math.sin(0.7));
  assert.equal(level.fov, 90);
  assert.ok(Math.abs(new Euler().setFromQuaternion(level.quaternion, 'YXZ').z) < 1e-10, 'no roll');
  assert.ok(Math.abs(new Euler().setFromQuaternion(full.quaternion, 'YXZ').z) > 0.1, 'physical roll remains in full mode');
});

test('held head checks return forward, oppose cleanly, and agree at 30/60/144 Hz', () => {
  const values = [];
  for (const fps of [30, 60, 144]) {
    const head = new HeadLook();
    for (let i = 0; i < fps; i++) head.update({ left: true, right: false, back: false }, 1 / fps, true);
    for (let i = 0; i < fps / 2; i++) head.update({ left: false, right: false, back: false }, 1 / fps, true);
    values.push(head.yaw);
    head.update({ left: true, right: true, back: false }, 1 / fps, false);
    assert.equal(head.yaw, 0);
    head.update({ left: false, right: true, back: true }, 1 / fps, false);
    assert.equal(head.yaw, -Math.PI);
    head.reset();
    assert.equal(head.yaw, 0);
  }
  close(values[0], values[1]); close(values[1], values[2]);
});

test('head input has independent keyboard/pointer sources and interruption/reset/remap cleanup', () => {
  const input = new DriverInput();
  input.press('key:J', 'lookLeft'); input.press('pointer:1', 'lookLeft');
  input.press('key:W', 'forward');
  input.release('key:J');
  assert.equal(input.lookSnapshot().left, true);
  assert.equal(input.snapshot().forward, true);
  input.release('pointer:1');
  assert.equal(input.lookSnapshot().left, false);
  for (const clear of [() => input.clear(), () => input.reset(), () => input.remap('lookBack', 'KeyU')]) {
    input.press('key:K', 'lookBack'); clear();
    assert.deepEqual(input.lookSnapshot(), { left: false, right: false, back: false });
  }
});

test('v1 binding migration preserves remaps and chooses conflict-free head keys; v2 round-trips', () => {
  const legacy = Object.fromEntries(ACTIONS.filter(action => !action.startsWith('look')).map(action => [action, [...DEFAULT_BINDINGS[action]]]));
  legacy.horn = ['KeyJ']; legacy.headlights = ['KeyK']; legacy.reset = ['KeyL'];
  const input = new DriverInput();
  input.load(JSON.stringify({ version: 1, bindings: legacy }));
  for (const [action, codes] of Object.entries(legacy)) assert.deepEqual(input.bindings[action], codes);
  const allKeys = Object.values(input.bindings).flat();
  assert.equal(new Set(allKeys).size, allKeys.length);
  const restored = new DriverInput(); restored.load(input.serialize());
  assert.deepEqual(restored.bindings, input.bindings);
});

test('view settings round-trip and reject malformed, nonfinite, out-of-range, and older data', () => {
  const custom = { ...DEFAULT_VIEW, fov: 75, eyeHeight: 1.3, seatZ: 0.2, followBody: false, smoothLook: false, mirrors: 'low' };
  assert.deepEqual(loadView(serializeView(custom)), custom);
  for (const raw of [null, 'bad', '{}', '{"version":2}', ...[{ fov: 180 }, { eyeHeight: -1 }, { seatZ: 3 }, { mirrors: 'ultra' }, { smoothLook: 'yes' }, { followBody: null }, { fov: null }].map(change => serializeView({ ...custom, ...change }))]) {
    assert.deepEqual(loadView(raw), DEFAULT_VIEW);
  }
});

test('mirror work remains bounded at 30/60/144 Hz with no catch-up after a pause or quality change', () => {
  for (const quality of ['standard', 'low']) {
    for (const fps of [30, 60, 144]) {
      const schedule = new MirrorSchedule();
      let batches = 0;
      for (let frame = 0; frame < 2 * fps; frame++) batches += Number(schedule.due(frame * 1000 / fps, quality));
      assert.ok(batches <= 2 * MIRROR_BUDGET[quality].hz);
      assert.ok(batches >= 2 * MIRROR_BUDGET[quality].hz * 0.8);
      assert.ok(schedule.due(100000, quality));
      assert.equal(schedule.due(100000, quality), false);
      assert.equal(schedule.due(100001, 'off'), false);
      assert.ok(schedule.due(100002, quality));
      assert.equal(MIRROR_BUDGET[quality].width / MIRROR_BUDGET[quality].height, 2);
    }
  }
});
