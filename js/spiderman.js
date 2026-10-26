import * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS, streetZ } from './city-config.js';
import { PersonRig, buildPersonGeometry, createSpiderSuitMaterial } from './pedestrians.js';

// js/spiderman.js
// Spider-Man: the city's skinned pedestrian body in a procedurally painted suit, posed by forward kinematics, and an
// arcade web-swinging controller.
//
// The swing is a real pendulum (gravity + an inextensible rope, solved as a distance constraint), with two
// tricks layered on top to keep it readable and easy to play:
//  1. The web is ray cast against the actual building colliders, so its end and the web splat sit on a real
//     facade or roof edge. The pendulum's pivot, though, is that anchor pulled most of the way back over the
//     player's line of travel: the rope still visibly ends on the building, but the swing carries along the
//     street instead of slamming sideways into the wall the web hit.
//  2. Holding the web button chains swings: each swing lets go on its own on the way up and fires the next web,
//     so one thumb is enough to cross Midtown. The stick (or W/A/S/D) only steers and pumps.
// A quick tap of the button zips a web straight ahead and yanks him forward (it works over open ground too); flying
// into a wall at speed runs along it (or up it) instead of stopping dead, and a slow touch sticks to it to crawl.

const GRAVITY = 22;              // m/s². Stronger than real gravity: a 40 m swing takes ~3 s instead of ~6 s
const MAX_SPEED = 48;            // m/s
const RUN_SPEED = 13;
const TURN_RATE = 3.0;           // rad/s on the ground
const AIR_TURN_RATE = 1.5;       // rad/s while swinging or falling
const WEB_SPEED = 260;           // m/s: how fast the web travels to its anchor
const WEB_RANGE = 115;           // m
const PIVOT_PULL = 0.95;         // share of the anchor's sideways offset the pendulum pivot moves back over the path
const RELEASE_BOOST_UP = 5.5;
const RELEASE_BOOST_FWD = 5.0;
const CRAWL_UP_SPEED = 4.2;      // m/s on a wall, only while the stick is held
const CRAWL_DOWN_SPEED = 3.2;
const CRAWL_SIDE_SPEED = 3.6;
const WALL_RUN_MIN_SPEED = 9;    // hitting a wall faster than this runs along / up it
const TAP_TIME = 0.2;            // s: a press shorter than this is a tap (web zip)
const ZIP_PUSH = 10;             // m/s forward per zip
const ZIP_MAX_SPEED = 38;
const ZIP_PULL_TIME = 0.25;      // s: the zip's push builds up over this long instead of all at once
const ZIP_LIFT = 38;             // m/s² upward during the pull (against gravity's 22): softens a fall, never stops it dead
const ZIP_BELOW = 30;            // m: how far under his feet a roof, ledge or street light can be for a zip to stick to it
const ZIP_RANGE = 90;            // m
const PELVIS_HEIGHT = 0.96;      // the body's pelvis above the feet, standing
const SPLATS = 8;

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------

