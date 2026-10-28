const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const spiderSource = readFileSync(join(__dirname, '../js/spiderman.js'), 'utf8');
const controllersSource = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

// Just enough of three.js for the swing physics (the model and the webs are not built here)
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.dot(this); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerpVectors(a, b, t) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  toArray() { return [this.x, this.y, this.z]; }
}
class Rotation {
  setFromAxisAngle() { return this; }
  setFromUnitVectors() { return this; }
  setFromRotationMatrix() { return this; }
  invert() { return this; }
  multiply() { return this; }
  copy() { return this; }
  slerp() { return this; }
}
const THREE = { Vector3, Quaternion: Rotation, Matrix4: Rotation };

const ISLAND_BOUNDS = { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000, sidewalkHeight: 0 };
const spider = loadModule(spiderSource, {
  imports: { 'three/webgpu': THREE, './city-config.js': { ISLAND_BOUNDS, streetZ: () => 0 }, './pedestrians.js': {} }
});

// The real controller manager's collision code (nearColliders, resolveHorizontalCollision, ground)
function world(colliders) {
  const target = { addEventListener() {} };
  const { ThirdPersonControllerManager } = loadModule(controllersSource, {
    globals: { window: target, document: { ...target, hidden: false } },
    imports: {
      'three/webgpu': THREE,
      './city-config.js': {
        ISLAND_BOUNDS,
        CENTRAL_PARK_BOUNDS: { minX: 1e6, maxX: 1e6 + 1, minZ: 1e6, maxZ: 1e6 + 1 },
        getIslandBoundsAtZ: () => ({ westX: -5000, eastX: 5000 }),
        isTypingInField: () => false,
        blockAt: () => null,
        streetZ: () => 0
      },
      './tsl-materials.js': {},
      './actor-models.js': {},
      './pedestrians.js': {},
      './vehicle-lights.js': {},
      './landmarks.js': {},
      './spiderman.js': spider
    }
  });
  const controllers = Object.create(ThirdPersonControllerManager.prototype);
  controllers.colliders = colliders;
  controllers._colliderCells = null;
  controllers.activeMode = 'spider';
  controllers.keys = { forward: 0, backward: 0, left: 0, right: 0, up: false, down: false };
  return controllers;
}

function spiderEntity(x = 0, y = 0, z = 0, heading = 0) {
  return spider.createSpiderManState(x, y, z, heading);
}

// An avenue running along +Z: 30 m wide, lined by 50 m-deep blocks of towers with 20 m cross streets
function avenue(height = 60) {
  const colliders = [];
  for (let z = -100; z < 2000; z += 80) {
    colliders.push({ minX: -65, maxX: -15, minZ: z, maxZ: z + 60, minY: 0, maxY: height });
    colliders.push({ minX: 15, maxX: 65, minZ: z, maxZ: z + 60, minY: 0, maxY: height });
  }
  return colliders;
}

function insideAny(colliders, p) {
  return colliders.some((c) => p.x > c.minX + 0.05 && p.x < c.maxX - 0.05 && p.z > c.minZ + 0.05 && p.z < c.maxZ - 0.05
    && p.y + 0.5 > (c.minY ?? 0) && p.y + 0.5 < c.maxY);
}

