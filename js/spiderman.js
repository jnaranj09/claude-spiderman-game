import * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS, streetZ } from './city-config.js';

// js/spiderman.js
// Spider-Man: a procedurally sculpted, articulated hero and an arcade web-swinging controller.
//
// The swing is a real pendulum (gravity + an inextensible rope, solved as a distance constraint), with two
// tricks layered on top to keep it readable and easy to play:
//  1. The web is ray cast against the actual building colliders, so its end and the web splat sit on a real
//     facade or roof edge. The pendulum's pivot, though, is that anchor pulled most of the way back over the
//     player's line of travel: the rope still visibly ends on the building, but the swing carries along the
//     street instead of slamming sideways into the wall the web hit.
//  2. Holding the web button chains swings: each swing lets go on its own on the way up and fires the next web,
//     so one thumb is enough to cross Midtown. The stick (or W/A/S/D) only steers and pumps.

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
const WALL_CLIMB_SPEED = 10;
const SPLATS = 8;

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------

// The suit's red panels: raised black webbing over the red
function createSuitWebTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c3141e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(28, 4, 6, 0.85)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i <= 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
  }
  ctx.lineWidth = 1.6;
  for (let j = 0; j <= 256; j += 24) {
    ctx.beginPath();
    for (let i = 0; i <= 256; i += 32) {
      // little sagging arcs between the vertical strands, like the webbing on the suit
      ctx.moveTo(i, j);
      ctx.quadraticCurveTo(i + 16, j + 6, i + 32, j);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  return tex;
}

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
// Model: a jointed figure (hips -> spine -> head / shoulders -> elbows -> hands, hips -> knees -> feet), facing +Z
// ---------------------------------------------------------------------------------------------------------------

function buildSpiderManModel() {
  const red = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, map: createSuitWebTexture(), roughness: 0.5, metalness: 0.0 });
  const blue = new THREE.MeshStandardNodeMaterial({ color: 0x1a2f86, roughness: 0.42, metalness: 0.05 });
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0e, roughness: 0.35 });
  const lens = new THREE.MeshStandardNodeMaterial({ color: 0xf4f6ff, roughness: 0.15, emissive: 0x9aa6c4, emissiveIntensity: 0.25 });

  const capsule = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  const sphere = (r, mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

  const root = new THREE.Group();
  root.name = 'PlayerSpiderMan';
  const body = new THREE.Group(); // pivots at the hips; the swing tilts the whole figure about it
  body.position.y = 1.02;
  root.add(body);

  // Pelvis & belt
  const pelvis = at(capsule(0.13, 0.1, blue), 0, 0, 0);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1.3, 0.9);
  body.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = 0.08;
  body.add(spine);
  const chest = at(capsule(0.15, 0.28, red), 0, 0.25, 0);
  chest.scale.set(1.3, 1, 0.82);
  spine.add(chest);
  // Blue flanks under the arms
  for (const s of [-1, 1]) {
    const flank = at(capsule(0.06, 0.24, blue), s * 0.15, 0.2, 0);
    flank.scale.set(1, 1, 1.6);
    spine.add(flank);
  }
  // Chest spider emblem
  const emblem = at(sphere(0.035, black), 0, 0.32, 0.118);
  emblem.scale.set(0.8, 1.5, 0.35);
  spine.add(emblem);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const leg = at(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.008), black), s * 0.04, 0.35 - i * 0.022, 0.118);
      leg.rotation.z = s * (0.7 - i * 0.45);
      spine.add(leg);
    }
  }

  // Head with the big white lenses
  const neck = new THREE.Group();
  neck.position.y = 0.55;
  spine.add(neck);
  const head = at(sphere(0.115, red), 0, 0.12, 0);
  head.scale.set(0.95, 1.18, 1.0);
  neck.add(head);
  for (const s of [-1, 1]) {
    const rim = at(sphere(0.04, black), s * 0.047, 0.135, 0.092);
    rim.scale.set(1.15, 0.82, 0.45);
    rim.rotation.z = s * 0.55;
    neck.add(rim);
    const eye = at(sphere(0.034, lens), s * 0.047, 0.135, 0.1);
    eye.scale.set(1.1, 0.75, 0.4);
    eye.rotation.z = s * 0.55;
    neck.add(eye);
  }

  // Arms: shoulder (x, y, z) -> elbow (x) -> hand
  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.215, 0.44, 0);
    spine.add(shoulder);
    shoulder.add(at(sphere(0.07, red), 0, 0, 0));
    shoulder.add(at(capsule(0.055, 0.2, blue), 0, -0.15, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(at(capsule(0.047, 0.2, red), 0, -0.13, 0));
    const hand = new THREE.Group();
    hand.position.y = -0.29;
    elbow.add(hand);
    hand.add(at(sphere(0.055, red), 0, 0, 0));
    return { shoulder, elbow, hand };
  };
  // Legs: hip (x, z) -> knee (x) -> foot
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    body.add(hip);
    hip.add(at(capsule(0.078, 0.3, blue), 0, -0.22, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    knee.add(at(capsule(0.06, 0.32, red), 0, -0.22, 0));
    const foot = at(capsule(0.05, 0.12, red), 0, -0.47, 0.05);
    foot.rotation.x = Math.PI / 2;
    knee.add(foot);
    return { hip, knee };
  };

  const left = arm(1), right = arm(-1); // the figure's left is +X (it faces +Z)
  const legL = leg(1), legR = leg(-1);

  return {
    root,
    body,
    joints: {
      spine, neck,
      shL: left.shoulder, elL: left.elbow, handL: left.hand,
      shR: right.shoulder, elR: right.elbow, handR: right.hand,
      hipL: legL.hip, knL: legL.knee,
      hipR: legR.hip, knR: legR.knee
    }
  };
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

function createSpiderManEntity(scene) {
  const model = buildSpiderManModel();
  scene.add(model.root);
  const webs = buildWebs(scene);
  const joints = {};
  for (const name of Object.keys(model.joints)) joints[name] = { x: 0, y: 0, z: 0 };

  return {
    type: 'spider',
    label: 'Spider-Man',
    mesh: model.root,
    model,
    webs,
    pose: joints,
    // Starts on 5th Ave at 37th St, looking south down the avenue to the Empire State Building
    position: new THREE.Vector3(-11.6, ISLAND_BOUNDS.sidewalkHeight, streetZ(37) + 12),
    velocity: new THREE.Vector3(),
    heading: 0,
    speed: 0,
    state: 'ground', // 'ground' | 'air' | 'swing' | 'wall'
    web: {
      phase: 'none', // 'none' | 'shooting' | 'attached' | 'miss'
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
    nextSide: 1,
    webHeld: false,
    webCooldown: 0,
    webRetry: 0,
    groundTime: 0,
    wall: { nx: 0, nz: 0, top: 0, time: 0, tx: 0, tz: 0 },
    flip: 1,
    crouch: 0,
    runPhase: 0,
    climbPhase: 0,
    bodyQuat: new THREE.Quaternion(),
    onWebShot: null,
    cameraTargetOffset: new THREE.Vector3(0, 1.3, 0),
    chaseDistance: 4.6,
    chaseHeight: 1.7
  };
}

function resetSpiderMan(ent) {
  ent.velocity.set(0, 0, 0);
  ent.speed = 0;
  ent.state = 'ground';
  ent.web.phase = 'none';
  releaseSplat(ent);
  ent.webCooldown = 0;
  ent.crouch = 0;
  ent.flip = 1;
  ent.bodyQuat.setFromAxisAngle(UP, 0);
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
  web.side = anchor ? anchor.side : ent.nextSide;
  ent.nextSide = -web.side; // alternate hands, like the real thing
  web.travelled = 0;
  web.swingTime = 0;
  web.passedBottom = web.rising = false;
  web.dirX = dir.x;
  web.dirZ = dir.z;
  if (!anchor) {
    // Nothing to stick to: the web flies out and falls short, and the player keeps falling
    web.phase = 'miss';
    web.anchor.set(p.x + dir.x * 30, cy + 26, p.z + dir.z * 30);
    web.distance = web.anchor.distanceTo(_center.set(p.x, cy, p.z));
    ent.webRetry = 0.3;
    return;
  }
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
  const splat = ent.webs.splats[ent.webs.next];
  ent.webs.next = (ent.webs.next + 1) % SPLATS;
  splat.held = true;
  splat.life = 1;
  splat.mesh.position.copy(web.anchor).addScaledVector(web.normal, 0.06);
  splat.mesh.quaternion.setFromUnitVectors(_offset.set(0, 0, 1), web.normal);
  splat.mesh.rotateZ(Math.random() * Math.PI * 2);
  splat.mesh.scale.setScalar(0.8 + Math.random() * 0.5);
  web.splat = splat;
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

function updateSpiderMan(controllers, ent, dt) {
  if (dt <= 0) return;
  const keys = controllers.keys;
  const p = ent.position;
  const v = ent.velocity;
  const web = ent.web;
  const fwdIn = +keys.forward || 0;
  const backIn = +keys.backward || 0;
  const turn = (+keys.left || 0) - (+keys.right || 0);
  const held = Boolean(keys.up);
  const pressed = held && !ent.webHeld;
  ent.webHeld = held;
  ent.webCooldown = Math.max(0, ent.webCooldown - dt);
  ent.webRetry = Math.max(0, ent.webRetry - dt);
  ent.crouch = Math.max(0, ent.crouch - dt * 3);
  if (ent.flip < 1) ent.flip = Math.min(1, ent.flip + dt / 0.7);

  // --- Web lifecycle -----------------------------------------------------------------------------------------
  if (web.phase === 'shooting' || web.phase === 'miss') {
    web.travelled += WEB_SPEED * dt;
    if (web.phase === 'shooting' && !held) web.phase = 'none';
    else if (web.travelled >= web.distance) {
      if (web.phase === 'shooting') attachWeb(controllers, ent);
      else web.phase = 'none';
    }
  }
  if (web.phase === 'attached' && !held) releaseWeb(controllers, ent, v.y > -2);

  if (ent.state === 'ground') {
    ent.groundTime += dt;
    // Holding the button through a landing launches straight into the next swing
    if (pressed || (held && ent.groundTime > 0.25)) {
      // Jump, and fire a web on the way up if the button stays down
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
  if (ent.state === 'air' && held && web.phase === 'none' && ent.webCooldown <= 0 && ent.webRetry <= 0) {
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
        ent.flip = 1;
      }
    }
  } else if (ent.state === 'wall') {
    // Clinging to a facade: climb up on its own (the stick slides you sideways, back drops you off)
    const w = ent.wall;
    const sideX = -w.nz, sideZ = w.nx; // along the wall, to the figure's right... sign doesn't matter for the stick
    const climb = backIn > 0.3 ? -4 : WALL_CLIMB_SPEED * (0.6 + 0.4 * fwdIn);
    v.set(sideX * -turn * 5, climb, sideZ * -turn * 5);
    p.addScaledVector(v, dt);
    ent.climbPhase += dt * Math.abs(climb) * 1.6;
    ent.heading = Math.atan2(-w.nx, -w.nz);
    w.time += dt;
    if (pressed || (held && w.time > 0.35)) {
      // Kick off the wall and web on: carried on along the street the way you were going, or back out if you
      // hit it head on
      const along = w.tx * -w.nz + w.tz * w.nx;
      const tx = Math.abs(along) > 0.25 ? -w.nz * Math.sign(along) : 0;
      const tz = Math.abs(along) > 0.25 ? w.nx * Math.sign(along) : 0;
      v.set(w.nx * 7 + tx * 14, 10, w.nz * 7 + tz * 14);
      ent.heading = Math.atan2(v.x, v.z);
      ent.state = 'air';
      ent.webCooldown = 0.15;
    } else if (backIn > 0.6 && p.y < _before.y) {
      const ground = groundAt(controllers, p.x, p.z, p.y);
      if (p.y <= ground + 0.05) { p.y = ground; ent.state = 'ground'; }
    }
    if (ent.state === 'wall' && p.y + 1.1 >= w.top) {
      // Vault over the parapet onto the roof
      p.y = w.top;
      p.x -= w.nx * 0.9;
      p.z -= w.nz * 0.9;
      v.set(-w.nx * 4, 3.5, -w.nz * 4);
      ent.state = 'air';
      ent.flip = 1;
    }
    if (ent.state === 'wall') {
      // Stay pressed to the wall; lose it round a corner
      p.x -= w.nx * 0.25;
      p.z -= w.nz * 0.25;
    }
  }

  // --- Buildings ---------------------------------------------------------------------------------------------
  const preX = p.x, preZ = p.z;
  controllers.resolveHorizontalCollision(p, 0.42);
  const pushX = p.x - preX, pushZ = p.z - preZ;
  const push = Math.hypot(pushX, pushZ);
  if (push > 0.01) {
    const nx = pushX / push, nz = pushZ / push;
    const into = v.x * nx + v.z * nz;
    if (into < 0) { v.x -= nx * into; v.z -= nz * into; }
    // Brushing a wall mid-chain doesn't stop the swing; flying into one (or letting go near one) sticks to it
    if ((ent.state === 'air' && (!held || -into > 6)) || (ent.state === 'ground' && fwdIn > 0.5 && -into > 1)
      || (ent.state === 'swing' && (-into > 10 || Math.hypot(v.x, v.z) < 5))) {
      const top = wallTopAt(controllers, p.x - nx * 0.6, p.y + 0.5, p.z - nz * 0.6);
      if (top > p.y + 2.2) {
        if (ent.state === 'swing') releaseWeb(controllers, ent, false);
        const dir = travelDirection(ent);
        ent.state = 'wall';
        ent.wall.nx = nx; ent.wall.nz = nz; ent.wall.top = top;
        ent.wall.time = 0; ent.wall.tx = dir.x; ent.wall.tz = dir.z;
        ent.heading = Math.atan2(-nx, -nz);
        v.set(0, 0, 0);
      }
    } else if (ent.state === 'wall') {
      ent.wall.nx = nx; ent.wall.nz = nz;
    }
  } else if (ent.state === 'wall') {
    // Nothing to hold on to any more (round a corner, or the wall ended): drop off it
    p.x += ent.wall.nx * 0.25;
    p.z += ent.wall.nz * 0.25;
    v.set(ent.wall.nx * 2, 1, ent.wall.nz * 2);
    ent.state = 'air';
  }

  // Never below the street (tunnels, piers or a teleport onto a roof edge)
  const floor = controllers.getGroundHeight(p.x, p.z, 'person');
  if (p.y < floor) { p.y = floor; if (ent.state !== 'wall' && ent.state !== 'swing') { ent.state = 'ground'; v.y = 0; } }

  ent.speed = Math.hypot(v.x, v.z, ent.state === 'swing' || ent.state === 'air' ? v.y * 0.5 : 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------------------------------------------

function setPose(t, name, x, y, z) {
  const j = t[name];
  j.x = x; j.y = y; j.z = z;
}

function targetPose(ent, t) {
  for (const name of Object.keys(t)) setPose(t, name, 0, 0, 0);
  const v = ent.velocity;
  const web = ent.web;
  if (ent.state === 'ground') {
    const along = Math.hypot(v.x, v.z);
    const amt = Math.min(1, along / RUN_SPEED);
    const s = Math.sin(ent.runPhase);
    const breathe = Math.sin(performance.now() * 0.002) * 0.03;
    setPose(t, 'spine', 0.08 + 0.32 * amt + breathe + ent.crouch * 0.5, 0, 0);
    setPose(t, 'neck', -0.2 * amt - ent.crouch * 0.3, 0, 0);
    setPose(t, 'hipL', -s * 0.95 * amt - ent.crouch * 1.1, 0, 0.04);
    setPose(t, 'hipR', s * 0.95 * amt - ent.crouch * 1.1, 0, -0.04);
    setPose(t, 'knL', (0.12 + Math.max(0, s) * 1.5) * amt + ent.crouch * 1.9 + 0.05, 0, 0);
    setPose(t, 'knR', (0.12 + Math.max(0, -s) * 1.5) * amt + ent.crouch * 1.9 + 0.05, 0, 0);
    setPose(t, 'shL', s * 0.85 * amt - ent.crouch * 0.6, 0, 0.14 + ent.crouch * 0.5);
    setPose(t, 'shR', -s * 0.85 * amt - ent.crouch * 0.6, 0, -0.14 - ent.crouch * 0.5);
    setPose(t, 'elL', -0.25 - 0.9 * amt, 0, 0);
    setPose(t, 'elR', -0.25 - 0.9 * amt, 0, 0);
  } else if (ent.state === 'wall') {
    const c = Math.sin(ent.climbPhase);
    setPose(t, 'spine', -0.05, 0, 0);
    setPose(t, 'neck', -0.45, 0, 0);
    setPose(t, 'shL', -0.2, 0, 2.5 + c * 0.35);
    setPose(t, 'shR', -0.2, 0, -2.5 + c * 0.35);
    setPose(t, 'elL', -0.9 - c * 0.3, 0, 0);
    setPose(t, 'elR', -0.9 + c * 0.3, 0, 0);
    setPose(t, 'hipL', -1.0 + c * 0.45, 0, 0.55);
    setPose(t, 'hipR', -1.0 - c * 0.45, 0, -0.55);
    setPose(t, 'knL', 1.7 - c * 0.3, 0, 0);
    setPose(t, 'knR', 1.7 + c * 0.3, 0, 0);
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
  }
}

const _target = {};
const _qYaw = new THREE.Quaternion();
const _qWant = new THREE.Quaternion();
const _qFlip = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _seg = new THREE.Vector3();

// Orientation of the whole figure: upright on the ground and walls, hanging along the web while swinging,
// leaning into the flight path in the air
function bodyOrientation(ent, out) {
  const v = ent.velocity;
  const p = ent.position;
  const web = ent.web;
  const h = Math.hypot(v.x, v.z);
  _bz.set(Math.sin(ent.heading), 0, Math.cos(ent.heading));
  if (ent.state === 'swing' && web.phase === 'attached') {
    _by.set(web.anchor.x - p.x, web.anchor.y - p.y - 1.0, web.anchor.z - p.z).normalize();
    if (v.lengthSq() > 4) _bz.copy(v).normalize();
  } else if (ent.state === 'air' || ent.state === 'swing') {
    const pitch = Math.max(-0.9, Math.min(0.5, Math.atan2(v.y, Math.max(h, 1)) * 0.55));
    _by.set(0, 1, 0).addScaledVector(_bz, -Math.sin(pitch) * 0.8).normalize();
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
    const e = ent.flip * ent.flip * (3 - 2 * ent.flip);
    out.multiply(_qFlip.setFromAxisAngle(_bx.set(1, 0, 0), e * Math.PI * 2));
  }
  return out;
}

function updateSpiderManVisuals(ent, dt, active) {
  const { model, webs, web } = ent;
  if (!_target.spine) for (const name of Object.keys(ent.pose)) _target[name] = { x: 0, y: 0, z: 0 };
  targetPose(ent, _target);
  const k = 1 - Math.exp(-dt * (ent.state === 'swing' ? 10 : 14));
  for (const name of Object.keys(ent.pose)) {
    const cur = ent.pose[name], want = _target[name], joint = model.joints[name];
    cur.x += (want.x - cur.x) * k;
    cur.y += (want.y - cur.y) * k;
    cur.z += (want.z - cur.z) * k;
    joint.rotation.set(cur.x, cur.y, cur.z);
  }

  bodyOrientation(ent, _qWant);
  ent.bodyQuat.slerp(_qWant, ent.flip < 1 ? 1 : 1 - Math.exp(-dt * 10));
  _qYaw.setFromAxisAngle(UP, ent.heading).invert();
  model.body.quaternion.copy(_qYaw).multiply(ent.bodyQuat);

  // The scene's matrices only update once per frame, after the controllers: the web needs the hand now
  model.root.updateMatrixWorld(true);

  const strand = webs.strand;
  if (active && web.phase !== 'none') {
    const hand = web.side > 0 ? model.joints.handL : model.joints.handR;
    hand.getWorldPosition(_hand);
    if (web.phase === 'attached') {
      web.tip.copy(web.anchor);
    } else {
      // Flying out: the tip races to the anchor along a slight arc
      const t = Math.min(1, web.travelled / Math.max(1, web.distance));
      web.tip.lerpVectors(_hand, web.anchor, t);
      web.tip.y += Math.sin(t * Math.PI) * 1.2 - (web.phase === 'miss' ? t * t * 8 : 0);
    }
    _seg.subVectors(web.tip, _hand);
    const len = _seg.length();
    strand.position.copy(_hand);
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

export { createSpiderManEntity, updateSpiderMan, updateSpiderManVisuals, resetSpiderMan, perchOnRooftop, clipCameraToBuildings, findAnchor, rayBox, footprintContains };
