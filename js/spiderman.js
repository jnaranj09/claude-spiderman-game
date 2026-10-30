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
//  2. One press, one web: he stays on it for as long as the button is held, swinging back and forth like a real
//     pendulum, and lets go when it is released (best on the way up the far side). The next swing takes a new
//     press. The stick (or W/A/S/D) only steers and pumps.
// A quick tap of the button zips a web straight ahead and yanks him forward (it works over open ground too); flying
// into a wall at speed runs along it (or up it) instead of stopping dead, and a slow touch sticks to it to crawl.

const GRAVITY = 22;              // m/s². Stronger than real gravity: a 40 m swing takes ~3 s instead of ~6 s
const MAX_SPEED = 48;            // m/s
const RUN_SPEED = 13;
const GROUND_TURN_RATE = 10;     // rad/s turning to face the stick on the ground (an about-face in ~0.3 s)
const AIR_TURN_RATE = 1.5;       // rad/s while swinging or falling
const WEB_SPEED = 260;           // m/s: how fast the web travels to its anchor
const WEB_RANGE = 115;           // m
const ARC_WEB = 60;              // m: the web length a swing prefers high up...
const ARC_WEB_SHORT = 30;        // ...and low down
const ARC_FLAT = 0.55;           // rad above level the web prefers high up (~32 degrees)...
const ARC_STEEP = 1.1;           // ...and low down (~63 degrees)
const ARC_LOW = 4;               // m above the street where he's "low"...
const ARC_HIGH = 40;             // ...and where he's "high" (between the two, everything slides)
const ZIG_MARGIN = 4;            // m: a chosen-hand swing ends at least this far short of the facade...
const ZIG_REACH = 9;             // m: ...and carries him at most this far across
const ZIG_SHARE = 0.33;          // the pivot's share of that: the swing and the flight after it carry him the rest
const DOUBLE_BOOST = 1.4;        // the release fling of a double web, against a single one
const SCRAPE_PENALTY = 1.2;       // score lost per metre an anchor's arc would dip below the street
const COURSE_RATE = 0.9;         // 1/s: how fast that smoothed line of travel follows the real one
const COURSE_SNAP = 0.6;          // rad: a line of travel this close to the grid counts as along the street
const NEAR_SIDE = 0.7;           // score lost per metre the anchor lies across the street
const FACING_PENALTY = 14;       // score lost by a facade turned straight at him
const ROD_RATE = 6;              // 1/s: how fast moving in towards the anchor turns into swinging, as a web catches
const ROPE_CATCH = 0.45;         // s: the web is springy this long as it catches, then rigid
const ROPE_SOFT = 80;            // 1/s²: its springiness as it starts to take his weight...
const ROPE_STIFF = 600;          // ...firming up to this
const ROPE_MAX_STRETCH = 3;      // m
const SWING_TURN_SPEED = 1.5;    // m/s back along the swing before he turns to face the other way
const AIR_LEAN = 0.45;           // rad: how far forward he leans flying at speed
const PIVOT_PULL = 0.95;         // share of the anchor's sideways offset the pendulum pivot moves back over the path
const RELEASE_BOOST_UP = 5.5;
const RELEASE_BOOST_FWD = 5.0;
const RELEASE_RISE = 0.5;        // a held swing lets go once he's up past this (cosine of ~60 degrees) on the far side
const RELEASE_LIFT_CEILING = 68; // m above the street: the release's upward fling fades out towards this height
const DIVE_GRAVITY = 2.2;        // gravity multiplier while diving
const DIVE_MAX_FALL = 60;        // m/s
const CRAWL_UP_SPEED = 4.2;      // m/s on a wall, only while the stick is held
const CRAWL_DOWN_SPEED = 3.2;
const CRAWL_SIDE_SPEED = 3.6;
const WALL_RUN_MIN_SPEED = 9;    // hitting a wall faster than this runs along / up it
const WALL_RUN_STEER = 3.5;      // how fast the stick turns a run across the wall's face (1/s)
const WALL_RUN_BRAKE = 7;        // m/s² a run loses with the stick let go (until he stops and clings on)
const WALL_RUN_MAX = 30;         // m/s, running down a wall
const WALL_ZIP_SPEED = 15;       // m/s a web pulled along the wall adds to a crawl...
const WALL_ZIP_DECAY = 14;       // ...fading at this rate (m/s²)
const WALL_ZIP_CONE = 1.75;      // rad: a stick within this of the way he's crawling zips along the wall; past it he jumps off
const WALL_JUMP_OUT = 12;        // m/s away from the wall jumping off it...
const WALL_JUMP_UP = 7;          // ...and upwards
const TAP_TIME = 0.2;            // s: a press shorter than this is a tap (web zip)
const ZIP_PUSH = 14;             // m/s forward per zip
const ZIP_MAX_SPEED = 44;
const ZIP_PULL_TIME = 0.25;      // s: the zip's push builds up over this long instead of all at once
const ZIP_LIFT = 60;             // m/s² upward during the pull (against gravity's 22): a small hop up, as if he hauled
                                 // himself up the web; a fall is softened, never stopped dead
const ZIP_SOFT_CAP = 32;          // m/s: the speed by which a zip's push has faded to almost nothing
const ZIP_RISE = 9.5;            // m/s: the upward speed the pull lifts him to (about 3 m of height)...
const ZIP_RISE_UP = 6;           // ...and up to this much more for a web aimed steeply up
const ZIP_AIM_LOW = 0.7;         // how far up (rise per metre ahead) a zip aims from the street...
const ZIP_AIM_HEIGHT = 30;       // ...levelling out by this height
const ZIP_CHAIN = 3;             // zips in a row before he has to land, swing or touch a wall
const ZIP_BELOW = 8;             // m: how far under his feet a roof, ledge or street light can be for a zip to stick to it
const ZIP_RANGE = 90;            // m
const SLING_PAIR = 0.09;          // s: from the ground, the other web button joining within this makes a slingshot
const SLING_REACH = 60;          // m: how far ahead the slingshot's webs look for something to stick to...
const SLING_RISE = 18;           // ...preferring a point about this far above him
const SLING_BACK_SPEED = 1.6;    // m/s backing away from the anchors (stick fully down), slowing as the webs stretch
const SLING_DRAW = 7;            // m: the furthest he can pull the webs back
const SLING_MIN_DRAW = 0.6;      // m: let go short of this and the webs just drop
const SLING_LAUNCH_MIN = 16;     // m/s at a short pull...
const SLING_LAUNCH_MAX = 46;     // ...and drawn all the way back
const SLING_SIDE_SPEED = 1.4;    // m/s stepping sideways with the stick, swinging the aim round the other way...
const SLING_AIM_MAX = 0.8;       // ...up to this far (rad) round from where he first aimed
const GLIDE_ANGLE = 0.12;        // rad: the shallow downward path of a glide, hands off (a sink of about 3.4 m/s)
const GLIDE_SPEED = 28;          // m/s: the speed a hands-off glide settles at
const GLIDE_DIVE = 0.55;         // rad: how much further the nose goes down with the stick pushed on
const GLIDE_CLIMB = 0.4;         // rad: how far up it comes with the stick pulled back
const GLIDE_STALL = 14;          // m/s: near this the wings can't hold the nose up and it drops
const GLIDE_PITCH_RATE = 1.6;    // rad/s: how fast the path follows the nose (slower near a stall)
const GLIDE_TURN = 1.6;          // rad/s banking round
const WHIP_ANGLE = 1.0;          // rad: a held web with the stick this far off his line of travel whips round a corner
const WHIP_REACH = 32;           // m: how far ahead that corner can be...
const WHIP_RADIUS_MIN = 4;       // ...and how far across, in towards the turn: the radius he swings round it
const WHIP_RADIUS_MAX = 28;
const WHIP_GRAVITY = 0.3;        // share of gravity he feels whipping round (the web's a little above him)
const WHIP_MIN_SPEED = 16;       // m/s: the least he goes round a corner at
const WHIP_DONE = 0.2;           // rad: lets go once he's heading this close to where the stick points
const CAMERA_LOCK = 0.8;         // s: the follow camera stays locked on after a whip, a vault onto a roof, a corner
const ZIP_TURN_MIN = 0.35;       // rad: a tap with the stick this far off his line of travel zips that way...
const ZIP_TURN = 0.8;            // ...turning his flight by up to this much
const ZIP_TURN_COST = 0.92;      // the share of his speed the turn keeps
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

// The web line: a few hair-thin fibres (a core and two twisted round it, plus three that only show where the
// line frays out into a fan on the wall), each a three-sided tube. Rebuilt in place every frame it's drawn.
const FIBRES = [
  // radius, distance from the core, twist phase, shade
  { r: 0.0075, off: 0, phase: 0, shade: 1 },
  { r: 0.0045, off: 0.014, phase: 0, shade: 0.86 },
  { r: 0.0045, off: 0.014, phase: Math.PI, shade: 0.9 },
  { r: 0.0035, off: 0.004, phase: Math.PI * 0.5, shade: 0.82 },
  { r: 0.0035, off: 0.004, phase: Math.PI * 1.2, shade: 0.88 },
  { r: 0.0035, off: 0.004, phase: Math.PI * 1.7, shade: 0.84 }
];
const STRAND_MAIN = 72;  // segments along the line up to the fray
const STRAND_FRAY = 14;  // segments through the fray
const STRAND_RINGS = STRAND_MAIN + STRAND_FRAY + 1;