test('web rays hit the facing side of axis-aligned and oriented buildings', () => {
  const hit = {};
  const box = { minX: 10, maxX: 20, minZ: -5, maxZ: 5, minY: 0, maxY: 40 };
  assert.equal(spider.rayBox(box, 0, 10, 0, 1, 0, 0, 100, hit), true);
  assert.equal(hit.t, 10);
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [-1, 0, 0]);
  // Over the roof: misses; aimed down at it: lands on top
  assert.equal(spider.rayBox(box, 0, 50, 0, 1, 0, 0, 100, hit), false);
  assert.equal(spider.rayBox(box, 15, 60, 0, 0, -1, 0, 100, hit), true);
  assert.equal(hit.t, 20);
  assert.equal(hit.ny, 1);
  // From inside a building nothing counts
  assert.equal(spider.rayBox(box, 15, 10, 0, 1, 0, 0, 100, hit), false);
  // The same box as an oriented one turned a quarter turn: the face is found in world space
  const s = Math.SQRT1_2;
  const turned = { minX: 10, maxX: 20, minZ: -5, maxZ: 5, minY: 0, maxY: 40, obb: { cx: 15, cz: 0, hx: 5, hz: 5, cs: s, sn: s } };
  assert.equal(spider.rayBox(turned, 0, 10, 0, 1, 0, 0, 100, hit), true);
  assert.ok(Math.abs(hit.t - (15 - 5 * Math.SQRT2)) < 1e-9, 'reaches the diamond corner');
});

test('anchors land on a facade ahead and above, preferring the requested side', () => {
  const colliders = avenue();
  const controllers = world(colliders);
  for (const side of [1, -1]) {
    const out = {};
    const anchor = spider.findAnchor(controllers, 0, 10, 0, 0, 1, side, out);
    assert.ok(anchor, 'found a building to swing from');
    assert.ok(out.z > 5, 'ahead');
    assert.ok(out.y > 17 && out.y <= 60, 'above, on the building');
    assert.equal(Math.sign(out.x), side, 'on the side asked for (left is +X when facing +Z)');
    assert.ok(Math.abs(Math.abs(out.x) - 15) < 1e-6 || out.ny === 1, 'on the street facade (or a roof edge)');
    // The surface faces back into the street
    assert.ok(out.nx * -side > 0.99 || out.ny === 1);
  }
});

test('over open ground the web finds nothing to stick to', () => {
  const controllers = world([{ minX: -5, maxX: 5, minZ: 30, maxZ: 40, minY: 0, maxY: 3 }]); // a bus shelter
  assert.equal(spider.findAnchor(controllers, 0, 10, 0, 0, 1, 1, {}), null);
  const ent = spiderEntity(0, 0, 0);
  controllers.keys.up = true;
  let attached = false;
  for (let i = 0; i < 180; i++) {
    spider.updateSpiderMan(controllers, ent, 1 / 60);
    attached ||= ent.web.phase === 'attached';
  }
  assert.equal(attached, false);
  assert.ok(ent.position.y >= 0);
});

test('holding the web button chains swings straight down the avenue', () => {
  const colliders = avenue();
  const controllers = world(colliders);
  const ent = spiderEntity(-6, 0, 0, 0);
  controllers.keys.up = true;
  let swings = 0, last = 'none', maxRopeError = 0, minY = Infinity, maxY = 0;
  for (let i = 0; i < 60 * 20; i++) {
    spider.updateSpiderMan(controllers, ent, 1 / 60);
    if (ent.web.phase === 'attached') {
      if (last !== 'attached') swings++;
      const p = ent.position;
      const d = Math.hypot(p.x - ent.web.pivot.x, p.y + 1 - ent.web.pivot.y, p.z - ent.web.pivot.z);
      maxRopeError = Math.max(maxRopeError, d - ent.web.length);
    }
    last = ent.web.phase;
    assert.equal(insideAny(colliders, ent.position), false, `inside a building at ${ent.position.toArray()}`);
    assert.ok(Math.abs(ent.position.x) < 15, 'stays in the street');
    if (i > 120) { minY = Math.min(minY, ent.position.y); maxY = Math.max(maxY, ent.position.y); }
  }
  assert.ok(swings >= 6, `${swings} swings`);
  assert.ok(ent.position.z > 300, `travelled ${ent.position.z.toFixed(0)} m`);
  assert.ok(maxRopeError < 0.6, 'the web never stretches (beyond one step of a reel-in)');
  assert.ok(minY > 1 && maxY < 60, `stays in the canyon (${minY.toFixed(1)}-${maxY.toFixed(1)} m)`);
  assert.ok(Math.abs(Math.sin(ent.heading)) < 0.1, 'still facing down the avenue');
});

