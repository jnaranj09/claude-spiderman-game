const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  subVectors(a, b) { return this.copy(a).sub(b); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.set(this.x / l, this.y / l, this.z / l); }
}

class PerspectiveCamera {
  constructor(fov, aspect) {
    this.fov = fov;
    this.aspect = aspect;
    this.position = new Vector3();
    this.target = new Vector3();
    this.up = new Vector3(0, 1, 0);
  }
  updateProjectionMatrix() {}
  lookAt(v) { this.target.copy(v); }
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function cameraHarness(entity = {
  position: new Vector3(0, 0, 100), heading: 0, speed: 0, type: 'car',
  chaseDistance: 6.9, chaseHeight: 2.12, cameraTargetOffset: new Vector3(0, 1, 0)
}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const canvas = { ...eventTarget(), style: {} };
  const controls = eventTarget();
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  window.innerWidth = 1600;
  window.innerHeight = 900;
  const { CameraSystem } = loadModule(source, {
    globals: { window, document },
    imports: { 'three/webgpu': { Vector3, PerspectiveCamera }, './landmarks.js': {} }
  });
  const camera = new CameraSystem(canvas, { getActiveEntity: () => entity });
  return {
    camera, canvas, controls, window, document, captured, entity,
    pointer(target, type, id, x, y = 0, pointerType = 'touch', button = 0) {
      const event = {
        pointerId: id, clientX: x, clientY: y, pointerType, button,
        prevented: false, preventDefault() { this.prevented = true; }
      };
      // Captured pointers keep reaching the canvas after moving over the controls.
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
      return event;
    }
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('UI touches neither move nor release an active canvas orbit', () => {
  const h = cameraHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.controls, 'pointerdown', 1, 20);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  assert.equal(h.captured.has(1), false);
  assert.equal(h.captured.has(2), true);

  h.pointer(h.controls, 'pointermove', 1, 300);
  close(h.camera.orbitYawOffset, 0);
  h.pointer(h.controls, 'pointerup', 1, 300);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.controls, 'pointermove', 2, 110);
  close(h.camera.orbitYawOffset, -0.065);
  h.pointer(h.controls, 'pointerup', 2, 110);
  assert.equal(h.camera.isDragging, false);
});

test('two canvas touches pinch without orbiting and one remaining touch resumes smoothly', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  close(h.camera.zoomMultiplier, 0.5);
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  h.pointer(h.canvas, 'pointermove', 1, 100);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerup', 2, 200);
  h.pointer(h.canvas, 'pointermove', 1, 110);
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.zoomMultiplier, 1);
});

test('extra fingers are ignored and coincident pinch points keep zoom finite', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointerdown', 3, 300);
  h.pointer(h.canvas, 'pointermove', 3, 500);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointermove', 2, 0);
  h.pointer(h.canvas, 'pointermove', 2, 10);
  assert.equal(Number.isFinite(h.camera.zoomMultiplier), true);
  h.pointer(h.canvas, 'pointerup', 3, 500);
  assert.equal(h.camera.isDragging, true);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
  test(`${interruption} ends capture without a stuck drag or jump on the next gesture`, () => {
    const h = cameraHarness();
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 10);
    if (interruption === 'blur' || interruption === 'hidden') h.pointer(h.canvas, 'pointerdown', 3, 100);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1, 10);
    assert.equal(h.camera.isDragging, false);
    assert.equal(h.captured.size, 0);
    h.pointer(h.canvas, 'pointermove', 1, 500);
    close(h.camera.orbitYawOffset, -0.065);
    h.pointer(h.canvas, 'pointerdown', 2, 600);
    h.pointer(h.canvas, 'pointermove', 2, 610);
    close(h.camera.orbitYawOffset, -0.13);
  });
}

test('cancelling one pinch pointer leaves the other ready for orbit', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 1, 20);
  h.pointer(h.canvas, 'pointercancel', 2, 100);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.canvas, 'pointermove', 1, 30);
  close(h.camera.orbitYawOffset, -0.065);
});