function buildStrand() {
  const geo = new THREE.BufferGeometry();
  const verts = FIBRES.length * STRAND_RINGS * 3;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const index = [];
  FIBRES.forEach((f, i) => {
    const base = i * STRAND_RINGS * 3;
    for (let k = 0; k < STRAND_RINGS * 3; k++) {
      // A little lighter on one side of each fibre, so the twist reads
      const c = f.shade * (k % 3 === 0 ? 1 : 0.8);
      col.set([c * 0.96, c * 0.97, c], (base + k) * 3);
    }
    for (let ring = 0; ring < STRAND_RINGS - 1; ring++) {
      for (let side = 0; side < 3; side++) {
        const a = base + ring * 3 + side, b = base + ring * 3 + (side + 1) % 3;
        index.push(a, a + 3, b, b, a + 3, b + 3);
      }
    }
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

const _sd = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _fu = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _sp = new THREE.Vector3();

// Lays the strand from `from` to `to` (positions relative to `from`, where the mesh sits). `fray` (0..1) fans the
// end out over the surface with outward normal `normal` (a zero normal fans it round the line itself)
function layStrand(mesh, from, to, fray, normal) {
  const pos = mesh.geometry.attributes.position;
  const arr = pos.array;
  mesh.position.copy(from);
  _sd.subVectors(to, from);
  const len = Math.max(_sd.length(), 1e-3);
  _sd.multiplyScalar(1 / len);
  // A frame round the line...
  _sa.set(Math.abs(_sd.y) < 0.9 ? 0 : 1, Math.abs(_sd.y) < 0.9 ? 1 : 0, 0).cross(_sd).normalize();
  _sb.crossVectors(_sd, _sa);
  // ...and one in the surface it sticks to, for the fan
  if (normal.lengthSq() > 0.5) {
    _fu.set(Math.abs(normal.y) < 0.9 ? 0 : 1, Math.abs(normal.y) < 0.9 ? 1 : 0, 0).cross(normal).normalize();
    _fw.crossVectors(normal, _fu);
  } else {
    _fu.copy(_sa);
    _fw.copy(_sb);
  }
  const frayLen = Math.min(1.6, len * 0.2) * fray;
  const mainLen = len - frayLen;
  // Twisted, but no more turns than the segments can draw
  const twist = Math.min(len / 0.9, STRAND_MAIN / 6) * Math.PI * 2 / len;
  FIBRES.forEach((f, i) => {
    // Where this fibre lands in the fan: the core in the middle, the others spread around it
    const fanAngle = f.phase + i * 0.7;
    const fanR = i === 0 ? 0 : 0.18 + 0.07 * (i % 3);
    for (let ring = 0; ring < STRAND_RINGS; ring++) {
      const d = ring <= STRAND_MAIN ? mainLen * ring / STRAND_MAIN
        : mainLen + frayLen * (ring - STRAND_MAIN) / STRAND_FRAY;
      const s = frayLen > 0 ? Math.max(0, (d - mainLen) / frayLen) : 0;
      const spread = s * s * (3 - 2 * s);
      const ang = f.phase + d * twist;
      const off = f.off * (1 - spread);
      _sp.copy(_sd).multiplyScalar(d)
        .addScaledVector(_sa, Math.cos(ang) * off).addScaledVector(_sb, Math.sin(ang) * off)
        .addScaledVector(_fu, Math.cos(fanAngle) * fanR * spread).addScaledVector(_fw, Math.sin(fanAngle) * fanR * spread);
      // The fibres taper a little towards the fan
      const r = f.r * (1 - 0.4 * spread);
      for (let side = 0; side < 3; side++) {
        const t = side * Math.PI * 2 / 3;
        const o = ((i * STRAND_RINGS + ring) * 3 + side) * 3;
        arr[o] = _sp.x + (_sa.x * Math.cos(t) + _sb.x * Math.sin(t)) * r;
        arr[o + 1] = _sp.y + (_sa.y * Math.cos(t) + _sb.y * Math.sin(t)) * r;
        arr[o + 2] = _sp.z + (_sa.z * Math.cos(t) + _sb.z * Math.sin(t)) * r;
      }
    }
  });
  pos.needsUpdate = true;
}

function buildWebs(scene) {
  const group = new THREE.Group();
  group.name = 'SpiderWebs';
  const strand = buildStrand();
  // Parked out of sight (rather than hidden) so its pipeline compiles behind the loading screen
  strand.position.set(0, -500, 0);
  group.add(strand);
  // The other hand's, for a double web
  const strand2 = buildStrand();
  strand2.position.set(0, -500, 0);
  group.add(strand2);

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
  // The glide's web wings: a membrane from each wrist to the shoulder and hip, and one between the legs
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  wingGeo.setIndex([0, 1, 2, 3, 4, 5, 2, 6, 7, 2, 7, 5]);
  const wings = new THREE.Mesh(wingGeo, new THREE.MeshBasicNodeMaterial({
    color: 0x7a0d16, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
  }));
  wings.frustumCulled = false;
  wings.position.set(0, -500, 0);
  group.add(wings);
  scene.add(group);
  return { group, strand, strand2, wings, splats, next: 0 };
}

// Wing corners from the posed skeleton: where each bone's joint is (indexed as PERSON_BONES)
const WING_BONES = [
  [3, 7],  // left shoulder (upper arm), left hip (thigh)
  [5, 11], // right
  [9, 13]  // ankles (feet)
];

function layWings(model, mesh, open) {
  const rig = model.rig;
  const a = rig.pose;
  const arr = mesh.geometry.attributes.position.array;
  // (a bone's pose holds its rotation and the translation that puts its bind-pose joint where the joint now is)
  const bone = (b, o) => {
    _boneQ.set(a[b * 8], a[b * 8 + 1], a[b * 8 + 2], a[b * 8 + 3]);
    _boneT.copy(rig.bind[b]).applyQuaternion(_boneQ).multiplyScalar(rig.s);
    arr.set([a[b * 8 + 4] + _boneT.x, a[b * 8 + 5] + _boneT.y, a[b * 8 + 6] + _boneT.z], o * 3);
  };
  for (let i = 0; i < 2; i++) {
    bone(WING_BONES[i][0], i * 3 + 1);
    bone(WING_BONES[i][1], i * 3 + 2);
    // (the wrist end unfurls out from the shoulder as the wings open)
    const sh = (i * 3 + 1) * 3, hand = model.hands[i];
    arr[i * 9] = arr[sh] + (hand.x - arr[sh]) * open;
    arr[i * 9 + 1] = arr[sh + 1] + (hand.y - arr[sh + 1]) * open;
    arr[i * 9 + 2] = arr[sh + 2] + (hand.z - arr[sh + 2]) * open;
  }
  bone(WING_BONES[2][0], 6);
  bone(WING_BONES[2][1], 7);
  // (between the legs, reaching only part way down to the ankles until fully open)
  for (const o of [6, 7]) {
    const hip = o === 6 ? 2 : 5;
    for (let k = 0; k < 3; k++) arr[o * 3 + k] = arr[hip * 3 + k] + (arr[o * 3 + k] - arr[hip * 3 + k]) * open;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
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

// The longest web whose arc still clears every roof, ledge and the street ahead of him along the swing (dir), with
// the hips CLEAR above them. The arc is sampled from where he is to well up the far side.
const ARC_CLEAR = 3.5;
const REEL_TIME = 1.0;           // s: the longest a web takes to be taken in to clear what's under the arc
function clearRopeLength(controllers, web, p, dx, dz) {
  const piv = web.pivot;
  const ox = p.x - piv.x, oz = p.z - piv.z;
  const now = ox * dx + oz * dz;
  const latX = ox - dx * now, latZ = oz - dz * now;
  const lat2 = latX * latX + latZ * latZ;
  const far = web.length * 0.75;
  let best = Infinity;
  for (let k = 0; k <= 8; k++) {
    const s = now + (far - now) * k / 8;
    const x = piv.x + dx * s + latX, z = piv.z + dz * s + latZ;
    const g = groundAt(controllers, x, z, p.y);
    const room = piv.y - g - ARC_CLEAR;
    if (room < 2) continue; // as high as the anchor: a wall to run into, not a roof to clear
    best = Math.min(best, Math.sqrt(room * room + s * s + lat2));
  }
  return best;
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
// `strict`: the player chose this hand, so only that side counts (the other one only if there's nothing at all on
// it), and no preference for the near side. Which side is which is then the left of (sideX, sideZ), the course he's
// on, not of his exact line of travel (after a swing out to the left he's still flying a little leftwards, and a fan
// of rays to the right of that would find the left side of the street ahead)
function findAnchor(controllers, cx, cy, cz, fx, fz, side, out, ground = 0, strict = false, sideX = fx, sideZ = fz) {
  const lx = fz, lz = -fx; // the figure's left, for a heading (fx, fz)
  const candidates = controllers.nearColliders(cx + fx * 40, cz + fz * 40, 85).filter((c) => c.maxY > cy + 7);
  if (!candidates.length) return null;
  let best = null, bestScore = -Infinity;
  // What sort of web suits his height, sliding smoothly from one to the other: low down there's no room for a long
  // arc (it would swing him through the street), so a short web, steeply up and only a little ahead, to climb;
  // high up, a long one far ahead and low, for a long arc
  const reach = Math.max(0, Math.min(1, (cy - 1.3 - ground - ARC_LOW) / (ARC_HIGH - ARC_LOW)));
  const wantLength = ARC_WEB_SHORT + (ARC_WEB - ARC_WEB_SHORT) * reach;
  const wantAngle = ARC_STEEP + (ARC_FLAT - ARC_STEEP) * reach;
  const elevations = [0.35, 0.45, 0.55, 0.7, 0.85, 1.2, 1.7, 2.4];
  // (0.05: almost along a wall he's right up against, to a point on it ahead)
  const laterals = [0.05, 0.15, 0.4, 0.7, 1.05];
  for (const pass of strict ? [true, false] : [false]) {
    if (strict && !pass && best) break;
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
          // (strict, first pass: only hits on the chosen side of the screen)
          if (pass && ((hx - cx) * sideZ - (hz - cz) * sideX) * side < 0.5) continue;
          // The bottom of the arc this web would swing through: keep it low in the street canyon (~10 m up), where
          // swinging looks best, rather than climbing a little higher with every web until the buildings run out
          const bottom = hy - tBest * 0.94;
          // (and an arc that would dip into the street is far worse: the web would have to be taken in while he
          // swings, which shows)
          const scrape = Math.max(0, ground - bottom);
          // Facades along his way (an avenue's sides) beat ones turned towards him (the end of a block ahead)
          const facing = ny > 0.5 ? 0 : Math.abs(nx * fx + nz * fz);
          // ...and the near side of the street beats the far one (alternating hands only tips an even choice)
          const across = Math.abs((hx - cx) * lx + (hz - cz) * lz);
          const angle = Math.atan2(rise, Math.hypot(hx - cx, hz - cz));
          const score = -Math.abs(tBest - wantLength) * 0.25 - Math.abs(angle - wantAngle) * 12
            - Math.abs(bottom - ground - 12) * 0.3 + ahead * 0.3 * reach + (s === side ? 2 : 0) - facing * FACING_PENALTY
            - (strict ? 0 : across * NEAR_SIDE) - scrape * SCRAPE_PENALTY
            - (ny > 0.5 ? 3 : 0); // a facade reads better than a roof edge
          if (score > bestScore) {
            bestScore = score;
            best = out;
            out.x = hx; out.y = hy; out.z = hz;
            out.nx = nx; out.ny = ny; out.nz = nz;
            out.side = pass ? side : s;
          }
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
    state: 'ground', // 'ground' | 'air' | 'swing' | 'wall' (crawling) | 'wallrun' | 'sling' (drawing a slingshot) | 'whip' (round a corner)
    web: {
      phase: 'none', // 'none' | 'shooting' | 'attached'
      anchor: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      // A double web (both buttons): the second anchor, on the other side of the street
      double: false,
      anchor2: new THREE.Vector3(),
      normal2: new THREE.Vector3(),
      tip2: new THREE.Vector3(),
      distance2: 0,
      splat2: null,
      // Where the body hangs towards: the anchor, or between the two of a double web
      aim: new THREE.Vector3(),
      // Fired from a chosen hand (L or R) rather than the automatic web: swings out towards that side
      chosen: false,
      towardX: 0, // (across the street, towards that side)
      towardZ: 0,
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
      caught: false,
      turned: false, // has swung back (hanging on past the top of the arc)
      rising: false,
      // Whipping round a building's corner: the heading that ends it, and how far he has turned so far
      whip: false,
      whipYaw: 0,
      whipTurned: 0,
      whipRadius: 0,
      dirX: 0,
      dirZ: 1
    },
    // The quick forward web of a tap (drawn for a moment, while it yanks)
    zip: { time: -1, side: 1, anchor: new THREE.Vector3(), tip: new THREE.Vector3(), normal: new THREE.Vector3(), cooldown: 0, pull: 0, rise: ZIP_RISE,
      targetSpeed: 0, chain: 0 },
    nextSide: 1,
    webHeld: false,
    webSpent: false, // this press already threw its web
    wantL: false,    // the hands asked for since the press (L, R, or both: a double web)
    wantR: false,
    pressAir: false, // whether this press began in the air (only then can a tap zip)
    stickYaw: null,  // where the stick points (camera-relative), while it's pushed
    stickRef: null,  // the camera's direction the stick is read against (see the update), and the stick's own angle
    stickAngle: 0,   // when it was pushed that way
    courseX: Math.sin(heading), // his line of travel, smoothed
    courseZ: Math.cos(heading),
    pressTime: 0,
    webCooldown: 0,
    webRetry: 0,
    groundTime: 0,
    // Wall contact: outward normal, how high it goes, time on it, the direction of travel when it was hit, the
    // crawl direction in the wall's plane (the body's up while crawling) and how fast the stick is moving him
    // ...and a web pulled along it: speed (fading) and direction (the figure's left, up) of the pull, and whether
    // this press has been used on the wall already (and the face he's on, for the camera to swing round a corner)
    wall: { nx: 0, nz: 0, faceX: 0, faceZ: 0, top: 0, time: 0, tx: 0, tz: 0, ux: 0, uy: 1, uz: 0, move: 0, dash: 0, dashS: 0, dashV: 1,
      used: false },
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
    // Tilt for the follow camera (-1 look down .. 1 look up): up or down the wall he's crawling or running
    cameraPitch: 0,
    // Seconds left of the follow camera locked on behind him (whipping round a corner, and a moment after)
    cameraLock: 0,
    cameraSide: 0,
    // The swing camera's up: leans (gently) with his body along the web while he swings, world up otherwise
    swingUp: new THREE.Vector3(0, 1, 0),
    // The slingshot: a web from each hand to something ahead (left hand, right hand), how far they've flown, how far
    // he has pulled them back, and the time left for the other button to join the first (from the ground)
    sling: {
      phase: 'none', // 'none' | 'shooting' | 'set'
      anchors: [new THREE.Vector3(), new THREE.Vector3()],
      normals: [new THREE.Vector3(), new THREE.Vector3()],
      tips: [new THREE.Vector3(), new THREE.Vector3()],
      splats: [null, null],
      distance: 0,
      travelled: 0,
      draw: 0,
      rest: 0,
      homeX: 0,
      homeZ: 1,
      wait: 0
    },
    // Gliding on the web wings under his arms: on, how far the wings are out (for the look), the bank of a turn and
    // the nose down of a stick pushed on (-1 flaring .. 1 diving)
    gliding: false,
    glideHeld: false,
    glide: 0,
    glideBank: 0,
    glidePitch: 0,
    glidePath: null,
    diving: false,
    diveClicks: 0,
    cameraTargetOffset: new THREE.Vector3(0, 1.3, 0),
    chaseDistance: 4.6,
    chaseHeight: 1.7,
    // The follow view starts well back (about 11 m), with the street and the buildings either side in view
    chaseZoom: 2.4
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
  dropSling(ent);
  ent.gliding = ent.diving = false;
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
  if (ent.web.splat2) ent.web.splat2.held = false;
  ent.web.splat = ent.web.splat2 = null;
}

function dropSling(ent) {
  const sling = ent.sling;
  for (let i = 0; i < 2; i++) {
    if (sling.splats[i]) sling.splats[i].held = false;
    sling.splats[i] = null;
  }
  sling.phase = 'none';
  sling.draw = 0;
  sling.wait = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------------------------

const _center = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _anchorOut = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, side: 1 };
const _anchorOut2 = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, side: 1 };
const _before = new THREE.Vector3();

function travelDirection(ent) {
  const v = ent.velocity;
  const h = Math.hypot(v.x, v.z);
  // While moving, the swing follows the momentum; from a standstill it follows the facing
  return h > 3 ? { x: v.x / h, z: v.z / h } : { x: Math.sin(ent.heading), z: Math.cos(ent.heading) };
}

// `request`: 0 for the automatic web (near side, alternating hands, an assisted swing down the middle of the
// street), +1 / -1 for the left / right hand (a real swing out towards that side), 2 for both (a double web)
function shootWeb(controllers, ent, request = 0) {
  const p = ent.position;
  const dir = travelDirection(ent);
  const cy = p.y + 1.3;
  const web = ent.web;
  const ground = controllers.getGroundHeight(p.x, p.z, 'person');
  const chosen = request !== 0;
  // A chosen hand's left and right (see findAnchor) are those of where he's headed, never the camera's: while the
  // stick is held, where it points (the way the player means by forward, whatever angle the camera sees him
  // from); with it centred, the street he's travelling along, his line of travel snapped to the city's grid, so
  // the diagonal he flies after swinging out to one side still reads as straight down the avenue (his line of
  // travel smoothed over a second or so, too, so a sideways burst doesn't turn it; a real turn does)
  let courseYaw = Math.atan2(ent.courseX, ent.courseZ);
  if (ent.stickYaw !== null) {
    courseYaw = ent.stickYaw;
  } else {
    const grid = Math.round(courseYaw / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(angleDiff(grid, courseYaw)) < COURSE_SNAP) courseYaw = grid;
  }
  const sideX = Math.sin(courseYaw), sideZ = Math.cos(courseYaw);
  // (and a chosen hand looks for its anchor between his line of travel and that course: flying diagonally after
  // a swing out, a fan round his line alone hardly reaches across to the other side)
  let fanX = dir.x, fanZ = dir.z;
  if (chosen && dir.x * sideX + dir.z * sideZ > 0) {
    fanX += sideX; fanZ += sideZ;
    const n = Math.hypot(fanX, fanZ);
    fanX /= n; fanZ /= n;
  }
  const anchor = findAnchor(controllers, p.x, cy, p.z, fanX, fanZ, request === 1 || request === -1 ? request : ent.nextSide,
    _anchorOut, ground, chosen, sideX, sideZ);
  if (!anchor) {
    // Nothing to stick to: no web at all (a web only ever leaves his wrist to hit something); look again shortly
    ent.webRetry = 0.15;
    return;
  }
  web.side = anchor.side;
  ent.nextSide = -web.side; // alternate hands, like the real thing
  ent.gliding = false;
  web.travelled = 0;
  web.swingTime = 0;
  web.passedBottom = web.rising = web.caught = web.turned = false;
  web.dirX = dir.x;
  web.dirZ = dir.z;
  web.phase = 'shooting';
  web.whip = false;
  web.chosen = chosen;
  ent.webSpent = true;
  web.anchor.set(anchor.x, anchor.y, anchor.z);
  web.normal.set(anchor.nx, anchor.ny, anchor.nz);
  web.distance = web.anchor.distanceTo(_center.set(p.x, cy, p.z));
  web.aim.copy(web.anchor);
  // A double web: the other hand to the other side of the street, if there's something there too
  web.double = false;
  if (request === 2) {
    const other = findAnchor(controllers, p.x, cy, p.z, fanX, fanZ, -web.side, _anchorOut2, ground, true, sideX, sideZ);
    if (other && other.side === -web.side) {
      web.double = true;
      web.anchor2.set(other.x, other.y, other.z);
      web.normal2.set(other.nx, other.ny, other.nz);
      web.distance2 = web.anchor2.distanceTo(_center);
      web.aim.set((web.anchor.x + web.anchor2.x) * 0.5, (web.anchor.y + web.anchor2.y) * 0.5, (web.anchor.z + web.anchor2.z) * 0.5);
    }
  }
  const ox = anchor.x - p.x, oz = anchor.z - p.z;
  const ahead = ox * dir.x + oz * dir.z;
  const latX = ox - dir.x * ahead, latZ = oz - dir.z * ahead;
  if (web.double) {
    // Hanging between the two: a dead straight swing down the middle
    web.pivot.copy(web.aim);
  } else if (chosen) {
    // A chosen hand swings for real towards its side. A pendulum carries him about as far past its pivot as he
    // starts short of it (and flies on a little after), so the pivot sits only far enough over that he ends ZIG_MARGIN short of the
    // facade, and never more than ZIG_REACH across. That's the zigzag: each swing carries him over to its side,
    // and the next, from the other hand, back. In a narrow street it reaches across; in a wide one it's a weave
    // (across measured square to his course, the street's axis, not to his line of travel: flying
    // diagonally, "over his path" would land the pivot far ahead on that line, in the buildings opposite)
    const leftX = sideZ, leftZ = -sideX;
    const acrossSigned = ox * leftX + oz * leftZ;
    const across = Math.abs(acrossSigned);
    const shift = Math.max(0, Math.min(ZIG_REACH, across - ZIG_MARGIN) * ZIG_SHARE) * Math.sign(acrossSigned);
    web.pivot.set(anchor.x - leftX * (acrossSigned - shift), anchor.y, anchor.z - leftZ * (acrossSigned - shift));
    web.towardX = leftX * Math.sign(acrossSigned);
    web.towardZ = leftZ * Math.sign(acrossSigned);
  } else {
    // The automatic web: the pendulum pivot is the anchor, brought most of the way back over the line of travel
    // (see the header), and eased towards the middle of the street, so a chain of swings settles into the centre
    // of the canyon
    const centre = canyonCentreOffset(controllers, p.x, cy, p.z, dir.x, dir.z) * 0.6;
    web.pivot.set(anchor.x - latX * PIVOT_PULL + dir.z * centre, anchor.y, anchor.z - latZ * PIVOT_PULL - dir.x * centre);
  }
  if (typeof ent.onWebShot === 'function') ent.onWebShot(web.distance);
}

function attachWeb(controllers, ent) {
  const web = ent.web;
  const p = ent.position;
  _center.set(p.x, p.y + 1.0, p.z);
  const dist = _center.distanceTo(web.pivot);
  // (the web starts as long as it is: if the arc would scrape the street or a roof, it's taken in over the
  // down-swing, see the swing update, not hauled in at once)
  web.length = dist;
  web.targetLength = dist;
  web.phase = 'attached';
  ent.state = 'swing';
  // The splat stays on the wall while the web holds, then fades
  web.splat = ent.webs ? stickSplat(ent, web.anchor, web.normal, true) : null;
  web.splat2 = ent.webs && web.double ? stickSplat(ent, web.anchor2, web.normal2, true) : null;
}

// Whether (x, z) at height y is inside a building
function solidAt(controllers, x, y, z) {
  for (const c of controllers.nearColliders(x, z, 0.5)) {
    if (c.maxY > y && (c.minY ?? 0) <= y && footprintContains(c, x, z)) return true;
  }
  return false;
}

// The corner to whip round, on the inside of a turn (side: 1 his left, -1 his right): the edge of a block he's coming
// up to (or has just passed) with the street opening up beyond it on that side. That block lies behind the corner
// and towards the inside, so the circle he swings round it stays out in the streets. Fills out with the point on
// the edge the web sticks to, the pivot just off it (diagonally out of the corner) and that diagonal
function findCorner(controllers, cx, cy, cz, fx, fz, side, out) {
  const ix = fz * side, iz = -fx * side; // towards the inside of the turn
  let best = null, bestScore = -Infinity;
  for (const c of controllers.nearColliders(cx + fx * 12, cz + fz * 12, WHIP_REACH + 12)) {
    if (c.maxY < cy + 2 || (c.minY ?? 0) > cy) continue;
    const f = boxFrame(c);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // The box's two axes at this corner, pointing out of it (its local x and z in the world)
        const ax = sx * f.cs, az = -sx * f.sn;
        const bx = sz * f.sn, bz = sz * f.cs;
        const kx = f.cx + ax * f.hx + bx * f.hz, kz = f.cz + az * f.hx + bz * f.hz;
        const ox = (ax + bx) * Math.SQRT1_2, oz = (az + bz) * Math.SQRT1_2;
        // (the block behind and inside: out of the corner is ahead of him and back across his path)
        if (ox * fx + oz * fz < 0.3 || ox * ix + oz * iz > -0.3) continue;
        const rx = kx - cx, rz = kz - cz;
        const ahead = rx * fx + rz * fz, across = rx * ix + rz * iz;
        if (ahead < -8 || ahead > WHIP_REACH || across < WHIP_RADIUS_MIN || across > WHIP_RADIUS_MAX) continue;
        // A real corner, not where one building of a block meets the next: just past it along either face, the street
        const ay = Math.min(c.maxY - 0.5, cy + 4);
        if (solidAt(controllers, kx + bx * 1.5 - ax * 0.5, ay, kz + bz * 1.5 - az * 0.5)
          || solidAt(controllers, kx + ax * 1.5 - bx * 0.5, ay, kz + az * 1.5 - bz * 0.5)) continue;
        // ...and in sight
        const px = kx + ox * 0.6, pz = kz + oz * 0.6;
        const dx = px - cx, dy = ay - cy, dz = pz - cz;
        const d = Math.hypot(dx, dy, dz);
        let blocked = false;
        for (const o of controllers.nearColliders(cx + dx * 0.5, cz + dz * 0.5, d * 0.5 + 1)) {
          if (rayBox(o, cx, cy, cz, dx / d, dy / d, dz / d, d - 0.3, _hit)) { blocked = true; break; }
        }
        if (blocked) continue;
        // The corner he's at beats one further on; a radius of a street's half width or so swings best
        const score = -Math.abs(ahead) * 0.3 - Math.abs(across - 14) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = out;
          out.x = kx; out.y = ay; out.z = kz;
          out.px = px; out.pz = pz;
          out.nx = ox; out.nz = oz;
        }
      }
    }
  }
  return best;
}

const _cornerOut = { x: 0, y: 0, z: 0, px: 0, pz: 0, nx: 0, nz: 0 };

// A web to the corner on the inside of a turn (see findCorner), to whip round it until he heads `yaw`
function shootWhip(controllers, ent, side, yaw) {
  const p = ent.position;
  const dir = travelDirection(ent);
  const corner = findCorner(controllers, p.x, p.y + 1.0, p.z, dir.x, dir.z, side, _cornerOut);
  if (!corner) return false;
  const web = ent.web;
  web.side = side;
  ent.nextSide = -side;
  ent.gliding = false;
  web.travelled = 0;
  web.swingTime = 0;
  web.passedBottom = web.rising = web.caught = web.turned = false;
  web.dirX = dir.x;
  web.dirZ = dir.z;
  web.phase = 'shooting';
  web.chosen = web.double = false;
  web.whip = true;
  web.whipYaw = yaw;
  web.whipTurned = 0;
  ent.webSpent = true;
  web.anchor.set(corner.x, corner.y, corner.z);
  web.normal.set(corner.nx, 0, corner.nz);
  web.aim.copy(web.anchor);
  web.pivot.set(corner.px, corner.y, corner.pz);
  web.distance = web.anchor.distanceTo(_center.set(p.x, p.y + 1.3, p.z));
  if (typeof ent.onWebShot === 'function') ent.onWebShot(web.distance);
  return true;
}

function attachWhip(ent) {
  const web = ent.web;
  const p = ent.position;
  // The radius he'll go round at: how far across from the corner he is, square to the way he was going when he threw
  // the web (steering in towards the corner as it flies doesn't tighten it into a hairpin)
  const ix = web.dirZ * web.side, iz = -web.dirX * web.side;
  const d = Math.hypot(p.x - web.pivot.x, p.z - web.pivot.z);
  web.whipRadius = Math.max(WHIP_RADIUS_MIN, Math.min(d, (web.pivot.x - p.x) * ix + (web.pivot.z - p.z) * iz));
  web.length = Math.max(web.whipRadius, d);
  web.phase = 'attached';
  ent.state = 'whip';
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
    const lift = Math.max(0, Math.min(1, (RELEASE_LIFT_CEILING - height) / 32));
    v.y = Math.min(Math.max(v.y, 0) * (0.55 + 0.45 * lift) + RELEASE_BOOST_UP * lift, 15);
    // (a double web flings harder)
    const fwd = RELEASE_BOOST_FWD * (web.double ? DOUBLE_BOOST : 1);
    v.x += dir.x * fwd;
    v.z += dir.z * fwd;
    if (v.length() > 20 && Math.random() < 0.55) ent.flip = 0;
  }
  web.phase = 'none';
  web.whip = false;
  releaseSplat(ent);
  if (ent.state === 'swing' || ent.state === 'whip') ent.state = 'air';
  ent.webCooldown = 0.16;
}

function clampSpeed(v) {
  const s = v.length();
  if (s > MAX_SPEED) v.multiplyScalar(MAX_SPEED / s);
}

// Signed shortest angle from b to a
function angleDiff(a, b) {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
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
// up, down and wider) looks within ~90 m for a building face, roof or ledge (no more than a few metres under his
// feet: aiming down costs more than aiming up). Buildings and rooftops win; a street light ahead is only the
// fallback when there's no building in reach. With nothing at all the tap does nothing (never sticks to thin air).
// Straight ahead reads best, at the height `want` (above level low down, to climb; level high up); below it is
// worse than above; nearer is snappier
function zipScore(lat, elev, dist, want = 0) {
  const off = elev - want;
  return -Math.abs(lat) * 20 - (off < 0 ? -off * 22 : off * 8) - dist * 0.05;
}

function findZipTarget(controllers, cx, cy, cz, fx, fz, out, feetY = cy - 1.3, ground = -Infinity) {
  const lx = fz, lz = -fx;
  // Low down a zip aims well up (still ahead), to help him gain height; high up it aims level
  const want = ZIP_AIM_LOW * (1 - Math.max(0, Math.min(1, (feetY - ground) / ZIP_AIM_HEIGHT)));
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
    if (Math.abs(lat) > 0.5 || elev < -0.7 || elev > 0.9 || dist > ZIP_RANGE) continue;
    const score = zipScore(lat, elev, dist, want) - 30;
    if (score > bestScore) {
      bestScore = score;
      best = out;
      out.x = lamp.x; out.y = lamp.y; out.z = lamp.z;
      out.bnx = 0; out.bny = 1; out.bnz = 0;
      out.lamp = true;
    }
  }
  for (const elev of [-0.7, -0.45, -0.3, -0.15, -0.05, 0.08, 0.25, 0.5, 0.85]) {
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
      // A roof top is the best perch to pull towards
      const score = zipScore(lat, elev, t, want) + (out.ny > 0.5 ? 3 : 0);
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

// `aimYaw`: a heading to zip towards instead of straight on (the stick pushed off his line of travel): the web goes
// that way and the yank turns his flight towards it, by up to ZIP_TURN, at a little of his speed
function webZip(controllers, ent, aimYaw = null) {
  const p = ent.position;
  const v = ent.velocity;
  const zip = ent.zip;
  const dir = aimYaw === null ? travelDirection(ent) : { x: Math.sin(aimYaw), z: Math.cos(aimYaw) };
  const cy = p.y + 1.3;
  const ground = controllers.getGroundHeight(p.x, p.z, 'person');
  const target = findZipTarget(controllers, p.x, cy, p.z, dir.x, dir.z, _zipOut, p.y, ground);
  if (!target) return false;
  ent.gliding = false;
  if (aimYaw !== null) {
    const now = Math.atan2(v.x, v.z);
    const diff = angleDiff(aimYaw, now);
    const yaw = now + Math.sign(diff) * Math.min(Math.abs(diff), ZIP_TURN);
    const hs = Math.hypot(v.x, v.z) * ZIP_TURN_COST;
    v.x = Math.sin(yaw) * hs;
    v.z = Math.cos(yaw) * hs;
  }
  zip.anchor.set(target.x, target.y, target.z);
  if (target.lamp) zip.normal.set(0, 0, 0);
  else zip.normal.set(target.nx, target.ny, target.nz);
  // A splat on a wall or roof (a street light just takes the strand round its head)
  if (ent.webs && !target.lamp) stickSplat(ent, zip.anchor, _seg.set(target.nx, target.ny, target.nz), false);
  zip.time = 0;
  zip.side = ent.nextSide;
  ent.nextSide = -zip.side;
  zip.cooldown = 0.28;
  zip.chain++;
  // The yank never changes his direction (not quite physics, but it keeps the flight readable): over the next
  // quarter second it builds his speed along the way he's already going and lifts against gravity (see the air
  // update), never cutting speed or stopping a fall dead
  const hs = Math.hypot(v.x, v.z);
  // (the push fades as he gets faster: from a standstill a few zips get him going, but real speed takes swings)
  const start = Math.max(hs, 6);
  zip.targetSpeed = Math.max(hs, Math.min(ZIP_MAX_SPEED, start + ZIP_PUSH * Math.max(0.15, 1 - start / ZIP_SOFT_CAP)));
  // ...and a web aimed up lifts him higher
  const up = (target.y - cy) / Math.max(1, Math.hypot(target.x - p.x, target.z - p.z));
  zip.rise = ZIP_RISE + ZIP_RISE_UP * Math.max(0, Math.min(1, up));
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
  ent.wall.dash = 0;
  ent.wall.used = false;
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

// Crawling, a web shot along the wall the way he's crawling (`s` towards the figure's left, `u` up, a unit
// direction in the wall's plane): it sticks a little way ahead and pulls him along it, faster than he can crawl
function wallZip(ent, s, u, ground) {
  const w = ent.wall;
  const p = ent.position;
  const zip = ent.zip;
  const lx = -w.nz, lz = w.nx;
  w.dash = WALL_ZIP_SPEED;
  w.dashS = s;
  w.dashV = u;
  w.used = true;
  const reach = 9;
  zip.anchor.set(p.x + lx * s * reach - w.nx * 0.4, Math.max(ground + 0.3, Math.min(w.top, p.y + 1.2 + u * reach)), p.z + lz * s * reach - w.nz * 0.4);
  zip.normal.set(w.nx, 0, w.nz);
  if (ent.webs) stickSplat(ent, zip.anchor, _seg.set(w.nx, 0, w.nz), false);
  zip.time = 0;
  zip.side = s > 0.3 ? 1 : s < -0.3 ? -1 : ent.nextSide;
  ent.nextSide = -zip.side;
  zip.cooldown = 0.25;
  if (typeof ent.onWebShot === 'function') ent.onWebShot(reach);
}

// Pushes off the wall and out into the street, away from the building (the stick's sideways part carries over)
function jumpOffWall(ent, s) {
  const w = ent.wall;
  const lx = -w.nz, lz = w.nx;
  ent.velocity.set(w.nx * WALL_JUMP_OUT + lx * s * 5, WALL_JUMP_UP, w.nz * WALL_JUMP_OUT + lz * s * 5);
  ent.heading = Math.atan2(ent.velocity.x, ent.velocity.z);
  ent.state = 'air';
  ent.flip = 0;
  ent.webCooldown = 0.12;
}

// A press from the ground: jump (fast enough to run on), and the held button fires a web on the way up
function groundJump(ent) {
  const v = ent.velocity;
  v.y = 12.5;
  const dir = { x: Math.sin(ent.heading), z: Math.cos(ent.heading) };
  const hs = Math.hypot(v.x, v.z);
  v.x = dir.x * Math.max(hs, 6);
  v.z = dir.z * Math.max(hs, 6);
  ent.state = 'air';
  ent.webCooldown = 0.12;
  ent.sling.wait = 0;
}

// The slingshot's web from one hand (s: 1 his left, -1 his right): a fan of rays ahead and out to that side, aimed
// well up, for a point high on a building within reach (about SLING_RISE above him wins, so the launch carries him up
// among the buildings; a lower wall will do). With nothing standing up ahead (on a flat roof, in a park) it sticks to
// the floor a few metres ahead on that side instead
function findSlingAnchor(controllers, x, feet, z, fx, fz, s, anchor, normal) {
  const lx = fz, lz = -fx;
  const cy = feet + 1.1;
  const candidates = controllers.nearColliders(x + fx * 20, z + fz * 20, SLING_REACH).filter((c) => c.maxY > feet + 1.5);
  let bestScore = -Infinity;
  for (const lat of [0.25, 0.5, 0.8, 1.2]) {
    for (const elev of [0.15, 0.35, 0.6, 0.9, 1.3, 1.8]) {
      _dir.set(fx + lx * lat * s, elev, fz + lz * lat * s).normalize();
      let t = SLING_REACH, found = false, nx = 0, ny = 0, nz = 0;
      for (const c of candidates) {
        if (rayBox(c, x, cy, z, _dir.x, _dir.y, _dir.z, t, _hit)) {
          t = _hit.t; nx = _hit.nx; ny = _hit.ny; nz = _hit.nz; found = true;
        }
      }
      if (!found || t < 3) continue;
      const rise = _dir.y * t;
      const score = -Math.abs(rise - SLING_RISE) * 0.25 - t * 0.05 - Math.abs(lat - 0.5) * 3 - (ny > 0.5 ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        anchor.set(x + _dir.x * t, cy + _dir.y * t, z + _dir.z * t);
        normal.set(nx, ny, nz);
      }
    }
  }
  if (bestScore > -Infinity) return;
  // (on the floor: as far ahead as it stays level with his feet, so it never ends up over a roof's edge)
  for (const d of [6, 4, 2.5]) {
    const ax = x + (fx + lx * s * 0.45) * d, az = z + (fz + lz * s * 0.45) * d;
    const g = groundAt(controllers, ax, az, feet);
    if (Math.abs(g - feet) < 1 || d === 2.5) {
      anchor.set(ax, Math.abs(g - feet) < 1 ? g : feet, az);
      normal.set(0, 1, 0);
      return;
    }
  }
}

// Both web buttons from the ground: a web from each hand to something ahead, one either side, to pull back on
function startSling(controllers, ent) {
  const p = ent.position;
  const sling = ent.sling;
  const fx = Math.sin(ent.heading), fz = Math.cos(ent.heading);
  sling.distance = 0;
  for (let i = 0; i < 2; i++) {
    findSlingAnchor(controllers, p.x, p.y, p.z, fx, fz, i === 0 ? 1 : -1, sling.anchors[i], sling.normals[i]);
    sling.distance = Math.max(sling.distance, sling.anchors[i].distanceTo(_center.set(p.x, p.y + 1.1, p.z)));
  }
  sling.phase = 'shooting';
  sling.travelled = 0;
  sling.draw = 0;
  sling.wait = 0;
  // (how far he stands from between the anchors, undrawn, and the way he first aimed)
  sling.rest = Math.hypot((sling.anchors[0].x + sling.anchors[1].x) * 0.5 - p.x, (sling.anchors[0].z + sling.anchors[1].z) * 0.5 - p.z);
  sling.homeX = fx;
  sling.homeZ = fz;
  ent.state = 'sling';
  ent.velocity.set(0, 0, 0);
  ent.webSpent = true; // (the press's web: no swing web from it after the launch)
  if (typeof ent.onWebShot === 'function') ent.onWebShot(sling.distance);
}

// Letting go of a drawn slingshot: the stretched webs fling him along his aim, harder the further he pulled them
// back, and up most of the way to the angle of the webs (a skim off a low anchor, up among the buildings towards
// high ones)
function launchSling(controllers, ent) {
  const sling = ent.sling;
  const p = ent.position;
  const [a, b] = sling.anchors;
  const pull = Math.min(1, sling.draw / SLING_DRAW);
  const speed = SLING_LAUNCH_MIN + (SLING_LAUNCH_MAX - SLING_LAUNCH_MIN) * pull;
  const fx = Math.sin(ent.heading), fz = Math.cos(ent.heading);
  const ahead = Math.max(1, ((a.x + b.x) * 0.5 - p.x) * fx + ((a.z + b.z) * 0.5 - p.z) * fz);
  const pitch = Math.max(0.3, Math.min(0.95, Math.atan2((a.y + b.y) * 0.5 - p.y - 1.1, ahead) * 0.8 + 0.15));
  ent.velocity.set(fx * Math.cos(pitch) * speed, Math.sin(pitch) * speed, fz * Math.cos(pitch) * speed);
  ent.state = 'air';
  ent.flip = pull > 0.5 ? 0 : 1;
  ent.webCooldown = 0.25;
  dropSling(ent);
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
  // The stick, relative to the camera (on the ground and in the air): up moves him away from the camera, whichever
  // way he faces. wantYaw is the heading it asks for (null with the stick centred). Walls use the stick as it is.
  // It's read against the camera as it was when the stick was pushed that way, not as it is now: the camera follows
  // him round as he turns (closely, on foot), and against the camera's latest direction a stick held to the side
  // would ask for ever more turn, running him round in circles. Moving the stick on (or letting go) reads it afresh
  const stickMag = Math.min(1, Math.hypot(turn, fwdIn - backIn));
  let wantYaw = null;
  if (stickMag > 0.12) {
    const stickAngle = Math.atan2(-turn, fwdIn - backIn);
    if (ent.stickRef === null || Math.abs(angleDiff(stickAngle, ent.stickAngle)) > 0.35) {
      ent.stickRef = Number.isFinite(controllers.cameraYaw) ? controllers.cameraYaw : ent.heading;
      ent.stickAngle = stickAngle;
    }
    const camYaw = ent.stickRef;
    const c = Math.cos(camYaw), sn = Math.sin(camYaw);
    const sx = -turn, sy = fwdIn - backIn; // stick right, stick up
    wantYaw = Math.atan2(sn * sy - c * sx, c * sy + sn * sx);
  } else {
    ent.stickRef = null;
  }
  ent.stickYaw = stickMag > 0.3 ? wantYaw : null;
  {
    const hs = Math.hypot(v.x, v.z);
    if (hs > 3) {
      const k = 1 - Math.exp(-dt * COURSE_RATE);
      ent.courseX += (v.x / hs - ent.courseX) * k;
      ent.courseZ += (v.z / hs - ent.courseZ) * k;
      const n = Math.hypot(ent.courseX, ent.courseZ) || 1;
      ent.courseX /= n;
      ent.courseZ /= n;
    }
  }
  // The web buttons: L and R (that hand), both (a double web), or the automatic one (keyboard and gamepad)
  const btnL = Boolean(keys.webLeft), btnR = Boolean(keys.webRight);
  const held = btnL || btnR || Boolean(keys.up);
  const pressed = held && !ent.webHeld;
  const released = !held && ent.webHeld;
  const tap = released && ent.pressTime < TAP_TIME;
  if (pressed) {
    ent.pressTime = 0; ent.webSpent = false; ent.wantL = ent.wantR = false;
    // (from the ground a press always jumps first: a tap there is just a jump, and only a tap begun in the air zips)
    ent.pressAir = ent.state === 'air' || ent.state === 'swing' || ent.state === 'whip';
  }
  else if (held) ent.pressTime += dt;
  // (the hands pressed in the moment before the web flies count: the second of a double needn't be exact)
  if (held && !ent.webSpent) { ent.wantL ||= btnL; ent.wantR ||= btnR; }
  const request = ent.wantL && ent.wantR ? 2 : ent.wantL ? 1 : ent.wantR ? -1 : 0;
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
    else if (web.travelled >= (web.double ? Math.max(web.distance, web.distance2) : web.distance)) {
      if (web.whip) attachWhip(ent);
      else attachWeb(controllers, ent);
    }
  }
  if (web.phase === 'attached' && !held) {
    releaseWeb(controllers, ent, (web.whip || (v.y > -2 && v.x * web.dirX + v.z * web.dirZ > 0)) && !tap);
  }

  // Clicking the stick (L3, a tap on the touch stick, X) starts or ends a dive in the air
  const diveClicks = controllers.diveRequests || 0;
  if (diveClicks !== ent.diveClicks) {
    ent.diveClicks = diveClicks;
    // (not on the wings: a tap on the stick to steer the glide shouldn't fold them into a dive)
    if (ent.state === 'air' && zip.pull <= 0 && !ent.gliding) ent.diving = !ent.diving;
    // (a dive folds the wings)
    if (ent.diving) ent.gliding = false;
  }
  // A web (or a zip) ends a dive
  if (held || tap) ent.diving = false;
  // The glide button spreads the web wings under his arms (in the air; on a web he lets go first, flung on as usual)
  // and folds them again. A web or a zip that flies also folds them (see shootWeb and webZip): pressing one over
  // open ground, with nothing to stick to, keeps him gliding
  const glideBtn = Boolean(keys.glide);
  if (glideBtn && !ent.glideHeld) {
    if (ent.gliding) {
      ent.gliding = false;
    } else if (ent.state === 'air' || ent.state === 'swing' || ent.state === 'whip') {
      if (ent.state !== 'air') releaseWeb(controllers, ent, web.whip || (v.y > -2 && v.x * web.dirX + v.z * web.dirZ > 0));
      web.phase = 'none';
      ent.gliding = true;
      ent.glidePath = null;
      ent.diving = false;
    }
  }
  ent.glideHeld = glideBtn;

  // A tap in the air zips forward instead (up to three in a row before landing, swinging or touching a wall)
  // (with the stick pushed well off his line of travel, the zip goes that way and turns him; with nothing that way
  // to stick to, it goes straight on as usual)
  if (tap && ent.pressAir && (ent.state === 'air' || ent.state === 'swing') && zip.cooldown <= 0 && zip.chain < ZIP_CHAIN) {
    web.phase = 'none';
    if (request === 1 || request === -1) ent.nextSide = request; // from the hand tapped
    const travel = travelDirection(ent);
    const turnTo = wantYaw !== null && stickMag > 0.5
      && Math.abs(angleDiff(wantYaw, Math.atan2(travel.x, travel.z))) > ZIP_TURN_MIN ? wantYaw : null;
    if (!webZip(controllers, ent, turnTo) && turnTo !== null) webZip(controllers, ent);
  }

  if (ent.state === 'ground') {
    ent.groundTime += dt;
    // A press jumps (and, held, fires a web on the way up). Both web buttons together set up a slingshot instead, so
    // a press of just one waits a moment for the other (the second of a pair is never pressed in quite the same
    // frame); the automatic web (Space, A) jumps at once
    const sling = ent.sling;
    if (pressed && btnL && btnR) startSling(controllers, ent);
    else if (pressed && (btnL || btnR)) sling.wait = SLING_PAIR;
    else if (pressed) groundJump(ent);
    else if (sling.wait > 0) {
      if (btnL && btnR) startSling(controllers, ent);
      else if (!held || (sling.wait -= dt) <= 0) groundJump(ent);
    }
  } else {
    ent.groundTime = 0;
    ent.sling.wait = 0;
  }
  // In the air a held button fires the swing web (after a moment, so that a tap stays a zip): one per press
  if (ent.state === 'air' && held && !ent.webSpent && ent.pressTime >= 0.08 && web.phase === 'none'
    && ent.webCooldown <= 0 && ent.webRetry <= 0) {
    // The stick pushed hard off his line of travel (towards a side street, or back the way he came): a web to the
    // corner of the block on that side, to whip round it. With no corner in reach, an ordinary swing web
    const travel = travelDirection(ent);
    const off = wantYaw === null ? 0 : angleDiff(wantYaw, Math.atan2(travel.x, travel.z));
    const whip = stickMag > 0.5 && Math.abs(off) > WHIP_ANGLE && Math.hypot(v.x, v.z) > 8;
    // (the stick pulled right back, for a U-turn: round a corner on either side)
    if (!whip || !(shootWhip(controllers, ent, Math.sign(off), wantYaw)
      || (Math.abs(off) > 2.6 && shootWhip(controllers, ent, -Math.sign(off), wantYaw)))) shootWeb(controllers, ent, request);
  }

  // --- Movement per state ------------------------------------------------------------------------------------
  _before.copy(p);
  if (ent.state === 'ground') {
    // Turn to face where the stick points (quickly: a full about-face takes a third of a second), easing off the
    // pace while turning round
    let target = 0;
    if (wantYaw !== null) {
      const diff = angleDiff(wantYaw, ent.heading);
      ent.heading += Math.sign(diff) * Math.min(Math.abs(diff), GROUND_TURN_RATE * dt);
      target = RUN_SPEED * stickMag * (Math.abs(diff) < 1.2 ? 1 : 0.3);
    }
    const fx = Math.sin(ent.heading), fz = Math.cos(ent.heading);
    let along = v.x * fx + v.z * fz;
    // Landing from a swing keeps its momentum for a moment, then settles into a run
    const rate = Math.abs(along) > RUN_SPEED ? 16 : 30;
    along += Math.max(-rate * dt, Math.min(rate * dt, target - along));
    v.set(fx * along, 0, fz * along);
    if (target > 0.1 || Math.abs(along) > 0.5) ent.runPhase += dt * (4 + Math.abs(along) * 0.75);
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
    // Steer the momentum towards where the stick points; ahead it pumps, against it brakes
    let pump = 0, brake = 0;
    // Diving (clicked on with the stick): head first, falling fast, still steering a little with the sides. A web
    // fired out of a dive turns all that speed into a huge swing
    if (ent.state !== 'air') ent.diving = ent.gliding = false;
    let steer = 0;
    if (ent.diving) {
      v.y -= GRAVITY * (DIVE_GRAVITY - 1) * dt;
      steerVelocity(ent, turn * 0.6, dt);
    } else if (ent.gliding && stickMag > 0.12) {
      // On the wings the stick flies him like a plane, not towards a point: sideways banks him round, pushed on
      // dips the nose (a dive) and pulled back raises it (a climb). (Camera-relative, pulled back would mean
      // turn round)
      const vert = fwdIn - backIn;
      steer = Math.max(-1, Math.min(1, turn));
      steerVelocity(ent, steer * GLIDE_TURN / AIR_TURN_RATE, dt);
      pump = Math.max(0, vert);
      brake = Math.max(0, -vert) * 0.5;
    } else if (wantYaw !== null) {
      const travel = travelDirection(ent);
      const diff = angleDiff(wantYaw, Math.atan2(travel.x, travel.z));
      steer = Math.max(-1, Math.min(1, diff * 1.5)) * stickMag;
      steerVelocity(ent, steer, dt);
      pump = stickMag * Math.max(0, Math.cos(diff));
      brake = stickMag * Math.max(0, -Math.cos(diff)) * 0.5;
    } else if (!web.chosen) {
      // (not after a web from a chosen hand: then the line he takes is the player's, zigzag and all)
      alignToGrid(ent, dt);
    }
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
      if (v.y < zip.rise) v.y = Math.min(zip.rise, v.y + ZIP_LIFT * step);
    }
    const bankK = 1 - Math.exp(-dt * 4);
    ent.glideBank += ((ent.gliding ? steer : 0) - ent.glideBank) * bankK;
    if (ent.gliding) {
      // Gliding: he flies along a path angle that follows the nose, and speed and height trade like a real glider's.
      // Hands off, the path is a shallow slope down and the speed settles at GLIDE_SPEED. The stick pushed on dips
      // the nose: diving, gravity speeds him up. Pulled back, the nose comes up: climbing, gravity slows him down,
      // until near a stall the nose drops again by itself. Opening the wings out of a fall (or a dive) keeps the
      // speed while the path is pulled out level, so a dive into a glide is the fastest way across open ground
      // (gravity is taken along the path below, so not straight down as well)
      v.y += GRAVITY * dt;
      let speed = v.length();
      if (ent.glidePath === null) ent.glidePath = speed > 1 ? Math.atan2(v.y, hs) : -1.2;
      const flare = brake * 2;
      let target = -GLIDE_ANGLE - GLIDE_DIVE * pump + GLIDE_CLIMB * flare;
      const mush = GLIDE_STALL * 1.25;
      if (speed < mush) target = Math.min(target, -GLIDE_ANGLE - 0.9 * (1 - speed / mush));
      const lift = Math.min(1, (speed / GLIDE_STALL) ** 2);
      const turnBy = target - ent.glidePath;
      ent.glidePath += Math.sign(turnBy) * Math.min(Math.abs(turnBy), GLIDE_PITCH_RATE * lift * dt);
      // (gravity along the path, measured from the hands-off slope; the wings' drag settles the rest)
      speed -= GRAVITY * (Math.sin(ent.glidePath) + Math.sin(GLIDE_ANGLE)) * dt;
      if (speed < GLIDE_SPEED) speed += Math.min(GLIDE_SPEED - speed, 2 * dt);
      else speed -= (speed - GLIDE_SPEED) * Math.min(1, 0.25 * dt);
      speed = Math.max(0, speed);
      const level = Math.cos(ent.glidePath) * speed;
      v.set(dir.x * level, Math.sin(ent.glidePath) * speed, dir.z * level);
    } else {
      ent.glidePath = null;
    }
    // (the nose follows the path on the wings: up when climbing, down in a dive)
    const pitch = ent.gliding ? Math.max(-1.2, Math.min(2, (-GLIDE_ANGLE - ent.glidePath) / GLIDE_DIVE)) : 0;
    ent.glidePitch += (pitch - ent.glidePitch) * bankK;
    if (ent.state === 'air' && !ent.gliding) {
      // Light air control and drag; terminal velocity keeps long falls readable
      if (pump && hs < 16) { v.x += dir.x * 7 * pump * dt; v.z += dir.z * 7 * pump * dt; }
      if (brake) { v.x *= 1 - Math.min(1, 1.5 * brake * dt); v.z *= 1 - Math.min(1, 1.5 * brake * dt); }
      v.y = Math.max(v.y, ent.diving ? -DIVE_MAX_FALL : -42);
    } else if (ent.state === 'swing') {
      // A gentle push on the down stroke (more with the stick held forward) keeps chained swings flowing; once
      // he's hung on into a swing back he only coasts, with a little drag, so it settles into a dangle
      if (!web.turned && v.x * web.dirX + v.z * web.dirZ > 0) {
        if (v.y <= 0) {
          const push = 4.5 + 6 * pump;
          v.x += dir.x * push * dt;
          v.z += dir.z * push * dt;
        }
      } else {
        v.multiplyScalar(1 - Math.min(1, 0.35 * dt));
      }
    }
    clampSpeed(v);
    p.addScaledVector(v, dt);

    // Rope: an inextensible distance constraint about the pivot, measured from the hips. Except as the web catches:
    // a rigid rope would turn his fall into the arc in a single frame (the hard kink from falling to swinging), so
    // for the first moments it's a critically damped spring that firms up fast, stretching a little and easing
    // him onto the arc. Then the rope locks at whatever length it has stretched to, and reels back in from there.
    if (ent.state === 'swing') {
      web.swingTime += dt;
      // Roofs and ledges coming up under the arc: shorten the web in good time so the swing passes over them,
      // instead of scraping them (which stopped the dive dead and threw him upwards)
      if (v.x * web.dirX + v.z * web.dirZ > 0) {
        const clear = clearRopeLength(controllers, web, p, web.dirX, web.dirZ);
        if (clear < web.targetLength) web.targetLength = Math.max(6, clear);
      }
      // Taken in over the down-swing, paced to finish as he reaches the bottom of the arc: hauled in all at once, as
      // the web caught, it lifted him bodily before the swing had even begun
      let reel = 0;
      if (web.targetLength < web.length) {
        const need = web.length - web.targetLength;
        const toBottom = (web.pivot.x - p.x) * web.dirX + (web.pivot.z - p.z) * web.dirZ;
        const time = Math.max(0.35, Math.min(REEL_TIME, Math.max(0, toBottom) / Math.max(4, hs)));
        reel = -Math.min(need, need / time * dt);
      }
      _center.set(p.x, p.y + 1.0, p.z);
      _offset.subVectors(_center, web.pivot);
      let d = _offset.length();
      if (d > 1e-4) _offset.multiplyScalar(1 / d);
      // The web never hangs slack. A slack web lets him fall free until it snaps tight again somewhere down the
      // arc, turning a dive into a climb in an instant (the swing looks cut). As it catches, moving in towards the
      // anchor turns into swinging along the arc instead (keeping his speed: arcade, but it's what makes a web
      // shot far ahead a long swooping arc, rather than one he drifts in under); any slack left is taken in
      // A chosen hand's swing, as it catches: drifting across the street away from that side (left over from the
      // last swing) turns into speed along the street, as moving in does above, so the swing goes where he chose
      // instead of first carrying him on into the wall behind
      if (web.chosen && !web.double && !web.caught) {
        const away = -(v.x * web.towardX + v.z * web.towardZ);
        if (away > 0) {
          const speed = v.length();
          const k = away * Math.min(1, dt * ROD_RATE);
          v.x += web.towardX * k;
          v.z += web.towardZ * k;
          const now = v.length();
          if (now > 1e-4) v.multiplyScalar(speed / now);
        }
      }
      if (d < web.length) {
        const radial = v.dot(_offset);
        if (!web.caught && radial < 0) {
          const speed = v.length();
          v.addScaledVector(_offset, -radial * Math.min(1, dt * ROD_RATE));
          const now = v.length();
          if (now > 1e-4) v.multiplyScalar(speed / now);
        }
        web.length = Math.max(6, d);
        web.targetLength = Math.min(web.targetLength, web.length);
      }
      // (it locks only while taut and no longer stretching, so it never snaps tight)
      if (!web.caught && web.swingTime >= ROPE_CATCH && d >= web.length && v.dot(_offset) < 0.5) {
        web.caught = true;
        web.length = d;
      }
      const catching = !web.caught;
      if (catching) {
        // Reeling in moves him with the rope, rather than winding up the spring (which would add energy)
        if (d >= web.length && d > 1e-4) {
          p.addScaledVector(_offset, reel);
          d += reel;
        }
      }
      web.length += reel;
      if (d > web.length && d > 1e-4) {
        const stretch = d - web.length;
        const radial = v.dot(_offset);
        if (catching) {
          const firm = Math.min(1, web.swingTime / ROPE_CATCH);
          const k = ROPE_SOFT + (ROPE_STIFF - ROPE_SOFT) * firm * firm;
          // (implicit in the damping, so it stays stable at any frame rate; a rope only resists being stretched, so
          // it damps outward motion only)
          const pulled = radial - k * stretch * dt;
          const radialNew = pulled > 0 ? pulled / (1 + 2 * Math.sqrt(k) * dt) : pulled;
          v.addScaledVector(_offset, radialNew - radial);
        }
        if (!catching || stretch > ROPE_MAX_STRETCH) {
          _center.copy(web.pivot).addScaledVector(_offset, web.length + (catching ? ROPE_MAX_STRETCH : 0));
          p.set(_center.x, _center.y - 1.0, _center.z);
          const out = v.dot(_offset);
          if (out > 0) v.addScaledVector(_offset, -out);
        }
      }
      // He hangs on for as long as the button is held (it's the release that flings him on); passing the bottom
      // is still noted for the swing pose
      const aheadOfPivot = (p.x - web.pivot.x) * dir.x + (p.z - web.pivot.z) * dir.z;
      if (aheadOfPivot > 0) web.passedBottom = true;
      if (web.passedBottom && v.y > 3) web.rising = true;
      // Hanging on past the top of the arc: once he's really moving back, that's his new way forward, and he
      // turns round to face it (not before: slowing to a stop at the top doesn't spin him)
      if (v.x * web.dirX + v.z * web.dirZ < -SWING_TURN_SPEED) {
        web.dirX = -web.dirX;
        web.dirZ = -web.dirZ;
        web.passedBottom = web.rising = false;
        web.turned = true;
      }
    }

    // Facing follows the momentum. On a web, only while he's clearly moving along the swing: near the top of an arc
    // the sideways drift would otherwise swing him about
    const along = ent.state === 'swing' ? v.x * web.dirX + v.z * web.dirZ : hs;
    if (hs > 2 && along > SWING_TURN_SPEED) {
      const want = Math.atan2(v.x, v.z);
      let diff = want - ent.heading;
      diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
      ent.heading += diff * (1 - Math.exp(-dt * (ent.state === 'swing' ? 5 : 8)));
    }

    // Landing (street, sidewalk or rooftop)
    const ground = groundAt(controllers, p.x, p.z, _before.y);
    if (p.y <= ground) {
      p.y = ground;
      if (ent.state === 'swing') {
        // Scraping the ground or a roof anyway: slide over it, and take the web in a little to lift off again
        web.targetLength = Math.max(6, web.targetLength - 1);
        v.y = Math.max(0, v.y);
      } else {
        ent.crouch = Math.min(1, -v.y / 22);
        ent.state = 'ground';
        v.y = 0;
        ent.flip = ent.roll = 1;
      }
    }
  } else if (ent.state === 'whip') {
    // Whipping round a corner: a level swing round the web (a tetherball round a pole). The web only ever pulls in
    // towards the corner, square to his motion, so it turns him without slowing him: as he comes up to the corner
    // it's taken in (down to how far across from it he was), and once he's past it, it holds him at that radius and
    // his line of travel swings round. He lets go once he's heading where the stick pointed as he threw the web
    // (fixed then: the camera turns round with him, so the stick's direction turns too), flung on into the new street
    web.swingTime += dt;
    const speed = Math.max(Math.hypot(v.x, v.z), WHIP_MIN_SPEED);
    const before = Math.atan2(v.x, v.z);
    v.y = Math.max(v.y - GRAVITY * WHIP_GRAVITY * dt, -6);
    p.addScaledVector(v, dt);
    const dx = p.x - web.pivot.x, dz = p.z - web.pivot.z;
    const d = Math.hypot(dx, dz);
    if (d < web.length) web.length = Math.max(web.whipRadius, d);
    if (d < web.whipRadius && d > 1e-4) {
      // (arcade: never closer than that, as if the web were a rod, so he can't cut the corner into the wall)
      const ux = dx / d, uz = dz / d;
      p.x = web.pivot.x + ux * web.whipRadius;
      p.z = web.pivot.z + uz * web.whipRadius;
      const inward = v.x * ux + v.z * uz;
      if (inward < 0) { v.x -= ux * inward; v.z -= uz * inward; }
    } else if (d > web.length && d > 1e-4) {
      const ux = dx / d, uz = dz / d;
      p.x = web.pivot.x + ux * web.length;
      p.z = web.pivot.z + uz * web.length;
      const out = v.x * ux + v.z * uz;
      if (out > 0) { v.x -= ux * out; v.z -= uz * out; }
    }
    // (arcade: the speed he came in with, all of it, goes round the corner)
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1e-3) { v.x *= speed / hs; v.z *= speed / hs; }
    const yaw = Math.atan2(v.x, v.z);
    web.whipTurned += Math.abs(angleDiff(yaw, before));
    ent.heading += angleDiff(yaw, ent.heading) * (1 - Math.exp(-dt * 10));
    const ground = groundAt(controllers, p.x, p.z, _before.y);
    if (p.y <= ground) {
      p.y = ground;
      v.y = Math.max(0, v.y);
    }
    if (Math.abs(angleDiff(yaw, web.whipYaw)) < WHIP_DONE || web.whipTurned > 3.5 || web.swingTime > 3) releaseWeb(controllers, ent, true);
  } else if (ent.state === 'wall') {
    // Crawling: only while the stick is held (up climbs head first, down goes down head first, the sides go
    // sideways); let go of the stick and he holds still
    const w = ent.wall;
    w.time += dt;
    const vert = fwdIn - backIn;
    // The web buttons on a wall: with the stick the way he's crawling (or facing, holding still), a web along the
    // wall that pulls him on faster; with it the other way, he jumps off the building; with it centred he kicks
    // off and carries on (holding the button as he lands on the wall does the same, flowing on into a swing)
    if (pressed && Math.hypot(vert, turn) > 0.3 && zip.cooldown <= 0) {
      const aim = Math.atan2(turn, vert);
      const n = Math.hypot(vert, turn);
      if (Math.abs(angleDiff(aim, w.angle)) < WALL_ZIP_CONE) wallZip(ent, turn / n, vert / n, groundAt(controllers, p.x, p.z, p.y));
      else jumpOffWall(ent, turn / n);
    } else if (pressed || (held && !w.used && w.time > 0.35)) {
      kickOffWall(ent, 0);
    }
  }
  if (ent.state === 'wall') {
    const w = ent.wall;
    const lx = -w.nz, lz = w.nx;
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
    if (w.dash > 0) {
      // Pulled along his web, head first the way it goes
      v.x += lx * w.dashS * w.dash;
      v.y += w.dashV * w.dash;
      v.z += lz * w.dashS * w.dash;
      w.dash = Math.max(0, w.dash - WALL_ZIP_DECAY * dt);
      w.angle += angleDiff(Math.atan2(w.dashS, w.dashV), w.angle) * (1 - Math.exp(-dt * 10));
      w.move = Math.max(w.move, CRAWL_UP_SPEED);
    }
    p.addScaledVector(v, dt);
    ent.heading = Math.atan2(-w.nx, -w.nz);
    const ground = groundAt(controllers, p.x, p.z, p.y);
    if (v.y < 0 && p.y <= ground + 0.02) {
      // Down at the bottom: stand up
      p.y = ground;
      ent.state = 'ground';
    } else if (p.y + 1.1 >= w.top && v.y > 0) {
      // Vault over the parapet onto the roof (higher, pulled up by a web)
      ent.cameraLock = CAMERA_LOCK;
      p.y = w.top;
      p.x -= w.nx * 0.9;
      p.z -= w.nz * 0.9;
      v.set(-w.nx * 4, 3.5 + Math.max(0, w.dash * w.dashV) * 0.4, -w.nz * 4);
      w.dash = 0;
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
    // The stick steers the run across the wall's face, like a crawl, and keeps it going: relative to the camera
    // like everywhere else, so pushed along the wall he runs that way, into it he runs up it and away from it
    // down it. Pushed back against the run he brakes; let go of it and he slows to a stop and clings on
    const lx = -w.nz, lz = w.nx;
    let drag = WALL_RUN_BRAKE;
    if (wantYaw !== null && stickMag > 0.3) {
      const sx = Math.sin(wantYaw), sz = Math.cos(wantYaw);
      const along = sx * lx + sz * lz;
      let up = -(sx * w.nx + sz * w.nz);
      // (a stick held roughly along the wall keeps a run along it level)
      up = Math.sign(up) * Math.max(0, Math.abs(up) - 0.25) / 0.75;
      const n = Math.hypot(along, up) || 1;
      const tx = lx * along / n, ty = up / n, tz = lz * along / n;
      if (r.dx * tx + r.dy * ty + r.dz * tz < -0.3) {
        drag = WALL_RUN_BRAKE * 1.5;
      } else {
        drag = 0.6;
        const k = 1 - Math.exp(-dt * WALL_RUN_STEER);
        r.dx += (tx - r.dx) * k; r.dy += (ty - r.dy) * k; r.dz += (tz - r.dz) * k;
        const len = Math.hypot(r.dx, r.dy, r.dz) || 1;
        r.dx /= len; r.dy /= len; r.dz /= len;
      }
    } else if (r.dy <= 0.7) {
      // Level out along the wall
      r.dy *= Math.exp(-dt * 2.5);
      const h = Math.hypot(r.dx, r.dz) || 1;
      const k = Math.sqrt(Math.max(0, 1 - r.dy * r.dy)) / h;
      r.dx *= k; r.dz *= k;
    }
    // (running up costs speed, running down gains it)
    r.speed = Math.min(Math.max(r.speed, WALL_RUN_MAX), r.speed - (drag + GRAVITY * 0.5 * r.dy) * dt);
    const vertical = r.dy > 0.7;
    v.set(r.dx * r.speed, r.dy * r.speed, r.dz * r.speed);
    p.addScaledVector(v, dt);
    ent.runPhase += dt * (5 + r.speed * 0.55);
    ent.heading = vertical || Math.hypot(r.dx, r.dz) < 0.3 ? Math.atan2(-w.nx, -w.nz) : Math.atan2(r.dx, r.dz);
    const ground = groundAt(controllers, p.x, p.z, _before.y);
    if (pressed || (!vertical && held && w.time > 0.3)) {
      // Kick off and carry on (holding the button through a run along a wall flows straight into the next swing)
      const carry = r.speed;
      v.set(r.dx * carry + w.nx * 7, Math.max(r.dy * carry, 0) + 7, r.dz * carry + w.nz * 7);
      ent.heading = Math.atan2(v.x, v.z);
      ent.state = 'air';
      ent.webCooldown = 0.1;
      if (carry > 16) ent.flip = 0;
    } else if (r.dy > 0.3 && p.y + 1.4 >= w.top) {
      // Up and over the top with the run's momentum
      ent.cameraLock = CAMERA_LOCK;
      v.set(-w.nx * 5, Math.min(r.speed, 16) * 0.7 + 4, -w.nz * 5);
      ent.state = 'air';
      ent.flip = 0;
    } else if (r.speed < 4.5) {
      // Out of steam: cling on, head the way he was running
      startCrawl(ent, Math.atan2(r.dx * lx + r.dz * lz, r.dy));
    } else if (!vertical && p.y <= ground + 0.02) {
      // Ran down onto the street or a roof: keep running
      p.y = ground;
      v.set(r.dx * r.speed, 0, r.dz * r.speed);
      ent.state = 'ground';
    }
    if (ent.state === 'wallrun' || ent.state === 'wall') {
      // (out of steam too: he clings on, rather than coming away from the wall)
      p.y = Math.max(p.y, ground);
      p.x -= w.nx * 0.25;
      p.z -= w.nz * 0.25;
    }
  } else if (ent.state === 'sling') {
    // The slingshot: both buttons held, the webs fly out and stick; then he's the pouch. The stick moves him, in a
    // squat: pulled down he backs away, stretching the webs (ever more slowly, the further they stretch); sideways he
    // steps to that side. He always faces between the two anchors, so a step right swings the aim left, as pulling a
    // slingshot's pouch does. Letting go of either button launches him (or, barely drawn, drops the webs)
    const sling = ent.sling;
    v.set(0, 0, 0);
    if (sling.phase === 'shooting' && (sling.travelled += WEB_SPEED * dt) >= sling.distance) {
      sling.phase = 'set';
      if (ent.webs) for (let i = 0; i < 2; i++) sling.splats[i] = stickSplat(ent, sling.anchors[i], sling.normals[i], true);
    }
    if (!(btnL && btnR)) {
      if (sling.phase === 'set' && sling.draw >= SLING_MIN_DRAW) launchSling(controllers, ent);
      else {
        dropSling(ent);
        ent.state = 'ground';
      }
    } else if (sling.phase === 'set') {
      const [a, b] = sling.anchors;
      const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
      const d = Math.hypot(p.x - mx, p.z - mz) || 1;
      const ux = (p.x - mx) / d, uz = (p.z - mz) / d; // back, away from the anchors
      const rx = uz, rz = -ux;                          // his right, facing them
      const stretch = sling.draw / SLING_DRAW;
      const pull = backIn - fwdIn;
      const back = pull * SLING_BACK_SPEED * (pull > 0 ? 1 - 0.75 * stretch * stretch : 1);
      const side = -turn * SLING_SIDE_SPEED;
      const nx = p.x + (ux * back + rx * side) * dt, nz = p.z + (uz * back + rz * side) * dt;
      const nd = Math.hypot(nx - mx, nz - mz) || 1;
      const draw = nd - sling.rest;
      const aim = -((nx - mx) * sling.homeX + (nz - mz) * sling.homeZ) / nd;
      // (within the draw and the aim's reach, and never off a roof's edge or up a step: he digs his heels in instead)
      const ground = groundAt(controllers, nx, nz, p.y);
      if ((back || side) && draw >= -0.01 && draw <= SLING_DRAW && aim > Math.cos(SLING_AIM_MAX) && Math.abs(ground - p.y) < 0.4) {
        ent.runPhase += Math.hypot(nx - p.x, nz - p.z) * 3.2;
        p.set(nx, ground, nz);
        sling.draw = Math.max(0, draw);
      }
      ent.heading += angleDiff(Math.atan2(mx - p.x, mz - p.z), ent.heading) * (1 - Math.exp(-dt * 10));
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
      // (round a corner onto the next face of the building, an inside corner or an outside one: the camera swings
      // round to it with him)
      const w = ent.wall;
      if (w.faceX * nx + w.faceZ * nz < 0.85) {
        ent.cameraLock = CAMERA_LOCK;
        w.faceX = nx; w.faceZ = nz;
      }
      w.nx = nx; w.nz = nz;
    } else {
      // What a wall does to him: fast enough, he runs along it (or up it, head on); slower, he sticks to it.
      // Brushing one mid-swing just slides along it
      let mode = null;
      if (ent.state === 'air') mode = hs >= WALL_RUN_MIN_SPEED ? 'run' : !held || -into > 6 ? 'crawl' : null;
      else if (ent.state === 'swing' || ent.state === 'whip') mode = -into > 4 ? (hs >= WALL_RUN_MIN_SPEED ? 'run' : 'crawl') : hs < 5 ? 'crawl' : null;
      else if (ent.state === 'ground' && stickMag > 0.5 && -into > 1) mode = hs >= WALL_RUN_MIN_SPEED ? 'run' : 'crawl';
      const reaching = ent.state === 'air' || (ent.state === 'ground' && stickMag > 0.5);
      const top = mode || (reaching && -into > 0.5) ? wallTopAt(controllers, p.x - nx * 0.6, p.y + 0.5, p.z - nz * 0.6) : -Infinity;
      if (reaching && top > p.y + 0.3 && top <= p.y + 2.2) {
        // A ledge within reach (a parapet, a step in the roof): pull himself up onto it
        p.set(p.x - nx * 0.7, top, p.z - nz * 0.7);
        v.set(-nx * Math.max(4, hs * 0.5), 0, -nz * Math.max(4, hs * 0.5));
        ent.state = 'ground';
        ent.crouch = 0.6;
      } else if (mode && top > p.y + 2.2) {
        if (ent.state === 'swing' || ent.state === 'whip') releaseWeb(controllers, ent, false);
        const travel = Math.hypot(tx, tz);
        const w = ent.wall;
        w.nx = w.faceX = nx; w.nz = w.faceZ = nz; w.top = top; w.time = 0;
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
    // Crawling sideways off the edge of the wall: if the building carries on round the corner (behind the wall he
    // was on, back the way he came), round it he goes, onto the next face, crawling on the same way
    const lx = -w.nz, lz = w.nx;
    const along = v.x * lx + v.z * lz;
    const tx = lx * Math.sign(along), tz = lz * Math.sign(along);
    const round = ent.state === 'wall' && Math.abs(along) > 0.5 && p.y + 0.5 < w.top
      && solidAt(controllers, p.x - w.nx * 0.8 - tx * 0.8, p.y + 0.5, p.z - w.nz * 0.8 - tz * 0.8);
    if (round) {
      p.x -= w.nx * 0.9;
      p.z -= w.nz * 0.9;
      w.nx = w.faceX = tx; w.nz = w.faceZ = tz;
      ent.heading = Math.atan2(-tx, -tz);
      ent.cameraLock = CAMERA_LOCK;
    } else if (v.y > 0.5) {
      // The wall ended above him (a ledge, a setback): up and over it onto the roof
      ent.cameraLock = CAMERA_LOCK;
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
    if (!round) ent.state = 'air';
  }

  // A zip's pull only carries him through the air: landing, a new swing or a wall ends it (and lets him zip again)
  if (ent.state !== 'air') {
    ent.diving = ent.gliding = false;
    zip.pull = 0;
    zip.chain = 0;
  }

  // The follow camera stays locked on close behind him (see cameras.js) except while he swings and flies between
  // swings, when it lags like a hand-held one: on foot, drawing a slingshot, whipping round a corner, on a wall, and
  // for a moment after (climbing over the top of a wall onto the roof, or round from one face of a building to the
  // next, see above, lock it on too)
  ent.cameraLock = ent.state === 'swing' || ent.state === 'air' ? Math.max(0, ent.cameraLock - dt) : CAMERA_LOCK;

  // The follow camera looks up the wall as he climbs it and down it as he crawls down (and up a run up a wall)
  // ...and along it, to the side he's crawling (positive: his left)
  let pitch = 0, side = 0;
  if (ent.state === 'wall') {
    pitch = Math.cos(ent.wall.angle) * 0.8;
    side = Math.sin(ent.wall.angle) * 0.8;
  } else if (ent.state === 'wallrun' && Math.abs(ent.wallRun.dy) > 0.7) {
    pitch = 0.8 * Math.sign(ent.wallRun.dy);
  }
  const ease = 1 - Math.exp(-dt * (ent.cameraLock > 0 ? 10 : 3));
  ent.cameraPitch += (pitch - ent.cameraPitch) * ease;
  ent.cameraSide += (side - ent.cameraSide) * ease;

  // Never below the street (tunnels, piers or a teleport onto a roof edge)
  const floor = controllers.getGroundHeight(p.x, p.z, 'person');
  if (p.y < floor) {
    p.y = floor;
    if (ent.state === 'air') { ent.state = 'ground'; v.y = 0; }
  }

  ent.speed = ent.state === 'wallrun' ? ent.wallRun.speed
    : Math.hypot(v.x, v.z, ent.state === 'swing' || ent.state === 'whip' || ent.state === 'air' ? v.y * 0.5 : 0);
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
  } else if (ent.state === 'sling') {
    // Drawing the slingshot: a deep squat, both fists out in front holding the webs, leaning back against them more
    // the further they stretch; short shuffling steps backing off
    const pull = Math.min(1, ent.sling.draw / SLING_DRAW);
    const s = Math.sin(ent.runPhase);
    setPose(t, 'spine', 0.3 - pull * 0.4, 0, 0);
    setPose(t, 'neck', -0.2 + pull * 0.3, 0, 0);
    setPose(t, 'shL', -1.35 - pull * 0.15, 0, 0.22);
    setPose(t, 'shR', -1.35 - pull * 0.15, 0, -0.22);
    setPose(t, 'elL', -0.45 + pull * 0.3, 0, 0);
    setPose(t, 'elR', -0.45 + pull * 0.3, 0, 0);
    setPose(t, 'hipL', -1.3 - s * 0.18, 0, 0.2);
    setPose(t, 'hipR', -1.3 + s * 0.18, 0, -0.2);
    setPose(t, 'knL', 1.95 + Math.max(0, s) * 0.3, 0, 0);
    setPose(t, 'knR', 1.95 + Math.max(0, -s) * 0.3, 0, 0);
    setPose(t, 'ftL', -0.5, 0, 0);
    setPose(t, 'ftR', -0.5, 0, 0);
  } else if (ent.gliding) {
    // Gliding: arms spread wide and a little forward, stretching the wings to his sides, legs apart and straight
    setPose(t, 'spine', -0.05, 0, 0);
    setPose(t, 'neck', -0.6, 0, 0);
    setPose(t, 'shL', -0.25, 0, 1.45);
    setPose(t, 'shR', -0.25, 0, -1.45);
    setPose(t, 'elL', -0.08, 0, 0);
    setPose(t, 'elR', -0.08, 0, 0);
    setPose(t, 'hipL', 0.05, 0, 0.3);
    setPose(t, 'hipR', 0.05, 0, -0.3);
    setPose(t, 'knL', 0.1, 0, 0);
    setPose(t, 'knR', 0.1, 0, 0);
    setPose(t, 'ftL', 0.7, 0, 0);
    setPose(t, 'ftR', 0.7, 0, 0);
  } else if (ent.diving) {
    // Diving head first: arms swept back along the sides, legs together and straight, toes pointed
    setPose(t, 'spine', 0.05, 0, 0);
    setPose(t, 'neck', -0.6, 0, 0);
    setPose(t, 'shL', 0.35, 0, 0.3);
    setPose(t, 'shR', 0.35, 0, -0.3);
    setPose(t, 'elL', -0.15, 0, 0);
    setPose(t, 'elR', -0.15, 0, 0);
    setPose(t, 'hipL', 0.08, 0, 0.03);
    setPose(t, 'hipR', 0.12, 0, -0.03);
    setPose(t, 'knL', 0.1, 0, 0);
    setPose(t, 'knR', 0.25, 0, 0);
    setPose(t, 'ftL', 0.7, 0, 0);
    setPose(t, 'ftR', 0.7, 0, 0);
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
    if (web.double) {
      // A double web: both arms up, one to each side of the street
      setPose(t, `sh${free}`, -0.05, 0, -s * 2.95);
      setPose(t, `el${free}`, -0.06, 0, 0);
    } else {
      setPose(t, `sh${free}`, -0.6, 0, -s * 1.0);
      setPose(t, `el${free}`, -0.9, 0, 0);
    }
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
  } else if (ent.diving && v.lengthSq() > 4) {
    _by.copy(v).normalize();
    _bz.set(0, -1, 0).addScaledVector(_by, _by.y);
    if (_bz.lengthSq() < 1e-4) _bz.set(Math.sin(ent.heading), 0, Math.cos(ent.heading));
  } else if (ent.gliding) {
    // Gliding: flat out, chest down, head the way he flies with the nose a little up (down, the stick pushed on)
    const fx = h > 1 ? v.x / h : _bz.x, fz = h > 1 ? v.z / h : _bz.z;
    const nose = 0.18 - ent.glidePitch * 0.3;
    _by.set(fx * Math.cos(nose), Math.sin(nose), fz * Math.cos(nose));
    _bz.set(0, -1, 0);
  } else if (ent.state === 'air' || ent.state === 'swing' || ent.state === 'whip') {
    // In flight he leans into the way he's going: head first and body stretched out at speed (more so falling,
    // less on the way up, when he tips back a little); zipping, flat out along the web
    const pitch = Math.max(-0.9, Math.min(0.5, Math.atan2(v.y, Math.max(h, 1)) * 0.55));
    const lean = ent.zip.time >= 0 ? 0.9
      : Math.max(-0.35, Math.min(0.95, AIR_LEAN * Math.min(1, h / 25) - Math.sin(pitch) * 0.8));
    _by.set(0, Math.cos(lean), 0).addScaledVector(_bz, Math.sin(lean));
    // On a web his up turns to the line of the web (facing his heading, square to it, so always along the arc),
    // eased in over the first half second; a web still flying out draws him a little towards it already
    let toWeb = 0;
    // (whipping round a corner, at once: the turn's pull flings him out along the web, feet first)
    if (web.phase === 'attached') toWeb = Math.min(1, web.swingTime / (ent.state === 'whip' ? 0.15 : 0.55));
    else if (web.phase === 'shooting') toWeb = 0.3 * Math.min(1, web.travelled / Math.max(1, web.distance));
    if (toWeb > 0) {
      toWeb = toWeb * toWeb * (3 - 2 * toWeb);
      _axis.set(web.aim.x - p.x, web.aim.y - p.y - 1.0, web.aim.z - p.z).normalize();
      _by.multiplyScalar(1 - toWeb).addScaledVector(_axis, toWeb);
    }
    _by.normalize();
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
  } else if (ent.gliding) {
    // banked into a turn, the inside wing down
    out.multiply(_qSpin.setFromAxisAngle(_axis.set(0, 1, 0), -ent.glideBank * 0.5));
  }
  return out;
}

// Where the pelvis sits relative to the simulated position (the feet, on the ground): crouched on landing, close
// to the facade when crawling, a leg's length out from it when running along it
function pelvisOffset(ent, out) {
  const w = ent.wall;
  if (ent.state === 'wall') return out.set(-w.nx * 0.12, 1.0, -w.nz * 0.12);
  if (ent.state === 'wallrun') return out.set(w.nx * 0.55, 1.0, w.nz * 0.55);
  if (ent.state === 'sling') return out.set(0, PELVIS_HEIGHT - 0.38, 0);
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
  // (gentler in the air and on the web, where the body flows from one attitude to the next)
  const turnRate = ent.state === 'whip' ? 14 : ent.state === 'air' || ent.state === 'swing' ? 6 : 10;
  ent.bodyQuat.slerp(_qWant, ent.flip < 1 || ent.roll < 1 ? 1 : 1 - Math.exp(-dt * turnRate));
  // For the swing camera: his up along the web (only while swinging; it settles back to level otherwise)
  if (ent.state === 'swing' && web.phase === 'attached') {
    _axis.set(web.aim.x - ent.position.x, web.aim.y - ent.position.y - 1, web.aim.z - ent.position.z).normalize();
  } else {
    _axis.set(0, 1, 0);
  }
  ent.swingUp.lerp(_axis, 1 - Math.exp(-dt * 2.5)).normalize();
  pelvisOffset(ent, _pelvisWant);
  ent.pelvisOffset.lerp(_pelvisWant, 1 - Math.exp(-dt * 12));
  _pelvis.copy(ent.position).add(ent.pelvisOffset);

  // The skinned body, posed in world space; the hands come back for the webs
  model.rig.poseFK(ent.bodyQuat, _pelvis, ent.pose, model.hands);
  applyRigToBones(model);

  // The web wings open (and fold) over a quarter second
  ent.glide += ((ent.gliding ? 1 : 0) - ent.glide) * Math.min(1, dt * 8);
  if (active && ent.glide > 0.02) {
    webs.wings.position.set(0, 0, 0);
    webs.wings.material.opacity = 0.85 * Math.min(1, ent.glide * 1.5);
    layWings(model, webs.wings, ent.glide);
  } else {
    webs.wings.position.set(0, -500, 0);
  }

  const strand = webs.strand;
  const sling = ent.sling;
  let from = null, to = null, fray = 0, normal = web.normal;
  if (active && sling.phase !== 'none') {
    // The slingshot: a web from each hand to its anchor, flying out, then stuck
    const set = sling.phase === 'set';
    for (let i = 0; i < 2; i++) {
      const hand = model.hands[i];
      if (set) sling.tips[i].copy(sling.anchors[i]);
      else sling.tips[i].lerpVectors(hand, sling.anchors[i], Math.min(1, sling.travelled / Math.max(1, hand.distanceTo(sling.anchors[i]))));
      layStrand(i === 0 ? strand : webs.strand2, hand, sling.tips[i], set ? 1 : 0, sling.normals[i]);
    }
  } else if (active && web.phase !== 'none') {
    from = model.hands[web.side > 0 ? 0 : 1];
    if (web.phase === 'attached') {
      web.tip.copy(web.anchor);
      fray = 1;
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
    fray = zip.time >= 0.07 ? 1 : 0;
    normal = zip.normal;
  }
  if (to) {
    layStrand(strand, from, to, fray, normal);
  } else if (!(active && sling.phase !== 'none')) {
    strand.position.set(0, -500, 0);
  }
  // A double web's second strand, from the other hand
  if (active && sling.phase !== 'none') {
    // (the slingshot's, laid above)
  } else if (active && web.double && web.phase !== 'none') {
    const from2 = model.hands[web.side > 0 ? 1 : 0];
    if (web.phase === 'attached') {
      web.tip2.copy(web.anchor2);
    } else {
      const t = Math.min(1, web.travelled / Math.max(1, web.distance2));
      web.tip2.lerpVectors(from2, web.anchor2, t);
      web.tip2.y += Math.sin(t * Math.PI) * 1.2;
    }
    layStrand(webs.strand2, from2, web.tip2, web.phase === 'attached' ? 1 : 0, web.normal2);
  } else {
    webs.strand2.position.set(0, -500, 0);
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