test('a released swing flies on as a projectile and lands on its feet', () => {
  const controllers = world(avenue());
  const ent = spiderEntity(-6, 0, 0, 0);
  controllers.keys.up = true;
  let i = 0;
  while (ent.web.phase !== 'attached' && i++ < 600) spider.updateSpiderMan(controllers, ent, 1 / 60);
  for (let k = 0; k < 60; k++) spider.updateSpiderMan(controllers, ent, 1 / 60);
  controllers.keys.up = false;
  spider.updateSpiderMan(controllers, ent, 1 / 60);
  assert.equal(ent.web.phase, 'none');
  assert.equal(ent.state, 'air');
  for (let k = 0; k < 60 * 6 && ent.state !== 'ground'; k++) spider.updateSpiderMan(controllers, ent, 1 / 60);
  assert.equal(ent.state, 'ground');
  assert.ok(ent.position.y >= 0 && ent.position.y < 0.01);
});

test('running into a building climbs it and vaults onto the roof', () => {
  const colliders = [{ minX: -20, maxX: 20, minZ: 10, maxZ: 40, minY: 0, maxY: 24 }];
  const controllers = world(colliders);
  const ent = spiderEntity(0, 0, 0, 0);
  controllers.keys.forward = 1;
  let climbed = false;
  for (let i = 0; i < 60 * 12 && !(ent.state === 'ground' && ent.position.y > 20); i++) {
    spider.updateSpiderMan(controllers, ent, 1 / 60);
    climbed ||= ent.state === 'wall';
    assert.equal(insideAny(colliders, ent.position), false);
  }
  assert.ok(climbed, 'clung to the wall');
  assert.equal(ent.state, 'ground');
  assert.ok(Math.abs(ent.position.y - 24) < 1e-6, 'standing on the roof');
});

test('spawns and teleports perch on a nearby mid-rise roof', () => {
  const controllers = world([
    { minX: 10, maxX: 30, minZ: -10, maxZ: 10, minY: 0, maxY: 35 },
    { minX: -40, maxX: -20, minZ: -10, maxZ: 10, minY: 0, maxY: 300 } // too tall to start on
  ]);
  const ent = spiderEntity(0, 0, 0);
  assert.equal(spider.perchOnRooftop(controllers, ent), true);
  assert.equal(ent.position.y, 35);
  assert.ok(ent.position.x > 10 && ent.position.x < 30);
  const lonely = spiderEntity(500, 0, 500);
  assert.equal(spider.perchOnRooftop(controllers, lonely), false);
  assert.equal(lonely.position.y, 0);
});

test('the follow camera is pulled in front of a wall it would go through', () => {
  const controllers = world([{ minX: -20, maxX: 20, minZ: -30, maxZ: -10, minY: 0, maxY: 50 }]);
  const target = new Vector3(0, 5, 0);
  const camera = new Vector3(0, 6, -20);
  assert.equal(spider.clipCameraToBuildings(controllers, target, camera), true);
  assert.ok(camera.z > -10 && camera.z < 0, `camera at z=${camera.z}`);
  const clear = new Vector3(0, 6, 8);
  assert.equal(spider.clipCameraToBuildings(controllers, target, clear), false);
  assert.equal(clear.z, 8);
});

function step(controllers, ent, seconds, keys = {}) {
  Object.assign(controllers.keys, keys);
  for (let i = 0; i < Math.round(seconds * 60); i++) spider.updateSpiderMan(controllers, ent, 1 / 60);
}

// A 60 m tower whose west face (x = 10) looks onto open ground
const tower = () => [{ minX: 10, maxX: 40, minZ: -100, maxZ: 100, minY: 0, maxY: 60 }];