test('mouse orbit and wheel zoom retain their behavior and bounds', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse', 2);
  assert.equal(h.camera.isDragging, false);
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse');
  h.pointer(h.canvas, 'pointermove', 1, 10, 20, 'mouse');
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.orbitPitchOffset, 0.19);
  h.pointer(h.canvas, 'pointerup', 1, 10, 20, 'mouse');
  let prevented = false;
  h.canvas.dispatch('wheel', { deltaY: 100, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  close(h.camera.zoomMultiplier, 1.1);
  h.canvas.dispatch('wheel', { deltaY: -10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 0.45);
  h.canvas.dispatch('wheel', { deltaY: 10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 2.4);
});

for (const preset of ['chase', 'observatory', 'drone']) {
  test(`teleport after driving, orbiting and ${preset} snaps to a fresh chase view`, () => {
    const h = cameraHarness();
    h.entity.speed = 45;
    for (let i = 0; i < 180; i++) h.camera.update(1 / 60, i / 60);
    assert.ok(h.camera.smoothedSpeed > 44);
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 200, 80);
    h.pointer(h.canvas, 'pointerup', 1, 200, 80);
    h.canvas.dispatch('wheel', { deltaY: 1000, preventDefault() {} });
    h.camera.setCameraPreset(preset, true);
    h.camera.update(1 / 60, 4);

    h.entity.position.set(-200, 20, 5300);
    h.entity.heading = -Math.PI / 2;
    h.entity.speed = 0;
    h.camera.resetForTeleport();
    const fresh = cameraHarness(h.entity).camera;
    assert.equal(h.camera.activePresetId, 'chase');
    assert.equal(h.camera.camera.fov, fresh.camera.fov);
    // Compare arrival, follow re-anchoring, and movement after arrival, including a change in height.
    for (let i = 0; i < 3; i++) {
      if (i === 2) h.entity.position.set(-205, 23, 5304);
      h.camera.update(1 / 60, 5 + i / 60);
      fresh.update(1 / 60, 5 + i / 60);
      for (const field of ['currentPos', 'currentLookAt']) {
        for (const axis of ['x', 'y', 'z']) close(h.camera[field][axis], fresh[field][axis]);
      }
      for (const axis of ['x', 'y', 'z']) {
        close(h.camera.camera.position[axis], fresh.camera.position[axis]);
        close(h.camera.camera.target[axis], fresh.camera.target[axis]);
      }
    }
  });
}

test('teleport releases every camera pointer and ignores old gestures before accepting a new drag', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointermove', 1, 20, 40);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  assert.equal(h.captured.size, 2);
  h.camera.resetForTeleport();
  assert.equal(h.captured.size, 0);
  assert.equal(h.camera.isDragging, false);
  assert.equal(h.camera.userOrbitTimer, 0);
  for (const id of [1, 2]) {
    h.pointer(h.canvas, 'pointermove', id, 500, 500);
    h.pointer(h.canvas, 'pointerup', id, 500, 500);
  }
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerdown', 3, 600);
  h.pointer(h.canvas, 'pointermove', 3, 610);
  close(h.camera.orbitYawOffset, -0.065);
  assert.equal(h.camera.isDragging, true);
});

