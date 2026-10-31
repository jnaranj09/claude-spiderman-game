import * as THREE from 'three/webgpu';
import { bryantParkLawn } from './landmarks.js';

// js/cameras.js
// Multi-camera system supporting Third-Person Chase (with mouse/touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, 7 Iconic NYC Architectural Cameras, and Auto-Director Drone.

// How quickly the swing cam pans back round behind Spider-Man (rad/s): lower lags more
const SWING_CAM_PAN = 1.4;
// The swing cam's height above Spider-Man by how high he's swinging (m above the street, roofs aside -> m above
// his feet, at the default zoom). Up high it's the usual view from above; it comes down level with him through the
// middle heights, and close to the street it's a little below him, looking up at the swing
const SWING_CAM_HEIGHTS = [
  [8, -0.5],   // skimming the street: a little below him
  [15, 0],
  [24, 1],     // level with him
  [40, 3],
  [55, null],  // and up: the usual height (about 5 m above him)
];
function swingCamHeight(altitude, high) {
  const rows = SWING_CAM_HEIGHTS.map(([a, h]) => [a, h ?? high]);
  if (altitude <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    const [a1, h1] = rows[i];
    if (altitude <= a1) {
      const [a0, h0] = rows[i - 1];
      return h0 + (h1 - h0) * (altitude - a0) / (a1 - a0);
    }
  }
  return high;
}

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',         short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'swing',       name: 'Swing Cam',                short: 'Swing',       category: 'follow', fov: 58 },
  { id: 'action',      name: 'Low-Angle Action',         short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'centralPark', name: 'Central Park Oasis',       short: 'Central Pk',  category: 'scenic', fov: 52 },
  { id: 'fifthAve',    name: '5th Ave & Empire State',   short: '5th Ave',     category: 'scenic', fov: 48 },
  { id: 'timesSquare', name: 'Times Square Crossroads',  short: 'Times Sq',    category: 'scenic', fov: 58 },
  { id: 'chryslerGCT', name: '42nd St · Chrysler & GCT', short: 'Chrysler',    category: 'scenic', fov: 50 },
  { id: 'observatory', name: 'Empire State 86th Deck',   short: '86th Deck',   category: 'scenic', fov: 52 },
  { id: 'bryantPark',  name: 'Bryant Park & NYPL',       short: 'Bryant Pk',   category: 'scenic', fov: 52 },
  { id: 'waterfront',  name: 'East River & Skyline',     short: 'Skyline',     category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     short: 'Director',    category: 'scenic', fov: 50 }
];

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the boroughs & harbor run out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitYawVel = 0; // the swing cam's pan speed back round behind him (rad/s)
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    this.bindPointerControls();
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitYawVel = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  // Which way the camera looks, as a heading (radians, 0 = +Z): Spider-Man's stick is relative to it
  get yaw() {
    const d = this.camera.getWorldDirection(this._yawDir ??= new THREE.Vector3());
    return Math.atan2(d.x, d.z);
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this.setCameraPreset('chase', true);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    // Spider-Man turns to wherever the stick points relative to the camera, so the camera must not swing round with
    // his heading (that would turn "away from the camera" as he turns, and he'd run in circles): it holds its
    // direction as he turns, then drifts back behind him
    const spider = entity.type === 'spider';
    // ...except when he locks it on (entity.cameraLock: on foot, drawing a slingshot, whipping round a corner, on a
    // wall, and a moment after): then it turns with him, close behind. (Spider-Man reads the stick against the camera
    // as it was when the stick was pushed, so a camera that follows him round can't run him in circles)
    const locked = spider && entity.cameraLock > 0;
    if (spider) {
      if (this._headingEntity !== entity) {
        this._headingEntity = entity;
        this._lastHeading = entity.heading;
      }
      let turned = entity.heading - this._lastHeading;
      turned -= Math.round(turned / (Math.PI * 2)) * (Math.PI * 2);
      this._lastHeading = entity.heading;
      this.orbitYawOffset -= turned;
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && (spider || Math.abs(entity.speed) > 0.5)) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      if (locked) {
        this.orbitYawVel = 0;
        this.orbitYawOffset *= Math.exp(-dt * 7);
      } else if (spider && this.activePresetId === 'swing') {
        // The swing cam pans like someone filming him by hand: slow to react as he changes direction (a zigzag's
        // new swing sets off with the view still looking the old way), then swinging round to catch up and settling
        // in behind him. A damped spring, rather than easing straight back, which reacts at once
        const w = SWING_CAM_PAN, damping = 0.85;
        this.orbitYawVel += (-w * w * this.orbitYawOffset - 2 * damping * w * this.orbitYawVel) * dt;
        this.orbitYawOffset += this.orbitYawVel * dt;
      } else {
        this.orbitYawVel = 0;
        this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * (spider ? 1.3 : 2.2)));
      }
    } else {
      this.orbitYawVel = 0;
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;

    switch (this.activePresetId) {
      case 'swing':
      case 'chase': {
        // (chaseZoom: how far out this entity's view starts, which pinch / wheel zoom then scales)
        const zoom = this.zoomMultiplier * (entity.chaseZoom ?? 1);
        const dist = entity.chaseDistance * zoom * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        let height = entity.chaseHeight * zoom + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        // The swing cam rides lower the nearer the street he swings (eased, so crossing a roof's edge doesn't jolt it;
        // dragging the view up or down still tilts it from there)
        if (this.activePresetId === 'swing' && entity.type === 'spider') {
          const usual = entity.chaseHeight * zoom + Math.sin(0.09) * dist * 0.85;
          const want = entity.swingCamAltitude ? swingCamHeight(entity.altitude ?? 1e3, usual / this.zoomMultiplier) * this.zoomMultiplier : usual;
          this.swingHeight ??= want;
          this.swingHeight += (want - this.swingHeight) * (1 - Math.exp(-dt * 1.5));
          height += this.swingHeight - usual;
        }
        // Spider-Man on a wall: the camera drops below him (and comes in a little) to look steeply up the wall at the
        // sky as he climbs, and rises above him to look down it at the street as he crawls down
        // ...and likewise slides the other way along the wall to look ahead as he crawls sideways
        const tilt = entity.cameraPitch || 0;
        const side = entity.cameraSide || 0;
        const lean = Math.min(1, Math.hypot(tilt, side));
        const sideX = Math.cos(totalYaw) * side, sideZ = -Math.sin(totalYaw) * side; // towards his left, scaled
        const horizDist = (Math.cos(this.orbitPitchOffset) * dist + speedLag) * (1 - 0.35 * lean);
        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist - sideX * dist * 1.25,
          Math.max(0.65, entity.position.y + height - tilt * dist * 1.25),
          entity.position.z - Math.cos(totalYaw) * horizDist - sideZ * dist * 1.25
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : entity.type === 'spider' ? 0.75 : 1.55);
        // Spider-Man: look past him along the camera's own direction, so orbiting the view turns around him and
        // keeps him centred (the vehicles look ahead along their heading)
        const lookYaw = entity.type === 'spider' ? totalYaw : entity.heading;
        const lookAhead = 5.2 * (1 - 0.85 * lean);
        desiredLook.set(
          entity.position.x + Math.sin(lookYaw) * lookAhead + sideX * 9,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias + tilt * 9,
          entity.position.z + Math.cos(lookYaw) * lookAhead + sideZ * 9
        );
        if (this.activePresetId === 'swing') this.swingFraming(entity, dt, dist, desiredPos, desiredLook);
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'centralPark': {
        // Inside Central Park South looking across The Pond, Gapstow Bridge, The Mall, Sheep Meadow & UWS/UES Skylines
        const sway = Math.sin(elapsed * 0.22) * 3.5;
        desiredPos.set(-70.0 + sway, 14.0, -1425.0);
        desiredLook.set(-250.0, 6.5, -1690.0);
        break;
      }

      case 'fifthAve': {
        // 5th Avenue & 42nd St looking South down the 5th Ave canyon toward the Empire State Building
        const sway = Math.sin(elapsed * 0.25) * 1.8;
        desiredPos.set(0.0 + sway, 6.5, -20.0);
        desiredLook.set(-60.0, 150.0, 686.0);
        break;
      }

      case 'timesSquare': {
        // Times Square & Broadway looking across Duffy Square red steps and One Times Square billboards
        const sway = Math.sin(elapsed * 0.3) * 3.0;
        desiredPos.set(-603.0 + sway, 5.5, -290.0);
        desiredLook.set(-566.0, 40.0, -40.0);
        break;
      }

      case 'chryslerGCT': {
        // Park Ave & 42nd St intersection looking straight at Grand Central, MetLife, and Chrysler Building Crown
        const sway = Math.cos(elapsed * 0.22) * 2.5;
        desiredPos.set(300.0 + sway, 9.5, 95.0);
        desiredLook.set(470.0, 120.0, -50.0);
        break;
      }

      case 'observatory': {
        // Empire State Building 86th Floor Deck looking North-East across Midtown skyline
        const pan = Math.sin(elapsed * 0.18) * 80.0;
        desiredPos.set(-58.0, 322.0, 660.0);
        desiredLook.set(420.0 + pan, 150.0, -200.0);
        break;
      }

      case 'bryantPark': {
        // Inside Bryant Park Great Lawn looking East toward NYPL portico, One Vanderbilt & Chrysler Building
        const sway = Math.sin(elapsed * 0.25) * 1.5;
        const lawn = bryantParkLawn || { minX: -260, maxX: -150, minZ: 40, maxZ: 120, top: 1.3 };
        const lz = (lawn.minZ + lawn.maxZ) * 0.5;
        desiredPos.set(lawn.minX + 18.0, lawn.top + 1.7, lz + sway);
        desiredLook.set(lawn.maxX + 260.0, 70.0, lz - 60.0);
        break;
      }

      case 'waterfront': {
        // Over the shimmering East River looking across the FDR Drive, Queensboro Bridge & Midtown Skyline
        const drift = Math.sin(elapsed * 0.15) * 40.0;
        desiredPos.set(1640.0, 60.0, 60.0 + drift);
        desiredLook.set(150.0, 150.0, -150.0);
        break;
      }

      case 'drone': {
        const angle = elapsed * 0.07 + 0.65;
        const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
        const alt = 330.0 + Math.cos(elapsed * 0.19) * 90.0;
        desiredPos.set(
          Math.cos(angle) * radius + 60.0,
          alt,
          Math.sin(angle) * radius + 250.0
        );
        desiredLook.set(60.0, 160.0, 250.0);
        break;
      }
    }

    if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action' || this.activePresetId === 'swing') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      // The swing cam eases more softly: it floats with the swing rather than locking on
      // (but locks on, see above)
      const k = 1 - Math.exp(-dt * (this.activePresetId === 'swing' && !(entity.cameraLock > 0) ? 4.5 : 7));
      // Spider-Man drops and climbs far faster than any vehicle (a dive tops 60 m/s): his height is followed
      // tightly, or he'd fall out of the bottom of the frame
      const ky = entity.type === 'spider' ? 1 - Math.exp(-dt * 16) : k;
      this.followBaseY += (entity.position.y - this.followBaseY) * ky;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    this.camera.position.copy(this.currentPos);
    // The swing cam rolls a little with the swing; every other view stays level
    if (this.activePresetId === 'swing' && this.swingRoll) {
      this.camera.up.copy(this.swingRoll);
      this._rolled = true;
    } else if (this._rolled) {
      this.camera.up.set(0, 1, 0);
      this._rolled = false;
    }
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Swing cam: the chase framing, moved along with the swing. The camera rides part of the way round the arc with
   * him (his up along the web, `entity.swingUp`), looks along where he's flying (down the drop, up the rise, down a
   * dive) and rolls gently with the swing. Everything is smoothed, so it moves with the pendulum without jolting.
   */
  swingFraming(entity, dt, dist, desiredPos, desiredLook) {
    const k = 1 - Math.exp(-dt * 3);
    this._swingUp ??= new THREE.Vector3(0, 1, 0);
    this._flight ??= new THREE.Vector3(0, 0, 0);
    this.swingRoll ??= new THREE.Vector3(0, 1, 0);
    if (entity.swingUp) this._swingUp.lerp(entity.swingUp, k).normalize();
    const v = entity.velocity;
    const speed = v ? v.length() : 0;
    // Flight direction's climb or drop (-1 .. 1), only once he's really moving
    const climb = speed > 4 ? Math.max(-1, Math.min(1, v.y / speed)) : 0;
    this._flight.y += (climb - this._flight.y) * k;
    // Ride the arc: offset along how far his up leans from vertical
    desiredPos.x += (this._swingUp.x) * dist * 0.45;
    desiredPos.y += (this._swingUp.y - 1) * dist * 0.45 - this._flight.y * dist * 0.25;
    desiredPos.z += (this._swingUp.z) * dist * 0.45;
    // (never down in the street)
    desiredPos.y = Math.max(0.65, entity.position.y - (entity.altitude ?? 1e3) + 1, desiredPos.y);
    // Look where he's going
    desiredLook.y += this._flight.y * 6;
    // A gentle roll: a quarter of the way from level towards his lean
    this.swingRoll.set(0, 1, 0).lerp(this._swingUp, 0.25).normalize();
  }
}

export { CAMERA_PRESETS, CameraSystem };