test('crawling moves only while the stick is held, head first up and down', () => {
  const controllers = world(tower());
  const ent = spiderEntity(0, 0, 0, Math.PI / 2); // facing the wall (+X)
  step(controllers, ent, 2, { forward: 0.6 });  // jog into it: sticks
  assert.equal(ent.state, 'wall');
  step(controllers, ent, 1, { forward: 1 });
  const y = ent.position.y;
  assert.ok(y > 3, `climbed to ${y.toFixed(1)} m`);
  assert.ok(Math.cos(ent.wall.angle) > 0.9, 'head up');
  step(controllers, ent, 1.5, { forward: 0 });
  assert.equal(ent.state, 'wall');
  assert.ok(Math.abs(ent.position.y - y) < 1e-9, 'holds still with the stick released');
  step(controllers, ent, 0.8, { backward: 1 });
  assert.ok(ent.position.y < y - 1, 'crawls down');
  assert.ok(Math.cos(ent.wall.angle) < -0.5, 'head first');
  step(controllers, ent, 5, { backward: 1 });
  assert.equal(ent.state, 'ground', 'stands up at the bottom');
});

test('hitting a wall at speed runs along it and keeps the momentum', () => {
  const controllers = world(tower());
  const ent = spiderEntity(8, 20, -30);
  ent.state = 'air';
  ent.velocity.set(8, 0, 25); // glancing into the wall while flying along it
  let ran = false, minSpeed = Infinity;
  for (let i = 0; i < 40; i++) {
    spider.updateSpiderMan(controllers, ent, 1 / 60);
    if (ent.state === 'wallrun') { ran = true; minSpeed = Math.min(minSpeed, ent.wallRun.speed); }
  }
  assert.ok(ran, 'ran along the wall');
  assert.ok(Math.abs(ent.wallRun.dy) < 0.4, 'along it, not up it');
  assert.ok(minSpeed > 20, `kept its speed (${minSpeed.toFixed(1)} m/s)`);
  // Holding the button kicks off and carries on, still fast
  step(controllers, ent, 0.5, { up: true });
  assert.notEqual(ent.state, 'wallrun');
  assert.ok(Math.hypot(ent.velocity.x, ent.velocity.z) > 20);
  assert.ok(ent.velocity.z > 15, 'still heading the same way');
});

test('a head-on hit at speed runs up the wall instead of stopping dead', () => {
  const controllers = world(tower());
  const ent = spiderEntity(5, 10, 0);
  ent.state = 'air';
  ent.velocity.set(25, 0, 0);
  step(controllers, ent, 0.4);
  assert.equal(ent.state, 'wallrun');
  assert.ok(ent.wallRun.dy > 0.7);
  assert.ok(ent.position.y > 13, `ran up to ${ent.position.y.toFixed(1)} m`);
});

test('a tap zips forward on a web stuck to a building ahead', () => {
  const colliders = avenue();
  const controllers = world(colliders);
  const tapper = spiderEntity(0, 20, 0);
  const faller = spiderEntity(0, 20, 0);
  for (const e of [tapper, faller]) { e.state = 'air'; e.velocity.set(0, 0, 15); }
  const tap = () => {
    step(controllers, tapper, 3 / 60, { up: true });
    step(controllers, tapper, 0.3, { up: false });
  };
  step(controllers, tapper, 3 / 60, { up: true });
  step(controllers, tapper, 1 / 60, { up: false });
  assert.ok(tapper.zip.time >= 0, 'zipped');
  const a = tapper.zip.anchor;
  const onFace = colliders.some((c) => a.x >= c.minX - 1e-6 && a.x <= c.maxX + 1e-6 && a.z >= c.minZ - 1e-6
    && a.z <= c.maxZ + 1e-6 && a.y <= c.maxY + 1e-6);
  assert.ok(onFace, `the web stuck to a building (${a.toArray().map((n) => n.toFixed(1))})`);
  assert.ok(a.z > tapper.position.z, 'ahead');
  assert.ok(Math.hypot(tapper.velocity.x, tapper.velocity.z) < 18, 'the push builds up, not all at once');
  step(controllers, tapper, 0.3, { up: false });
  assert.ok(Math.hypot(tapper.velocity.x, tapper.velocity.z) > 22, 'pushed forward');
  assert.ok(Math.abs(Math.atan2(tapper.velocity.x, tapper.velocity.z)) < 1e-9, 'same direction');
  for (let i = 0; i < 4; i++) tap();
  step(controllers, faller, 0.3 + 3 / 60 + 1 / 60 + 0.3 + 4 * (3 / 60 + 0.3));
  assert.ok(tapper.position.z > faller.position.z + 20, 'went further');
  assert.equal(tapper.web.phase, 'none', 'never swung');
});