// A web splat: radial strands and rings, stuck on the wall where a web lands
function createWebSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.translate(128, 128);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineCap = 'round';
  const spokes = 11;
  const angles = [];
  for (let i = 0; i < spokes; i++) angles.push((i / spokes) * Math.PI * 2 + Math.sin(i * 7.1) * 0.18);
  ctx.lineWidth = 3;
  for (const a of angles) {
    const r = 92 + Math.sin(a * 5) * 22;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let ring = 1; ring <= 4; ring++) {
    const r = ring * 22;
    ctx.beginPath();
    angles.forEach((a, i) => {
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// Model: the city's pedestrian body (pedestrians.js) wearing the suit, as an ordinary skinned mesh whose 15 bones
// take the world-space transforms PersonRig.poseFK works out
// ---------------------------------------------------------------------------------------------------------------

const JOINTS = ['spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR'];
const BONES = 15;

function buildSpiderManModel(scene) {
  // The person geometry carries its two-bone skinning in a 'skin' attribute (bone a, bone b, weight of b, part):
  // spelled out as standard skin indices & weights
  const geometry = buildPersonGeometry(1).clone();
  const skin = geometry.getAttribute('skin');
  const indices = new Uint16Array(skin.count * 4);
  const weights = new Float32Array(skin.count * 4);
  for (let i = 0; i < skin.count; i++) {
    indices[i * 4] = skin.getX(i);
    indices[i * 4 + 1] = skin.getY(i);
    weights[i * 4] = 1 - skin.getZ(i);
    weights[i * 4 + 1] = skin.getZ(i);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));

  const mesh = new THREE.SkinnedMesh(geometry, createSpiderSuitMaterial());
  mesh.name = 'SpiderMan';
  // Bones outside the scene graph, with identity bind inverses: each one's matrixWorld is simply its pose
  const bones = Array.from({ length: BONES }, () => {
    const bone = new THREE.Bone();
    bone.matrixAutoUpdate = false;
    bone.matrixWorldAutoUpdate = false;
    return bone;
  });
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  mesh.frustumCulled = false; // it moves far from its bind-pose bounds
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // An athletic build; no hair under the mask
  const rig = new PersonRig({ seed: 1, scale: 1.0, girth: 1.0, hair: 0 });
  // The entity's mesh: an empty anchor the controller manager moves around (the body is skinned in world space)
  const root = new THREE.Group();
  root.name = 'PlayerSpiderMan';
  return { root, mesh, bones, rig, hands: [new THREE.Vector3(), new THREE.Vector3()] };
}

const _boneQ = new THREE.Quaternion();
const _boneT = new THREE.Vector3();
const _boneS = new THREE.Vector3();

// Copies the rig's pose (per bone: rotation, translation, scale) into the skeleton
function applyRigToBones(model) {
  const a = model.rig.pose;
  for (let b = 0; b < BONES; b++) {
    const o = b * 8;
    _boneQ.set(a[o], a[o + 1], a[o + 2], a[o + 3]);
    _boneT.set(a[o + 4], a[o + 5], a[o + 6]);
    _boneS.setScalar(a[o + 7]);
    model.bones[b].matrixWorld.compose(_boneT, _boneQ, _boneS);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Webs: the strand from the hand to the anchor, and splats that stay on the walls for a few seconds
// ---------------------------------------------------------------------------------------------------------------

function buildWebs(scene) {
  const group = new THREE.Group();
  group.name = 'SpiderWebs';
  const strandGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  strandGeo.translate(0, 0.5, 0);
  const strandMat = new THREE.MeshBasicNodeMaterial({ color: 0xf4f6fa });
  const strand = new THREE.Mesh(strandGeo, strandMat);
  strand.frustumCulled = false;
  // Parked out of sight (rather than hidden) so its pipeline compiles behind the loading screen
  strand.position.set(0, -500, 0);
  strand.scale.setScalar(0.001);
  group.add(strand);

  const splatTex = createWebSplatTexture();
  const splatGeo = new THREE.PlaneGeometry(1.9, 1.9);
  const splats = [];
  for (let i = 0; i < SPLATS; i++) {
    const material = new THREE.MeshBasicNodeMaterial({
      map: splatTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(splatGeo, material);
    mesh.position.set(0, -500, 0);
    mesh.renderOrder = 997;
    group.add(mesh);
    splats.push({ mesh, life: 0, held: false });
  }
  scene.add(group);
  return { group, strand, splats, next: 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry queries against the city's building colliders (axis-aligned boxes, or oriented ones with `obb`)
// ---------------------------------------------------------------------------------------------------------------

function boxFrame(c) {
  const o = c.obb;
  return o
    ? { cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, cs: o.cs, sn: o.sn }
    : { cx: (c.minX + c.maxX) * 0.5, cz: (c.minZ + c.maxZ) * 0.5, hx: (c.maxX - c.minX) * 0.5, hz: (c.maxZ - c.minZ) * 0.5, cs: 1, sn: 0 };
}

function footprintContains(c, x, z, pad = 0) {
  if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) return false;
  if (!c.obb) return true;
  const f = boxFrame(c);
  const dx = x - f.cx, dz = z - f.cz;
  const lx = dx * f.cs - dz * f.sn, lz = dx * f.sn + dz * f.cs;
  return Math.abs(lx) <= f.hx + pad && Math.abs(lz) <= f.hz + pad;
}

// Slab test of a ray against a (possibly oriented) box; fills hit with the distance and the face normal
function rayBox(c, ox, oy, oz, dx, dy, dz, maxT, hit) {
  const f = boxFrame(c);
  const rx = ox - f.cx, rz = oz - f.cz;
  const lo = [rx * f.cs - rz * f.sn, oy, rx * f.sn + rz * f.cs];
  const ld = [dx * f.cs - dz * f.sn, dy, dx * f.sn + dz * f.cs];
  const lo3 = [-f.hx, c.minY ?? 0, -f.hz];
  const hi3 = [f.hx, c.maxY, f.hz];
  let tNear = -Infinity, tFar = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < lo3[i] || lo[i] > hi3[i]) return false;
      continue;
    }
    const t1 = (lo3[i] - lo[i]) / ld[i];
    const t2 = (hi3[i] - lo[i]) / ld[i];
    const enter = Math.min(t1, t2), exit = Math.max(t1, t2);
    if (enter > tNear) { tNear = enter; axis = i; sign = ld[i] > 0 ? -1 : 1; }
    if (exit < tFar) tFar = exit;
    if (tNear > tFar) return false;
  }
  if (axis < 0 || tNear < 0.5 || tNear > maxT) return false; // starts inside, or out of reach
  const lnx = axis === 0 ? sign : 0, lny = axis === 1 ? sign : 0, lnz = axis === 2 ? sign : 0;
  hit.t = tNear;
  hit.nx = lnx * f.cs + lnz * f.sn;
  hit.ny = lny;
  hit.nz = -lnx * f.sn + lnz * f.cs;
  hit.top = c.maxY;
  return true;
}

// Street, sidewalk, park lawn, or the roof underfoot (a roof counts once the feet were at or above it)
function groundAt(controllers, x, z, fromY) {
  let ground = controllers.getGroundHeight(x, z, 'person');
  for (const c of controllers.nearColliders(x, z, 0.5)) {
    if (c.maxY > ground && c.maxY <= fromY + 0.75 && footprintContains(c, x, z)) ground = c.maxY;
  }
  return ground;
}

// The building in front of a wall contact, to find how high the wall goes
function wallTopAt(controllers, x, y, z) {
  let top = -Infinity;
  for (const c of controllers.nearColliders(x, z, 0.5)) {
    if (y + 0.2 >= (c.minY ?? 0) && y < c.maxY && footprintContains(c, x, z, 0.05)) top = Math.max(top, c.maxY);
  }
  return top;
}

const _hit = { t: 0, nx: 0, ny: 0, nz: 0, top: 0 };
const _dir = new THREE.Vector3();

// Horizontal clearance to the facades on either side, for keeping swings in the middle of the street canyon.
// Returns how far the middle of the canyon lies to the left (negative: to the right), or 0 in the open.
function canyonCentreOffset(controllers, cx, cy, cz, fx, fz) {
  const lx = fz, lz = -fx;
  const reach = 45;
  let left = reach, right = reach;
  for (const c of controllers.nearColliders(cx, cz, reach)) {
    if (c.maxY < cy + 2) continue;
    if (rayBox(c, cx, cy, cz, lx, 0, lz, left, _hit)) left = _hit.t;
    if (rayBox(c, cx, cy, cz, -lx, 0, -lz, right, _hit)) right = _hit.t;
  }
  return left < reach && right < reach ? (left - right) * 0.5 : 0;
}

// Ray casts a fan of candidate web directions, ahead and up, favouring the side the next hand swings from.
// Returns the best anchor on a real building surface, or null over open ground (parks, rivers, low rooftops).
function findAnchor(controllers, cx, cy, cz, fx, fz, side, out, ground = 0) {
  const lx = fz, lz = -fx; // the figure's left, for a heading (fx, fz)
  const candidates = controllers.nearColliders(cx + fx * 40, cz + fz * 40, 85).filter((c) => c.maxY > cy + 7);
  if (!candidates.length) return null;
  let best = null, bestScore = -Infinity;
  const elevations = [0.55, 0.85, 1.2, 1.7];
  const laterals = [0.15, 0.4, 0.7, 1.05];
  for (const s of [side, -side]) {
    for (const lat of laterals) {
      for (const elev of elevations) {
        _dir.set(fx + lx * lat * s, elev, fz + lz * lat * s).normalize();
        let tBest = WEB_RANGE, found = false, nx = 0, ny = 0, nz = 0;
        for (const c of candidates) {
          if (rayBox(c, cx, cy, cz, _dir.x, _dir.y, _dir.z, tBest, _hit)) {
            tBest = _hit.t; nx = _hit.nx; ny = _hit.ny; nz = _hit.nz; found = true;
          }
        }
        if (!found) continue;
        const hx = cx + _dir.x * tBest, hy = cy + _dir.y * tBest, hz = cz + _dir.z * tBest;
        const rise = hy - cy;
        const ahead = (hx - cx) * fx + (hz - cz) * fz;
        if (rise < 7 || ahead < 5) continue;
        // The bottom of the arc this web would swing through: keep it low in the street canyon (~10 m up), where
        // swinging looks best, rather than climbing a little higher with every web until the buildings run out
        const bottom = hy - tBest * 0.94;
        const score = -Math.abs(tBest - 40) * 0.25 - Math.abs(rise - 26) * 0.2 - Math.abs(bottom - ground - 12) * 0.3
          + ahead * 0.2 + (s === side ? 5 : 0)
          - (ny > 0.5 ? 3 : 0); // a facade reads better than a roof edge
        if (score > bestScore) {
          bestScore = score;
          best = out;
          out.x = hx; out.y = hy; out.z = hz;
          out.nx = nx; out.ny = ny; out.nz = nz;
          out.side = s;
        }
      }
    }
  }
  return best;
}

// Keeps the follow camera out of the buildings: swinging and climbing put Spider-Man right against the facades,
// where an unobstructed chase camera would end up inside them. Pulls `camera` in along the line from `target`.
function clipCameraToBuildings(controllers, target, camera) {
  const dx = camera.x - target.x, dy = camera.y - target.y, dz = camera.z - target.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.5) return false;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  let t = dist;
  const midX = (camera.x + target.x) * 0.5, midZ = (camera.z + target.z) * 0.5;
  for (const c of controllers.nearColliders(midX, midZ, dist * 0.5 + 1)) {
    if (c.maxY < Math.min(camera.y, target.y)) continue;
    if (rayBox(c, target.x, target.y, target.z, ux, uy, uz, t, _hit)) t = _hit.t;
  }
  if (t >= dist) return false;
  const keep = Math.max(0.6, t - 0.45);
  camera.set(target.x + ux * keep, target.y + uy * keep, target.z + uz * keep);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------------------------------------------

// Everything the controller simulates (no meshes): also what the unit tests drive
function createSpiderManState(x = 0, y = 0, z = 0, heading = 0) {
  const pose = {};
  for (const name of JOINTS) pose[name] = { x: 0, y: 0, z: 0 };
  return {
    type: 'spider',
    label: 'Spider-Man',
    pose,
    position: new THREE.Vector3(x, y, z),
    velocity: new THREE.Vector3(),
    heading,
    speed: 0,
    state: 'ground', // 'ground' | 'air' | 'swing' | 'wall' (crawling) | 'wallrun'
    web: {
      phase: 'none', // 'none' | 'shooting' | 'attached'
      anchor: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      tip: new THREE.Vector3(),
      length: 0,
      targetLength: 0,
      travelled: 0,
      distance: 0,
      side: 1,
      splat: null,
      swingTime: 0,
      passedBottom: false,
      rising: false,
      dirX: 0,
      dirZ: 1
    },
    // The quick forward web of a tap (drawn for a moment, while it yanks)
    zip: { time: -1, side: 1, anchor: new THREE.Vector3(), tip: new THREE.Vector3(), cooldown: 0, pull: 0, targetSpeed: 0 },
    nextSide: 1,
    webHeld: false,
    pressTime: 0,
    webCooldown: 0,
    webRetry: 0,
    groundTime: 0,
    // Wall contact: outward normal, how high it goes, time on it, the direction of travel when it was hit, the
    // crawl direction in the wall's plane (the body's up while crawling) and how fast the stick is moving him
    wall: { nx: 0, nz: 0, top: 0, time: 0, tx: 0, tz: 0, ux: 0, uy: 1, uz: 0, move: 0 },
    // Running along / up a wall: direction (in the wall's plane) and speed
    wallRun: { dx: 0, dy: 1, dz: 0, speed: 0 },
    flip: 1,
    roll: 1,
    crouch: 0,
    runPhase: 0,
    climbPhase: 0,
    bodyQuat: new THREE.Quaternion(),
    pelvisOffset: new THREE.Vector3(0, PELVIS_HEIGHT, 0),
    onWebShot: null,
    cameraTargetOffset: new THREE.Vector3(0, 1.3, 0),
    chaseDistance: 4.6,
    chaseHeight: 1.7
  };
}

function createSpiderManEntity(scene) {
  const model = buildSpiderManModel(scene);
  scene.add(model.root);
  // Starts on 5th Ave at 37th St, looking south down the avenue to the Empire State Building
  const ent = createSpiderManState(-11.6, ISLAND_BOUNDS.sidewalkHeight, streetZ(37) + 12, 0);
  ent.mesh = model.root;
  ent.model = model;
  ent.webs = buildWebs(scene);
  return ent;
}

function resetSpiderMan(ent) {
  ent.velocity.set(0, 0, 0);
  ent.speed = 0;
  ent.state = 'ground';
  ent.web.phase = 'none';
  ent.zip.time = -1;
  ent.zip.pull = 0;
  releaseSplat(ent);
  ent.webCooldown = 0;
  ent.crouch = 0;
  ent.flip = ent.roll = 1;
  ent.bodyQuat.setFromAxisAngle(UP, ent.heading);
}

// Puts Spider-Man on the nearest rooftop of a mid-rise (12-60 m) within ~30 m of where he stands: every swing
// starts better from up high, and it's where he belongs. Stays put when there is none (parks, waterfronts).
function perchOnRooftop(controllers, ent) {
  const p = ent.position;
  for (let r = 0; r <= 30; r += 3) {
    const steps = r ? 16 : 1;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      let top = -Infinity;
      for (const c of controllers.nearColliders(x, z, 0.5)) {
        if (footprintContains(c, x, z, -1.2)) top = Math.max(top, c.maxY);
      }
      if (top >= 12 && top <= 60) {
        p.set(x, top, z);
        ent.velocity.set(0, 0, 0);
        ent.state = 'ground';
        return true;
      }
    }
  }
  return false;
}

function releaseSplat(ent) {
  if (ent.web.splat) ent.web.splat.held = false;
  ent.web.splat = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------------------------

const _center = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _anchorOut = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, side: 1 };
const _before = new THREE.Vector3();

function travelDirection(ent) {
  const v = ent.velocity;
  const h = Math.hypot(v.x, v.z);
  // While moving, the swing follows the momentum; from a standstill it follows the facing
  return h > 3 ? { x: v.x / h, z: v.z / h } : { x: Math.sin(ent.heading), z: Math.cos(ent.heading) };
}

function shootWeb(controllers, ent) {
  const p = ent.position;
  const dir = travelDirection(ent);
  const cy = p.y + 1.3;
  const web = ent.web;
  const anchor = findAnchor(controllers, p.x, cy, p.z, dir.x, dir.z, ent.nextSide, _anchorOut,
    controllers.getGroundHeight(p.x, p.z, 'person'));
  if (!anchor) {
    // Nothing to stick to: no web at all (a web only ever leaves his wrist to hit something); look again shortly
    ent.webRetry = 0.15;
    return;
  }
  web.side = anchor.side;
  ent.nextSide = -web.side; // alternate hands, like the real thing
  web.travelled = 0;
  web.swingTime = 0;
  web.passedBottom = web.rising = false;
  web.dirX = dir.x;
  web.dirZ = dir.z;
  web.phase = 'shooting';
  web.anchor.set(anchor.x, anchor.y, anchor.z);
  web.normal.set(anchor.nx, anchor.ny, anchor.nz);
  web.distance = web.anchor.distanceTo(_center.set(p.x, cy, p.z));
  // The pendulum pivot: the anchor, brought most of the way back over the line of travel (see the header)
  const ox = anchor.x - p.x, oz = anchor.z - p.z;
  const ahead = ox * dir.x + oz * dir.z;
  const latX = ox - dir.x * ahead, latZ = oz - dir.z * ahead;
  // ...and eased towards the middle of the street, so a chain of swings settles into the centre of the canyon
  const centre = canyonCentreOffset(controllers, p.x, cy, p.z, dir.x, dir.z) * 0.6;
  web.pivot.set(anchor.x - latX * PIVOT_PULL + dir.z * centre, anchor.y, anchor.z - latZ * PIVOT_PULL - dir.x * centre);
  if (typeof ent.onWebShot === 'function') ent.onWebShot(web.distance);
}

function attachWeb(controllers, ent) {
  const web = ent.web;
  const p = ent.position;
  _center.set(p.x, p.y + 1.0, p.z);
  const dist = _center.distanceTo(web.pivot);
  // Keep the bottom of the arc clear of the street: a short web reels the player up instead of dragging them
  const ground = controllers.getGroundHeight(p.x, p.z, 'person');
  web.length = dist;
  web.targetLength = Math.max(6, Math.min(dist * 0.94, web.pivot.y - ground - 4.5));
  web.phase = 'attached';
  ent.state = 'swing';
  // The splat stays on the wall while the web holds, then fades
  web.splat = ent.webs ? stickSplat(ent, web.anchor, web.normal, true) : null;
}

function releaseWeb(controllers, ent, boost) {
  const web = ent.web;
  if (web.phase === 'attached' && boost) {
    const dir = travelDirection(ent);
    const v = ent.velocity;
    const p = ent.position;
    // Letting go on the way up flings you on: an upward & forward kick, and a flip at speed. The kick fades out
    // high above the street so that chained swings stay among the buildings instead of climbing over them
    const height = p.y - controllers.getGroundHeight(p.x, p.z, 'person');
    const lift = Math.max(0, Math.min(1, (55 - height) / 30));
    v.y = Math.min(Math.max(v.y, 0) * (0.55 + 0.45 * lift) + RELEASE_BOOST_UP * lift, 15);
    v.x += dir.x * RELEASE_BOOST_FWD;
    v.z += dir.z * RELEASE_BOOST_FWD;
    if (v.length() > 20 && Math.random() < 0.55) ent.flip = 0;
  }
  web.phase = 'none';
  releaseSplat(ent);
  if (ent.state === 'swing') ent.state = 'air';
  ent.webCooldown = 0.16;
}

function clampSpeed(v) {
  const s = v.length();
  if (s > MAX_SPEED) v.multiplyScalar(MAX_SPEED / s);
}

// Rotates the horizontal velocity (and the facing) for steering in the air
function steerVelocity(ent, turn, dt) {
  if (!turn) return;
  const a = turn * AIR_TURN_RATE * dt;
  const v = ent.velocity;
  const c = Math.cos(a), s = Math.sin(a);
  const x = v.x * c + v.z * s, z = -v.x * s + v.z * c;
  v.x = x; v.z = z;
  ent.heading += a;
}

// Hands-off assist: with no steering, momentum within ~25 degrees of an avenue or a street (the world's axes follow
// Manhattan's grid) eases onto it, so a held button runs straight down the canyon instead of drifting into a wall
function alignToGrid(ent, dt) {
  const v = ent.velocity;
  if (Math.hypot(v.x, v.z) < 4) return;
  const angle = Math.atan2(v.x, v.z);
  const nearest = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  const diff = nearest - angle;
  if (Math.abs(diff) > 0.45) return;
  steerVelocity(ent, Math.sign(diff) * Math.min(Math.abs(diff) / (AIR_TURN_RATE * dt), 0.35), dt);
}

// A web splat stuck flat on a surface; `held` ones stay until let go, the rest fade over a few seconds
function stickSplat(ent, position, normal, held) {
  const splat = ent.webs.splats[ent.webs.next];
  ent.webs.next = (ent.webs.next + 1) % SPLATS;
  splat.held = held;
  splat.life = 1;
  splat.mesh.position.copy(position).addScaledVector(normal, 0.06);
  splat.mesh.quaternion.setFromUnitVectors(_offset.set(0, 0, 1), normal);
  splat.mesh.rotateZ(Math.random() * Math.PI * 2);
  splat.mesh.scale.setScalar(0.8 + Math.random() * 0.5);
  return splat;
}

// Street lights within `r` of (x, z): the luminaire heads street-details.js placed, bucketed once into 40 m cells
function nearLamps(controllers, x, z, r) {
  const sites = controllers.lampSites;
  if (!sites || !sites.length) return [];
  const CELL = 40;
  if (!controllers._lampCells || controllers._lampCellsFor !== sites) {
    controllers._lampCells = new Map();
    controllers._lampCellsFor = sites;
    for (const s of sites) {
      const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
      if (!controllers._lampCells.has(k)) controllers._lampCells.set(k, []);
      controllers._lampCells.get(k).push(s);
    }
  }
  const out = [];
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      const list = controllers._lampCells.get(`${ix},${iz}`);
      if (list) out.push(...list);
    }
  }
  return out;
}

// A tap: a web shot ahead that yanks him on, stuck to something real. A fan of rays (straight ahead first, then
// up, down and wider) looks within ~90 m for a building face, roof or ledge (as far as 30 m under his feet), and
// the street lights ahead count too; with nothing in reach the tap does nothing (a web never sticks to thin air).
function findZipTarget(controllers, cx, cy, cz, fx, fz, out, feetY = cy - 1.3) {
  const lx = fz, lz = -fx;
  const lowest = feetY - ZIP_BELOW;
  const candidates = controllers.nearColliders(cx + fx * 45, cz + fz * 45, 60).filter((c) => c.maxY > lowest);
  let best = null, bestScore = -Infinity;
  // Street lights: the lamp head itself, if it lies within the fan
  for (const lamp of nearLamps(controllers, cx + fx * 45, cz + fz * 45, 60)) {
    const dx = lamp.x - cx, dy = lamp.y - cy, dz = lamp.z - cz;
    const ahead = dx * fx + dz * fz;
    if (ahead < 6 || lamp.y < lowest) continue;
    const lat = (dx * lx + dz * lz) / ahead;
    const elev = dy / ahead;
    const dist = Math.hypot(dx, dy, dz);
    if (Math.abs(lat) > 0.5 || elev < -1.2 || elev > 0.9 || dist > ZIP_RANGE) continue;
    const score = -Math.abs(lat) * 20 - Math.abs(elev) * 8 - dist * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = out;
      out.x = lamp.x; out.y = lamp.y; out.z = lamp.z;
      out.bnx = 0; out.bny = 1; out.bnz = 0;
      out.lamp = true;
    }
  }
  for (const elev of [-1.0, -0.7, -0.45, -0.3, -0.15, -0.05, 0.08, 0.25, 0.5, 0.85]) {
    for (const lat of [0, 0.25, -0.25, 0.5, -0.5]) {
      _dir.set(fx + lx * lat, elev, fz + lz * lat).normalize();
      let t = ZIP_RANGE, found = false;
      for (const c of candidates) {
        if (rayBox(c, cx, cy, cz, _dir.x, _dir.y, _dir.z, t, _hit)) {
          t = _hit.t;
          found = true;
          out.nx = _hit.nx; out.ny = _hit.ny; out.nz = _hit.nz;
        }
      }
      if (!found || t < 6 || cy + _dir.y * t < lowest) continue;
      // Straight ahead and level reads best; nearer is snappier
      const score = -Math.abs(lat) * 20 - Math.abs(elev) * 8 - t * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = out;
        out.x = cx + _dir.x * t; out.y = cy + _dir.y * t; out.z = cz + _dir.z * t;
        out.bnx = out.nx; out.bny = out.ny; out.bnz = out.nz;
        out.lamp = false;
      }
    }
  }
  if (best) { best.nx = best.bnx; best.ny = best.bny; best.nz = best.bnz; }
  return best;
}

