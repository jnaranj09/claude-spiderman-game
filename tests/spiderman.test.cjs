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
  imports: { 'three/webgpu': THREE, './city-config.js': { ISLAND_BOUNDS, streetZ: () => 0 } }
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
  const mesh = () => ({ position: new Vector3(), quaternion: new Rotation(), scale: new Vector3(), rotateZ() {} });
  return {
    type: 'spider',
    webs: { splats: Array.from({ length: 8 }, () => ({ mesh: mesh(), life: 0, held: false })), next: 0 },
    position: new Vector3(x, y, z),
    velocity: new Vector3(),
    heading, speed: 0, state: 'ground',
    web: {
      phase: 'none', anchor: new Vector3(), normal: new Vector3(), pivot: new Vector3(), tip: new Vector3(),
      length: 0, targetLength: 0, travelled: 0, distance: 0, side: 1, splat: null, swingTime: 0,
      passedBottom: false, rising: false, dirX: 0, dirZ: 1
    },
    nextSide: 1, webHeld: false, webCooldown: 0, webRetry: 0, groundTime: 0,
    wall: { nx: 0, nz: 0, top: 0, time: 0, tx: 0, tz: 0 },
    flip: 1, crouch: 0, runPhase: 0, climbPhase: 0, bodyQuat: new Rotation()
  };
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
  for (let i = 0; i < 60 * 6 && !(ent.state === 'ground' && ent.position.y > 20); i++) {
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