test('over open ground no web is thrown at all, tapped or held', () => {
  const controllers = world([]);
  const ent = spiderEntity(0, 40, 0);
  ent.state = 'air';
  ent.velocity.set(0, 0, 15);
  step(controllers, ent, 3 / 60, { up: true });
  step(controllers, ent, 1 / 60, { up: false });
  assert.equal(ent.zip.time, -1, 'no zip into thin air');
  assert.ok(Math.abs(ent.velocity.z - 15) < 1e-9, 'no push from nothing');
  let shown = false;
  for (let i = 0; i < 120; i++) {
    step(controllers, ent, 1 / 60, { up: true });
    shown ||= ent.web.phase !== 'none';
  }
  assert.equal(shown, false, 'no web flies out to miss');
});

test('a zip to a building off to the side keeps the line of travel', () => {
  // One tower ahead and well to the left
  const controllers = world([{ minX: 20, maxX: 50, minZ: 40, maxZ: 80, minY: 0, maxY: 80 }]);
  const ent = spiderEntity(0, 20, 0);
  ent.state = 'air';
  ent.velocity.set(0, 0, 20);
  step(controllers, ent, 3 / 60, { up: true });
  step(controllers, ent, 1 / 60, { up: false });
  assert.ok(ent.zip.time >= 0, 'zipped to the tower');
  assert.ok(ent.zip.anchor.x >= 20 - 1e-6, 'the web is on the tower, off to the side');
  step(controllers, ent, 0.3);
  assert.ok(Math.abs(Math.atan2(ent.velocity.x, ent.velocity.z)) < 1e-9, 'not pulled off his line');
  assert.ok(ent.velocity.z > 25, 'but still pushed on');
});

test('a zip can stick to a roof a little below him, and softens a fall without stopping it', () => {
  // A low block ahead whose roof is 4 m under his feet; nothing taller anywhere
  const roof = { minX: -20, maxX: 20, minZ: 15, maxZ: 60, minY: 0, maxY: 16 };
  const controllers = world([roof]);
  const ent = spiderEntity(0, 20, 0);
  ent.state = 'air';
  ent.velocity.set(0, -12, 18);
  step(controllers, ent, 3 / 60, { up: true });
  step(controllers, ent, 1 / 60, { up: false });
  assert.ok(ent.zip.time >= 0, 'zipped');
  assert.ok(ent.zip.anchor.y <= 16 + 1e-6 && ent.zip.anchor.y < ent.position.y, 'on the roof below');
  assert.ok(ent.velocity.y < -8, 'still falling the frame after (no sudden stop)');
  step(controllers, ent, 0.25);
  assert.ok(ent.velocity.y > -12, 'the fall is softened');
  // Far below (25 m under the feet) is still in reach; 40 m is not
  const below = world([{ ...roof, minZ: 30, maxZ: 90, maxY: 20 }]);
  const high = spiderEntity(0, 45, 0);
  high.state = 'air';
  high.velocity.set(0, 0, 18);
  step(below, high, 3 / 60, { up: true });
  step(below, high, 1 / 60, { up: false });
  assert.ok(high.zip.time >= 0, 'zipped to a roof 25 m down');
  const deep = world([{ ...roof, maxY: 6 }]);
  const low = spiderEntity(0, 46, 0);
  low.state = 'air';
  low.velocity.set(0, 0, 18);
  step(deep, low, 3 / 60, { up: true });
  step(deep, low, 1 / 60, { up: false });
  assert.equal(low.zip.time, -1);
});