const _zipOut = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, bnx: 0, bny: 0, bnz: 0, lamp: false };

function webZip(controllers, ent) {
  const p = ent.position;
  const v = ent.velocity;
  const zip = ent.zip;
  const dir = travelDirection(ent);
  const cy = p.y + 1.3;
  const target = findZipTarget(controllers, p.x, cy, p.z, dir.x, dir.z, _zipOut, p.y);
  if (!target) return false;
  zip.anchor.set(target.x, target.y, target.z);
  // A splat on a wall or roof (a street light just takes the strand round its head)
  if (ent.webs && !target.lamp) stickSplat(ent, zip.anchor, _seg.set(target.nx, target.ny, target.nz), false);
  zip.time = 0;
  zip.side = ent.nextSide;
  ent.nextSide = -zip.side;
  zip.cooldown = 0.28;
  // The yank never changes his direction (not quite physics, but it keeps the flight readable): over the next
  // quarter second it builds his speed along the way he's already going and lifts against gravity (see the air
  // update), never cutting speed or stopping a fall dead
  const hs = Math.hypot(v.x, v.z);
  zip.targetSpeed = Math.max(hs, Math.min(ZIP_MAX_SPEED, Math.max(hs, 12) + ZIP_PUSH));
  zip.pull = ZIP_PULL_TIME;
  if (hs < 3) {
    // From a near standstill there's no line yet: start one along his facing
    v.x = dir.x * 3;
    v.z = dir.z * 3;
  }
  ent.state = 'air';
  ent.roll = 0;
  ent.flip = 1;
  if (typeof ent.onWebShot === 'function') ent.onWebShot(Math.hypot(target.x - p.x, target.z - p.z));
  return true;
}