test('the swing cam is slow to follow Spider-Man round a change of direction, then catches up', () => {
  const lag = (preset) => {
    const h = cameraHarness({
      position: new Vector3(0, 20, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
      chaseDistance: 4.6, chaseHeight: 1.7, cameraTargetOffset: new Vector3(0, 1.3, 0)
    });
    h.camera.setCameraPreset(preset, true);
    for (let i = 0; i < 60; i++) h.camera.update(1 / 60, i / 60);
    h.entity.heading = 0.6; // a zigzag's new swing sets off the other way
    const offsets = [];
    for (let i = 0; i < 240; i++) {
      h.camera.update(1 / 60, 1 + i / 60);
      offsets.push(-h.camera.orbitYawOffset);
    }
    return { early: offsets[23], late: offsets[239] };
  };
  const swing = lag('swing'), chase = lag('chase');
  assert.ok(swing.early > 0.45, `still looking the old way at first (${swing.early.toFixed(2)} of 0.6 rad)`);
  assert.ok(swing.early > chase.early + 0.08, 'later to react than the chase cam');
  assert.ok(Math.abs(swing.late) < 0.05, `settles behind him (${swing.late.toFixed(3)})`);
});

test('whipping round a corner, the swing cam locks on close behind Spider-Man and turns with him, just lagging', () => {
  const turn = (state) => {
    const h = cameraHarness({
      position: new Vector3(0, 20, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
      chaseDistance: 4.6, chaseHeight: 1.7, cameraTargetOffset: new Vector3(0, 1.3, 0), state: 'air', cameraLock: 0
    });
    h.camera.setCameraPreset('swing', true);
    for (let i = 0; i < 60; i++) h.camera.update(1 / 60, i / 60);
    h.entity.state = state;
    h.entity.cameraLock = state === 'whip' ? 0.8 : 0;
    let worst = 0;
    // A quarter turn round the corner in 0.6 s
    for (let i = 1; i <= 36; i++) {
      h.entity.heading = (Math.PI / 2) * i / 36;
      h.camera.update(1 / 60, 1 + i / 60);
      worst = Math.max(worst, Math.abs(h.camera.orbitYawOffset));
    }
    return worst;
  };
  const whip = turn('whip'), air = turn('air');
  assert.ok(whip > 0.1 && whip < 0.5, `close behind him, a little late (${whip.toFixed(2)} rad off)`);
  assert.ok(air > 0.8, `a turn in the air still lags (${air.toFixed(2)} rad)`);
});

test('the swing cam dips behind Spider-Man through the swing and rises above him at its end, at any height', () => {
  const heightAt = (altitude, swingCam, swingRise = 0) => {
    const h = cameraHarness({
      position: new Vector3(0, altitude, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
      chaseDistance: 4.6, chaseHeight: 1.7, chaseZoom: 2.4, cameraTargetOffset: new Vector3(0, 1.3, 0),
      state: 'swing', cameraLock: 0, altitude, swingCam, swingRise
    });
    h.camera.setCameraPreset('swing', true);
    for (let i = 0; i < 300; i++) h.camera.update(1 / 60, i / 60);
    return h.camera.camera.position.y - altitude;
  };
  for (const altitude of [20, 80]) {
    const bottom = heightAt(altitude, 'swing', 0), end = heightAt(altitude, 'swing', 1);
    assert.ok(bottom < 0, `${altitude} m up, low behind him through the bottom (${bottom.toFixed(1)} m)`);
    assert.ok(end > 2.5, `${altitude} m up, above him at the end of the swing (${end.toFixed(1)} m)`);
  }
  assert.ok(Math.abs(heightAt(20, 'swing', 1) - heightAt(80, 'swing', 1)) < 0.01, 'the same at any height');
  const launch = heightAt(12, 'launch');
  assert.ok(launch < 0, `climbing off the ground, below him looking up (${launch.toFixed(1)} m)`);
  const off = heightAt(6, 'off');
  assert.ok(Math.abs(off - 4.9) < 0.5, `not swinging: the usual height (${off.toFixed(1)} m)`);
});

test('climbing up the far side of a swing, the swing cam stays above Spider-Man, not under him', () => {
  const h = cameraHarness({
    position: new Vector3(0, 40, 100), velocity: new Vector3(0, 14, 14), heading: 0, speed: 20, type: 'spider',
    chaseDistance: 4.6, chaseHeight: 1.7, chaseZoom: 2.4, cameraTargetOffset: new Vector3(0, 1.3, 0),
    state: 'swing', cameraLock: 0, altitude: 40, swingCam: 'swing', swingRise: 1, swingUp: new Vector3(0, 0.7, 0.7)
  });
  h.camera.setCameraPreset('swing', true);
  for (let i = 0; i < 90; i++) {
    h.entity.position.y += 14 / 60;
    h.entity.position.z += 14 / 60;
    h.entity.altitude = h.entity.position.y;
    h.camera.update(1 / 60, i / 60);
  }
  const rel = h.camera.camera.position.y - (h.entity.position.y + 1);
  assert.ok(rel > 0.5, `${rel.toFixed(1)} m above his chest`);
});

test('up at the end of the swing the swing cam looks further down, and sinks back slowly as he falls into the next', () => {
  const h = cameraHarness({
    position: new Vector3(0, 40, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
    chaseDistance: 4.6, chaseHeight: 1.7, chaseZoom: 2.4, cameraTargetOffset: new Vector3(0, 1.3, 0),
    state: 'swing', cameraLock: 0, altitude: 40, swingCam: 'swing', swingRise: 0
  });
  h.camera.setCameraPreset('swing', true);
  const pitch = () => {
    const c = h.camera.camera;
    return Math.atan2(c.position.y - c.target.y, Math.hypot(c.position.x - c.target.x, c.position.z - c.target.z));
  };
  for (let i = 0; i < 300; i++) h.camera.update(1 / 60, i / 60);
  const lowPitch = pitch();
  h.entity.swingRise = 1;
  for (let i = 0; i < 120; i++) h.camera.update(1 / 60, 5 + i / 60);
  const top = h.camera.camera.position.y - 40, highPitch = pitch();
  assert.ok(top > 4, `up high (${top.toFixed(1)} m)`);
  assert.ok(highPitch > lowPitch + 0.3, `looking down more steeply (${highPitch.toFixed(2)} against ${lowPitch.toFixed(2)} rad)`);
  h.entity.swingRise = 0;
  for (let i = 0; i < 30; i++) h.camera.update(1 / 60, 7 + i / 60);
  const after = h.camera.camera.position.y - 40;
  assert.ok(after > top - 3, `half a second later, still on its way down (${after.toFixed(1)} m)`);
});

test('up the far side of a swing the swing cam looks up with him, towards the sky ahead', () => {
  const h = cameraHarness({
    position: new Vector3(0, 40, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
    chaseDistance: 4.6, chaseHeight: 1.7, chaseZoom: 2.4, cameraTargetOffset: new Vector3(0, 1.3, 0),
    state: 'swing', cameraLock: 0, altitude: 40, swingCam: 'swing', swingRise: 0, swingLookUp: 1
  });
  h.camera.setCameraPreset('swing', true);
  for (let i = 0; i < 120; i++) h.camera.update(1 / 60, i / 60);
  const c = h.camera.camera;
  assert.ok(c.target.y > c.position.y + 2, `looking up (aim ${(c.target.y - c.position.y).toFixed(1)} m above the camera)`);
  assert.ok(c.position.y < 40 + 1, 'from low behind him');
});

test('a view dragged round or up or down drifts back behind him unless locked; unlocking brings it back', () => {
  const h = cameraHarness({
    position: new Vector3(0, 40, 100), velocity: new Vector3(0, 0, 20), heading: 0, speed: 20, type: 'spider',
    chaseDistance: 4.6, chaseHeight: 1.7, cameraTargetOffset: new Vector3(0, 1.3, 0), state: 'air', cameraLock: 0
  });
  const drag = () => {
    h.camera.orbitPitchOffset = 0.5;
    h.camera.orbitYawOffset = 1.2;
    h.camera.userOrbitTimer = 4;
  };
  const settle = (seconds) => { for (let i = 0; i < 60 * seconds; i++) h.camera.update(1 / 60, i / 60); };
  drag();
  settle(10);
  assert.ok(Math.abs(h.camera.orbitPitchOffset - 0.09) < 0.02, 'unlocked: back to the usual tilt');
  assert.ok(Math.abs(h.camera.orbitYawOffset) < 0.05, 'unlocked: back behind him');

  h.camera.setViewLocked(true);
  drag();
  settle(10);
  assert.equal(h.camera.orbitPitchOffset, 0.5, 'locked: tilt stays where it was put');
  assert.ok(Math.abs(h.camera.orbitYawOffset - 1.2) < 1e-9, 'locked: stays round to the side');
  // he turns (the stick, read against the camera, sends him off the way it looks): the view keeps looking the same way
  const yaw = () => h.entity.heading + h.camera.orbitYawOffset;
  const before = yaw();
  h.entity.heading = 1.2;
  settle(10);
  assert.ok(Math.abs(yaw() - before) < 1e-9, 'still looking the same way after he turns');

  h.camera.setViewLocked(false);
  settle(10);
  assert.ok(Math.abs(h.camera.orbitPitchOffset - 0.09) < 0.02 && Math.abs(h.camera.orbitYawOffset) < 0.05, 'unlocked: all the way back');
});