test('a zip can stick to a street light ahead', () => {
  const controllers = world([]);
  controllers.lampSites = [
    { x: 1.5, y: 8.02, z: 30 },  // ahead, a little to the side
    { x: 0, y: 8.02, z: -30 },   // behind: never
    { x: 60, y: 8.02, z: 20 }    // far off to the side: outside the fan
  ];
  const ent = spiderEntity(0, 12, 0);
  ent.state = 'air';
  ent.velocity.set(0, 0, 16);
  step(controllers, ent, 3 / 60, { up: true });
  step(controllers, ent, 1 / 60, { up: false });
  assert.ok(ent.zip.time >= 0, 'zipped');
  assert.deepEqual(ent.zip.anchor.toArray(), [1.5, 8.02, 30], 'to the lamp head ahead');
  step(controllers, ent, 0.3);
  assert.ok(Math.abs(Math.atan2(ent.velocity.x, ent.velocity.z)) < 1e-9, 'still on his line');
});

test('the stick is relative to the camera: pushing up from in front turns him round', () => {
  const controllers = world([]);
  const ent = spiderEntity(0, 0, 0, 0); // facing +Z
  controllers.cameraYaw = Math.PI;      // the camera is in front of him, looking back at him (towards -Z)
  step(controllers, ent, 1, { forward: 1 });
  assert.ok(Math.abs(Math.abs(ent.heading) - Math.PI) < 0.05, `turned round (heading ${ent.heading.toFixed(2)})`);
  assert.ok(ent.position.z < -5, 'and ran away from the camera');
  // Stick right with the camera behind him: he turns to the camera's right (-X) and runs that way
  const side = spiderEntity(0, 0, 0, 0);
  controllers.cameraYaw = 0;
  step(controllers, side, 1, { forward: 0, right: 1 });
  assert.ok(side.position.x < -5 && Math.abs(side.position.z) < 2, 'ran to the right of the screen');
  // Letting go: he stops
  step(controllers, side, 1, { right: 0 });
  assert.ok(side.speed < 0.5);
});

test('zips: a little hop up each time, and at most three in a row', () => {
  const colliders = avenue(120);
  const controllers = world(colliders);
  const ent = spiderEntity(0, 40, 0);
  ent.state = 'air';
  ent.velocity.set(0, 0, 18);
  const tap = () => {
    step(controllers, ent, 3 / 60, { up: true });
    step(controllers, ent, 1 / 60, { up: false });
  };
  tap();
  assert.ok(ent.zip.time >= 0);
  const y0 = ent.position.y;
  let peak = y0;
  for (let i = 0; i < 24; i++) { step(controllers, ent, 1 / 60); peak = Math.max(peak, ent.position.y); }
  assert.ok(peak > y0 + 1, `rose ${(peak - y0).toFixed(2)} m`);
  let zips = 1;
  for (let i = 0; i < 4; i++) {
    const before = ent.zip.chain;
    tap();
    if (ent.zip.chain > before) zips++;
    step(controllers, ent, 0.3);
  }
  assert.equal(zips, 3, 'only three zips in a row');
  // Touching down resets the count
  step(controllers, ent, 10);
  assert.equal(ent.state, 'ground');
  assert.equal(ent.zip.chain, 0);
});

test('on a wall the camera tilts up the wall climbing, and down it crawling down', () => {
  const controllers = world(tower());
  const ent = spiderEntity(0, 0, 0, Math.PI / 2);
  step(controllers, ent, 2, { forward: 0.6 });
  step(controllers, ent, 1.5, { forward: 1 });
  assert.equal(ent.state, 'wall');
  assert.ok(ent.cameraPitch > 0.5, `looks up (${ent.cameraPitch.toFixed(2)})`);
  step(controllers, ent, 1.5, { forward: 0, backward: 1 });
  assert.ok(ent.cameraPitch < -0.5, `looks down (${ent.cameraPitch.toFixed(2)})`);
});