// Starts running along (or up) a wall at `speed`, in direction (dx, dy, dz) within its plane
function startWallRun(ent, dx, dy, dz, speed) {
  const r = ent.wallRun;
  const len = Math.hypot(dx, dy, dz) || 1;
  r.dx = dx / len; r.dy = dy / len; r.dz = dz / len;
  r.speed = speed;
  ent.state = 'wallrun';
  ent.velocity.set(r.dx * speed, r.dy * speed, r.dz * speed);
}

// Clings to the wall, ready to crawl, head up (or `angle` round from up towards the figure's left)
function startCrawl(ent, angle = 0) {
  ent.state = 'wall';
  ent.wall.angle = angle;
  ent.wall.move = 0;
  ent.velocity.set(0, 0, 0);
}

// Kicks off the wall the way he was travelling along it (or straight out after a head-on hit), with `carry` m/s
// of momentum along the wall on top
function kickOffWall(ent, carry) {
  const w = ent.wall;
  const along = w.tx * -w.nz + w.tz * w.nx;
  const tx = Math.abs(along) > 0.25 ? -w.nz * Math.sign(along) : 0;
  const tz = Math.abs(along) > 0.25 ? w.nx * Math.sign(along) : 0;
  const v = ent.velocity;
  v.set(w.nx * 7 + tx * Math.max(14, carry), 9, w.nz * 7 + tz * Math.max(14, carry));
  ent.heading = Math.atan2(v.x, v.z);
  ent.state = 'air';
  ent.webCooldown = 0.12;
}

function updateSpiderMan(controllers, ent, dt) {
  if (dt <= 0) return;
  const keys = controllers.keys;
  const p = ent.position;
  const v = ent.velocity;
  const web = ent.web;
  const zip = ent.zip;
  const fwdIn = +keys.forward || 0;
  const backIn = +keys.backward || 0;
  const turn = (+keys.left || 0) - (+keys.right || 0);
  const held = Boolean(keys.up);
  const pressed = held && !ent.webHeld;
  const released = !held && ent.webHeld;
  const tap = released && ent.pressTime < TAP_TIME;
  if (pressed) ent.pressTime = 0;
  else if (held) ent.pressTime += dt;
  ent.webHeld = held;
  ent.webCooldown = Math.max(0, ent.webCooldown - dt);
  ent.webRetry = Math.max(0, ent.webRetry - dt);
  zip.cooldown = Math.max(0, zip.cooldown - dt);
  if (zip.time >= 0) zip.time = zip.time + dt > 0.35 ? -1 : zip.time + dt;
  ent.crouch = Math.max(0, ent.crouch - dt * 3);
  if (ent.flip < 1) ent.flip = Math.min(1, ent.flip + dt / 0.7);
  if (ent.roll < 1) ent.roll = Math.min(1, ent.roll + dt / 0.55);

  // --- Web lifecycle -----------------------------------------------------------------------------------------
  if (web.phase === 'shooting') {
    web.travelled += WEB_SPEED * dt;
    if (!held) web.phase = 'none';
    else if (web.travelled >= web.distance) attachWeb(controllers, ent);
  }
  if (web.phase === 'attached' && !held) releaseWeb(controllers, ent, v.y > -2 && !tap);

  // A tap in the air zips forward instead
  if (tap && (ent.state === 'air' || ent.state === 'swing') && zip.cooldown <= 0) {
    web.phase = 'none';
    webZip(controllers, ent);
  }

  if (ent.state === 'ground') {
    ent.groundTime += dt;
    // Holding the button through a landing launches straight into the next swing
    if (pressed || (held && ent.groundTime > 0.25)) {
      // Jump, and fire a web on the way up if the button stays down (a tap leaps on into a zip)
      v.y = 12.5;
      const dir = { x: Math.sin(ent.heading), z: Math.cos(ent.heading) };
      const hs = Math.hypot(v.x, v.z);
      v.x = dir.x * Math.max(hs, 6);
      v.z = dir.z * Math.max(hs, 6);
      ent.state = 'air';
      ent.webCooldown = 0.12;
    }
  } else {
    ent.groundTime = 0;
  }
  // In the air a held button fires the swing web (after a moment, so that a tap stays a zip)
  if (ent.state === 'air' && held && ent.pressTime >= 0.08 && web.phase === 'none' && ent.webCooldown <= 0
    && ent.webRetry <= 0) {
    shootWeb(controllers, ent);
  }

  // --- Movement per state ------------------------------------------------------------------------------------
  _before.copy(p);
  if (ent.state === 'ground') {
    ent.heading += turn * TURN_RATE * dt;
    const target = fwdIn ? RUN_SPEED * fwdIn : backIn ? -RUN_SPEED * 0.45 * backIn : 0;
    const fx = Math.sin(ent.heading), fz = Math.cos(ent.heading);
    let along = v.x * fx + v.z * fz;
    // Landing from a swing keeps its momentum for a moment, then settles into a run
    const rate = Math.abs(along) > RUN_SPEED ? 16 : 30;
    along += Math.max(-rate * dt, Math.min(rate * dt, target - along));
    v.set(fx * along, 0, fz * along);
    if (fwdIn > 0.1 || Math.abs(along) > 0.5) ent.runPhase += dt * (4 + Math.abs(along) * 0.75);
    p.x += v.x * dt;
    p.z += v.z * dt;
    const ground = groundAt(controllers, p.x, p.z, p.y);
    if (ground < p.y - 0.4) {
      ent.state = 'air'; // ran off a roof or a ledge
    } else {
      p.y = ground;
    }
  } else if (ent.state === 'air' || ent.state === 'swing') {
    v.y -= GRAVITY * dt;
    steerVelocity(ent, turn, dt);
    if (Math.abs(turn) < 0.05) alignToGrid(ent, dt);
    const dir = travelDirection(ent);
    const hs = Math.hypot(v.x, v.z);
    if (ent.state === 'air' && zip.pull > 0) {
      // A zip's pull: speed builds along the current line of travel only, with lift against gravity
      const step = Math.min(dt, zip.pull);
      zip.pull -= step;
      const accel = ZIP_PUSH / ZIP_PULL_TIME;
      const gain = Math.min(accel * step, Math.max(0, zip.targetSpeed - hs));
      v.x += dir.x * gain;
      v.z += dir.z * gain;
      if (v.y < 4) v.y = Math.min(4, v.y + ZIP_LIFT * step);
    }
    if (ent.state === 'air') {
      // Light air control and drag; terminal velocity keeps long falls readable
      if (fwdIn && hs < 16) { v.x += dir.x * 7 * fwdIn * dt; v.z += dir.z * 7 * fwdIn * dt; }
      if (backIn) { v.x *= 1 - Math.min(1, 1.5 * backIn * dt); v.z *= 1 - Math.min(1, 1.5 * backIn * dt); }
      v.y = Math.max(v.y, -42);
    } else {
      // A gentle push along the swing (more with the stick held forward) keeps chained swings flowing
      const pump = 4.5 + 6 * fwdIn;
      v.x += dir.x * pump * dt;
      v.z += dir.z * pump * dt;
    }
    clampSpeed(v);
    p.addScaledVector(v, dt);

    // Rope: an inextensible distance constraint about the pivot, measured from the hips
    if (ent.state === 'swing') {
      web.swingTime += dt;
      web.length += (web.targetLength - web.length) * (1 - Math.exp(-dt * 6));
      _center.set(p.x, p.y + 1.0, p.z);
      _offset.subVectors(_center, web.pivot);
      const d = _offset.length();
      if (d > web.length && d > 1e-4) {
        _offset.multiplyScalar(1 / d);
        _center.copy(web.pivot).addScaledVector(_offset, web.length);
        p.set(_center.x, _center.y - 1.0, _center.z);
        const radial = v.dot(_offset);
        if (radial > 0) v.addScaledVector(_offset, -radial);
      }
      // Auto-release on the way up, past the bottom of the arc: the next web follows while the button is held
      const aheadOfPivot = (p.x - web.pivot.x) * dir.x + (p.z - web.pivot.z) * dir.z;
      if (aheadOfPivot > 0) web.passedBottom = true;
      if (web.passedBottom && v.y > 3) web.rising = true;
      const rise = (p.y + 1.0 - web.pivot.y) / Math.max(1, web.length);
      // (~45 degrees up the far side, while there is still plenty of speed to carry on with)
      if ((web.rising && v.y < 2) || (web.passedBottom && rise > -0.7) || web.swingTime > 3.5 || p.y + 1.0 > web.pivot.y - 1) {
        releaseWeb(controllers, ent, true);
        ent.webCooldown = 0.12;
      } else if (web.swingTime > 0.5 && (v.x * web.dirX + v.z * web.dirZ < 1 || v.length() < 4)) {
        // Knocked back or dangling: let go rather than swing backwards, and web on afresh
        releaseWeb(controllers, ent, false);
      }
    }

    if (hs > 2) {
      const want = Math.atan2(v.x, v.z);
      let diff = want - ent.heading;
      diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
      ent.heading += diff * (1 - Math.exp(-dt * 8));
    }

    // Landing (street, sidewalk or rooftop)
    const ground = groundAt(controllers, p.x, p.z, _before.y);
    if (p.y <= ground) {
      p.y = ground;
      if (ent.state === 'swing') {
        // Dragged along the street: shorten the web so the swing lifts off again
        web.targetLength = Math.max(6, web.targetLength - 4);
        v.y = Math.max(0, v.y);
      } else {
        ent.crouch = Math.min(1, -v.y / 22);
        ent.state = 'ground';
        v.y = 0;
        ent.flip = ent.roll = 1;
      }
    }
  } else if (ent.state === 'wall') {
    // Crawling: only while the stick is held (up climbs head first, down goes down head first, the sides go
    // sideways); let go of the stick and he holds still
    const w = ent.wall;
    w.time += dt;
    const lx = -w.nz, lz = w.nx; // the figure's left as he faces the wall
    const vert = fwdIn - backIn;
    if (Math.hypot(vert, turn) > 0.12) {
      const vy = vert * (vert > 0 ? CRAWL_UP_SPEED : CRAWL_DOWN_SPEED);
      const vs = turn * CRAWL_SIDE_SPEED;
      v.set(lx * vs, vy, lz * vs);
      // The body turns head first towards where he crawls (round through the side, never flipping over)
      let diff = Math.atan2(vs, vy) - w.angle;
      diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
      w.angle += diff * (1 - Math.exp(-dt * 7));
      w.move = Math.hypot(vs, vy);
      ent.climbPhase += dt * w.move * 2.4;
    } else {
      v.set(0, 0, 0);
      w.move = 0;
    }
    p.addScaledVector(v, dt);
    ent.heading = Math.atan2(-w.nx, -w.nz);
    const ground = groundAt(controllers, p.x, p.z, p.y);
    if (pressed || (held && w.time > 0.35)) {
      kickOffWall(ent, 0);
    } else if (vert < 0 && p.y <= ground + 0.02) {
      // Down at the bottom: stand up
      p.y = ground;
      ent.state = 'ground';
    } else if (p.y + 1.1 >= w.top && vert > 0) {
      // Vault over the parapet onto the roof
      p.y = w.top;
      p.x -= w.nx * 0.9;
      p.z -= w.nz * 0.9;
      v.set(-w.nx * 4, 3.5, -w.nz * 4);
      ent.state = 'air';
      ent.flip = 1;
    }
    if (ent.state === 'wall') {
      p.y = Math.max(p.y, ground);
      // Stay pressed to the wall; lose it round a corner
      p.x -= w.nx * 0.25;
      p.z -= w.nz * 0.25;
    }
  } else if (ent.state === 'wallrun') {
    // Running along (or up) a facade, carrying the momentum he hit it with
    const w = ent.wall;
    const r = ent.wallRun;
    w.time += dt;
    const vertical = r.dy > 0.7;
    if (vertical) {
      r.speed -= GRAVITY * 0.5 * dt;
    } else {
      r.speed -= (fwdIn > 0.3 ? 0.6 : 2.0) * dt;
      // Level out along the wall
      r.dy *= Math.exp(-dt * 2.5);
      const h = Math.hypot(r.dx, r.dz) || 1;
      const k = Math.sqrt(Math.max(0, 1 - r.dy * r.dy)) / h;
      r.dx *= k; r.dz *= k;
    }
    v.set(r.dx * r.speed, r.dy * r.speed, r.dz * r.speed);
    p.addScaledVector(v, dt);
    ent.runPhase += dt * (5 + r.speed * 0.55);
    ent.heading = vertical ? Math.atan2(-w.nx, -w.nz) : Math.atan2(r.dx, r.dz);
    const ground = groundAt(controllers, p.x, p.z, _before.y);
    if (pressed || (!vertical && held && w.time > 0.3)) {
      // Kick off and carry on (holding the button through a run along a wall flows straight into the next swing)
      const carry = r.speed;
      v.set(r.dx * carry + w.nx * 7, Math.max(r.dy * carry, 0) + 7, r.dz * carry + w.nz * 7);
      ent.heading = Math.atan2(v.x, v.z);
      ent.state = 'air';
      ent.webCooldown = 0.1;
      if (carry > 16) ent.flip = 0;
    } else if (vertical && p.y + 1.4 >= w.top) {
      // Up and over the top with the run's momentum
      v.set(-w.nx * 5, Math.min(r.speed, 16) * 0.7 + 4, -w.nz * 5);
      ent.state = 'air';
      ent.flip = 0;
    } else if (r.speed < 4.5) {
      // Out of steam: cling on, head the way he was running
      const lx = -w.nz, lz = w.nx;
      startCrawl(ent, Math.atan2(r.dx * lx + r.dz * lz, r.dy));
    } else if (!vertical && p.y <= ground + 0.02) {
      // Ran down onto the street or a roof: keep running
      p.y = ground;
      v.set(r.dx * r.speed, 0, r.dz * r.speed);
      ent.state = 'ground';
    }
    if (ent.state === 'wallrun') {
      p.y = Math.max(p.y, ground);
      p.x -= w.nx * 0.25;
      p.z -= w.nz * 0.25;
    }
  }

  // --- Buildings ---------------------------------------------------------------------------------------------
  const preX = p.x, preZ = p.z;
  controllers.resolveHorizontalCollision(p, 0.42);
  const pushX = p.x - preX, pushZ = p.z - preZ;
  const push = Math.hypot(pushX, pushZ);
  const onWall = ent.state === 'wall' || ent.state === 'wallrun';
  if (push > 0.01) {
    const nx = pushX / push, nz = pushZ / push;
    const hs = Math.hypot(v.x, v.z);
    const into = v.x * nx + v.z * nz;
    const tx = v.x - nx * Math.min(0, into), tz = v.z - nz * Math.min(0, into);
    if (into < 0) { v.x -= nx * into; v.z -= nz * into; }
    if (onWall) {
      ent.wall.nx = nx; ent.wall.nz = nz;
    } else {
      // What a wall does to him: fast enough, he runs along it (or up it, head on); slower, he sticks to it.
      // Brushing one mid-swing just slides along it
      let mode = null;
      if (ent.state === 'air') mode = hs >= WALL_RUN_MIN_SPEED ? 'run' : !held || -into > 6 ? 'crawl' : null;
      else if (ent.state === 'swing') mode = -into > 4 ? (hs >= WALL_RUN_MIN_SPEED ? 'run' : 'crawl') : hs < 5 ? 'crawl' : null;
      else if (ent.state === 'ground' && fwdIn > 0.5 && -into > 1) mode = hs >= WALL_RUN_MIN_SPEED ? 'run' : 'crawl';
      const reaching = ent.state === 'air' || (ent.state === 'ground' && fwdIn > 0.5);
      const top = mode || (reaching && -into > 0.5) ? wallTopAt(controllers, p.x - nx * 0.6, p.y + 0.5, p.z - nz * 0.6) : -Infinity;
      if (reaching && top > p.y + 0.3 && top <= p.y + 2.2) {
        // A ledge within reach (a parapet, a step in the roof): pull himself up onto it
        p.set(p.x - nx * 0.7, top, p.z - nz * 0.7);
        v.set(-nx * Math.max(4, hs * 0.5), 0, -nz * Math.max(4, hs * 0.5));
        ent.state = 'ground';
        ent.crouch = 0.6;
      } else if (mode && top > p.y + 2.2) {
        if (ent.state === 'swing') releaseWeb(controllers, ent, false);
        const travel = Math.hypot(tx, tz);
        const w = ent.wall;
        w.nx = nx; w.nz = nz; w.top = top; w.time = 0;
        w.tx = travel > 1 ? tx / travel : Math.sin(ent.heading);
        w.tz = travel > 1 ? tz / travel : Math.cos(ent.heading);
        if (mode === 'run' && travel > 0.45 * hs) {
          startWallRun(ent, tx, Math.max(-0.2, Math.min(0.35, v.y / Math.max(hs, 1))) * travel, tz, Math.max(travel, hs * 0.85));
        } else if (mode === 'run') {
          startWallRun(ent, 0, 1, 0, hs * 0.8 + Math.max(0, v.y) * 0.5);
        } else {
          startCrawl(ent);
        }
        ent.heading = ent.state === 'wallrun' && ent.wallRun.dy <= 0.7 ? Math.atan2(ent.wallRun.dx, ent.wallRun.dz) : Math.atan2(-nx, -nz);
      }
    }
  } else if (onWall) {
    const w = ent.wall;
    if (v.y > 0.5) {
      // The wall ended above him (a ledge, a setback): up and over it onto the roof
      p.x -= w.nx * 0.35;
      p.z -= w.nz * 0.35;
      v.set(-w.nx * 4.5, Math.max(v.y * 0.6, 3) + 3, -w.nz * 4.5);
      if (ent.state === 'wallrun') ent.flip = 0;
    } else {
      // Nothing to hold on to any more (round a corner, or the wall ended): carry on through the air
      p.x += w.nx * 0.25;
      p.z += w.nz * 0.25;
      if (ent.state === 'wallrun') v.addScaledVector(_offset.set(w.nx, 0, w.nz), 1.5);
      else v.set(w.nx * 2, 1, w.nz * 2);
    }
    ent.state = 'air';
  }

  // A zip's pull only carries him through the air: landing, a new swing or a wall ends it
  if (ent.state !== 'air') zip.pull = 0;

  // Never below the street (tunnels, piers or a teleport onto a roof edge)
  const floor = controllers.getGroundHeight(p.x, p.z, 'person');
  if (p.y < floor) {
    p.y = floor;
    if (ent.state === 'air') { ent.state = 'ground'; v.y = 0; }
  }

  ent.speed = ent.state === 'wallrun' ? ent.wallRun.speed
    : Math.hypot(v.x, v.z, ent.state === 'swing' || ent.state === 'air' ? v.y * 0.5 : 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Animation: joint angles per state (eased), the body's orientation and pelvis placement, then the skinned body is
// posed by forward kinematics (PersonRig.poseFK). Angles are {x, y, z} Euler radians with the limbs hanging
// straight down at zero: negative x swings a limb forward, positive x bends a knee back (and negative an elbow
// forward), positive z raises the left arm sideways (negative the right).
// ---------------------------------------------------------------------------------------------------------------

function setPose(t, name, x, y, z) {
  const j = t[name];
  j.x = x; j.y = y; j.z = z;
}

// Crawling a wall, chest to it. `down`: head first down the wall, wary and splayed (shorter reaches, arms wide,
// knees out like a spider); otherwise the long alternating reach of a climb. Diagonal limbs move together.
function crawlPose(t, ent, down) {
  const c = Math.sin(ent.climbPhase);
  const lift = Math.max(0, Math.cos(ent.climbPhase)); // the reaching hand comes off the wall
  if (down) {
    setPose(t, 'spine', 0.3, 0, 0);
    setPose(t, 'neck', -0.75, 0, 0);
    setPose(t, 'shL', -0.75 - lift * 0.2, 0, 1.75 + c * 0.3);
    setPose(t, 'shR', -0.75 - (1 - lift) * 0.2, 0, -1.75 + c * 0.3);
    setPose(t, 'elL', -1.25 + c * 0.25, 0, 0);
    setPose(t, 'elR', -1.25 - c * 0.25, 0, 0);
    setPose(t, 'hipL', -0.75 - c * 0.3, 0, 0.85);
    setPose(t, 'hipR', -0.75 + c * 0.3, 0, -0.85);
    setPose(t, 'knL', 2.0 + c * 0.2, 0, 0);
    setPose(t, 'knR', 2.0 - c * 0.2, 0, 0);
    setPose(t, 'ftL', -0.4, 0, 0);
    setPose(t, 'ftR', -0.4, 0, 0);
  } else {
    setPose(t, 'spine', 0.12, 0, 0);
    setPose(t, 'neck', -0.55, 0, 0);
    setPose(t, 'shL', -0.35 - lift * 0.15, 0, 2.35 + c * 0.5);
    setPose(t, 'shR', -0.35 - (1 - lift) * 0.15, 0, -2.35 + c * 0.5);
    setPose(t, 'elL', -0.85 + c * 0.45, 0, 0);
    setPose(t, 'elR', -0.85 - c * 0.45, 0, 0);
    setPose(t, 'hipL', -1.25 + c * 0.5, 0, 0.6);
    setPose(t, 'hipR', -1.25 - c * 0.5, 0, -0.6);
    setPose(t, 'knL', 1.85 - c * 0.45, 0, 0);
    setPose(t, 'knR', 1.85 + c * 0.45, 0, 0);
    setPose(t, 'ftL', -0.3, 0, 0);
    setPose(t, 'ftR', -0.3, 0, 0);
  }
}

// Running: `amt` 0 (standing) .. 1 (sprinting), leaning into it
function runPose(t, ent, amt, lean) {
  const s = Math.sin(ent.runPhase);
  setPose(t, 'spine', lean + 0.32 * amt + ent.crouch * 0.5, 0, 0);
  setPose(t, 'neck', -0.2 * amt - ent.crouch * 0.3, 0, 0);
  setPose(t, 'hipL', -s * 1.0 * amt - ent.crouch * 1.1, 0, 0.04);
  setPose(t, 'hipR', s * 1.0 * amt - ent.crouch * 1.1, 0, -0.04);
  setPose(t, 'knL', (0.12 + Math.max(0, s) * 1.6) * amt + ent.crouch * 1.9 + 0.05, 0, 0);
  setPose(t, 'knR', (0.12 + Math.max(0, -s) * 1.6) * amt + ent.crouch * 1.9 + 0.05, 0, 0);
  setPose(t, 'ftL', Math.max(0, s) * 0.5 * amt, 0, 0);
  setPose(t, 'ftR', Math.max(0, -s) * 0.5 * amt, 0, 0);
  setPose(t, 'shL', s * 0.9 * amt - ent.crouch * 0.6, 0, 0.12 + ent.crouch * 0.5);
  setPose(t, 'shR', -s * 0.9 * amt - ent.crouch * 0.6, 0, -0.12 - ent.crouch * 0.5);
  setPose(t, 'elL', -0.2 - 1.1 * amt, 0, 0);
  setPose(t, 'elR', -0.2 - 1.1 * amt, 0, 0);
}

function targetPose(ent, t) {
  for (const name of JOINTS) setPose(t, name, 0, 0, 0);
  const v = ent.velocity;
  const web = ent.web;
  if (ent.state === 'ground') {
    const along = Math.hypot(v.x, v.z);
    runPose(t, ent, Math.min(1, along / RUN_SPEED), 0.06 + Math.sin(performance.now() * 0.002) * 0.02);
  } else if (ent.state === 'wallrun') {
    runPose(t, ent, 1, 0.15);
  } else if (ent.state === 'wall') {
    crawlPose(t, ent, Math.cos(ent.wall.angle) < -0.5);
  } else if (ent.zip.time >= 0) {
    // Zipping: the web arm thrown forward, the other tucked, legs trailing
    const s = ent.zip.side;
    const a = s > 0 ? 'L' : 'R', b = s > 0 ? 'R' : 'L';
    setPose(t, 'spine', 0.2, 0, 0);
    setPose(t, `sh${a}`, -2.9, 0, s * 0.15);
    setPose(t, `el${a}`, -0.05, 0, 0);
    setPose(t, `sh${b}`, -1.4, 0, -s * 0.5);
    setPose(t, `el${b}`, -1.6, 0, 0);
    setPose(t, 'hipL', 0.35, 0, 0.08);
    setPose(t, 'hipR', 0.15, 0, -0.08);
    setPose(t, 'knL', 0.5, 0, 0);
    setPose(t, 'knR', 0.9, 0, 0);
    setPose(t, 'ftL', 0.6, 0, 0);
    setPose(t, 'ftR', 0.6, 0, 0);
  } else if (web.phase !== 'none' || ent.state === 'swing') {
    // One arm up the web, the other out for balance, legs tucked and trailing
    const up = web.side > 0 ? 'L' : 'R';
    const free = web.side > 0 ? 'R' : 'L';
    const s = web.side > 0 ? 1 : -1;
    const swingLift = Math.max(-1, Math.min(1, v.y / 15));
    setPose(t, 'spine', 0.12, 0, 0);
    setPose(t, 'neck', 0.15, 0, 0);
    setPose(t, `sh${up}`, -0.05, 0, s * 2.95);
    setPose(t, `el${up}`, -0.06, 0, 0);
    setPose(t, `sh${free}`, -0.6, 0, -s * 1.0);
    setPose(t, `el${free}`, -0.9, 0, 0);
    setPose(t, 'hipL', -0.75 - swingLift * 0.25, 0, 0.12);
    setPose(t, 'hipR', -0.25 + swingLift * 0.35, 0, -0.12);
    setPose(t, 'knL', 1.25, 0, 0);
    setPose(t, 'knR', 0.55 - swingLift * 0.2, 0, 0);
    setPose(t, 'ftL', 0.5, 0, 0);
    setPose(t, 'ftR', 0.5, 0, 0);
  } else if (ent.flip < 1) {
    // Tucked flip after a fast release
    setPose(t, 'spine', 0.5, 0, 0);
    setPose(t, 'neck', 0.3, 0, 0);
    setPose(t, 'hipL', -1.9, 0, 0.1);
    setPose(t, 'hipR', -1.9, 0, -0.1);
    setPose(t, 'knL', 2.3, 0, 0);
    setPose(t, 'knR', 2.3, 0, 0);
    setPose(t, 'shL', -1.3, 0, 0.3);
    setPose(t, 'shR', -1.3, 0, -0.3);
    setPose(t, 'elL', -1.4, 0, 0);
    setPose(t, 'elR', -1.4, 0, 0);
    setPose(t, 'ftL', 0.5, 0, 0);
    setPose(t, 'ftR', 0.5, 0, 0);
  } else if (v.y > 0) {
    // Rising: reaching forward & up for the next web
    setPose(t, 'spine', 0.1, 0, 0);
    setPose(t, 'shL', -2.2, 0, 0.35);
    setPose(t, 'shR', -0.4, 0, -0.9);
    setPose(t, 'elL', -0.2, 0, 0);
    setPose(t, 'elR', -0.8, 0, 0);
    setPose(t, 'hipL', -0.9, 0, 0.1);
    setPose(t, 'hipR', -0.15, 0, -0.1);
    setPose(t, 'knL', 1.4, 0, 0);
    setPose(t, 'knR', 0.6, 0, 0);
    setPose(t, 'ftL', 0.4, 0, 0);
    setPose(t, 'ftR', 0.5, 0, 0);
  } else {
    // Falling: the classic spread
    setPose(t, 'spine', -0.1, 0, 0);
    setPose(t, 'neck', 0.35, 0, 0);
    setPose(t, 'shL', -0.35, 0, 1.35);
    setPose(t, 'shR', -0.35, 0, -1.35);
    setPose(t, 'elL', -0.5, 0, 0);
    setPose(t, 'elR', -0.5, 0, 0);
    setPose(t, 'hipL', -0.45, 0, 0.3);
    setPose(t, 'hipR', 0.2, 0, -0.3);
    setPose(t, 'knL', 0.9, 0, 0);
    setPose(t, 'knR', 1.2, 0, 0);
    setPose(t, 'ftL', 0.4, 0, 0);
    setPose(t, 'ftR', 0.4, 0, 0);
  }
}

const _target = {};
for (const name of JOINTS) _target[name] = { x: 0, y: 0, z: 0 };
const _qWant = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _pelvisWant = new THREE.Vector3();
const _pelvis = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _axis = new THREE.Vector3();

// Orientation of the whole figure: upright on the ground, hanging along the web while swinging, leaning into the
// flight path in the air, chest to the wall (head the way he crawls) when crawling, feet to the wall when running
// along it
function bodyOrientation(ent, out) {
  const v = ent.velocity;
  const p = ent.position;
  const web = ent.web;
  const w = ent.wall;
  const h = Math.hypot(v.x, v.z);
  _bz.set(Math.sin(ent.heading), 0, Math.cos(ent.heading));
  if (ent.state === 'wall') {
    const c = Math.cos(w.angle), s = Math.sin(w.angle);
    _bz.set(-w.nx, 0, -w.nz);
    _by.set(-w.nz * s, c, w.nx * s);
  } else if (ent.state === 'wallrun') {
    const r = ent.wallRun;
    _by.set(w.nx, 0, w.nz);
    _bz.set(r.dx, r.dy, r.dz);
  } else if (ent.state === 'swing' && web.phase === 'attached') {
    _by.set(web.anchor.x - p.x, web.anchor.y - p.y - 1.0, web.anchor.z - p.z).normalize();
    if (v.lengthSq() > 4) _bz.copy(v).normalize();
  } else if (ent.state === 'air' || ent.state === 'swing') {
    const pitch = Math.max(-0.9, Math.min(0.5, Math.atan2(v.y, Math.max(h, 1)) * 0.55));
    // Zipping: flat out along the web
    const dive = ent.zip.time >= 0 ? 0.9 : Math.sin(pitch) * 0.8;
    _by.set(0, 1, 0).addScaledVector(_bz, -dive).normalize();
  } else {
    _by.set(0, 1, 0);
  }
  _bx.crossVectors(_by, _bz);
  if (_bx.lengthSq() < 1e-6) _bx.set(Math.cos(ent.heading), 0, -Math.sin(ent.heading));
  _bx.normalize();
  _bz.crossVectors(_bx, _by).normalize();
  _m.makeBasis(_bx, _by, _bz);
  out.setFromRotationMatrix(_m);
  if (ent.flip < 1) {
    // a forward somersault after a fast release
    const e = ent.flip * ent.flip * (3 - 2 * ent.flip);
    out.multiply(_qSpin.setFromAxisAngle(_axis.set(1, 0, 0), e * Math.PI * 2));
  } else if (ent.roll < 1) {
    // a corkscrew with each zip
    const e = ent.roll * ent.roll * (3 - 2 * ent.roll);
    out.multiply(_qSpin.setFromAxisAngle(_axis.set(0, 0, 1), e * Math.PI * 2 * (ent.zip.side || 1)));
  }
  return out;
}

// Where the pelvis sits relative to the simulated position (the feet, on the ground): crouched on landing, close
// to the facade when crawling, a leg's length out from it when running along it
function pelvisOffset(ent, out) {
  const w = ent.wall;
  if (ent.state === 'wall') return out.set(-w.nx * 0.12, 1.0, -w.nz * 0.12);
  if (ent.state === 'wallrun') return out.set(w.nx * 0.55, 1.0, w.nz * 0.55);
  return out.set(0, PELVIS_HEIGHT - ent.crouch * 0.3, 0);
}

function updateSpiderManVisuals(ent, dt, active) {
  const { model, webs, web, zip } = ent;
  targetPose(ent, _target);
  const k = 1 - Math.exp(-dt * (ent.state === 'swing' ? 10 : 14));
  for (const name of JOINTS) {
    const cur = ent.pose[name], want = _target[name];
    cur.x += (want.x - cur.x) * k;
    cur.y += (want.y - cur.y) * k;
    cur.z += (want.z - cur.z) * k;
  }

  bodyOrientation(ent, _qWant);
  ent.bodyQuat.slerp(_qWant, ent.flip < 1 || ent.roll < 1 ? 1 : 1 - Math.exp(-dt * 10));
  pelvisOffset(ent, _pelvisWant);
  ent.pelvisOffset.lerp(_pelvisWant, 1 - Math.exp(-dt * 12));
  _pelvis.copy(ent.position).add(ent.pelvisOffset);

  // The skinned body, posed in world space; the hands come back for the webs
  model.rig.poseFK(ent.bodyQuat, _pelvis, ent.pose, model.hands);
  applyRigToBones(model);

  const strand = webs.strand;
  let from = null, to = null;
  if (active && web.phase !== 'none') {
    from = model.hands[web.side > 0 ? 0 : 1];
    if (web.phase === 'attached') {
      web.tip.copy(web.anchor);
    } else {
      // Flying out: the tip races to the anchor along a slight arc
      const t = Math.min(1, web.travelled / Math.max(1, web.distance));
      web.tip.lerpVectors(from, web.anchor, t);
      web.tip.y += Math.sin(t * Math.PI) * 1.2;
    }
    to = web.tip;
  } else if (active && zip.time >= 0 && zip.time < 0.3) {
    from = model.hands[zip.side > 0 ? 0 : 1];
    zip.tip.lerpVectors(from, zip.anchor, Math.min(1, zip.time / 0.07));
    to = zip.tip;
  }
  if (to) {
    _seg.subVectors(to, from);
    const len = _seg.length();
    strand.position.copy(from);
    strand.quaternion.setFromUnitVectors(UP, _seg.multiplyScalar(1 / Math.max(len, 1e-4)));
    strand.scale.set(0.028, len, 0.028);
  } else {
    strand.position.set(0, -500, 0);
    strand.scale.setScalar(0.001);
  }

  for (const splat of webs.splats) {
    if (!splat.held && splat.life > 0) splat.life = Math.max(0, splat.life - dt / 4);
    splat.mesh.material.opacity = Math.min(1, splat.life * 1.5) * 0.92;
    if (splat.life <= 0) splat.mesh.position.y = -500;
  }
  webs.group.updateMatrixWorld(true);
}

export {
  createSpiderManEntity, createSpiderManState, updateSpiderMan, updateSpiderManVisuals, resetSpiderMan,
  perchOnRooftop, clipCameraToBuildings, findAnchor, rayBox, footprintContains
};
