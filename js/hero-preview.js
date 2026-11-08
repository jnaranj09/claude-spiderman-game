import * as THREE from 'three/webgpu';
import {
  HERO_BODY, HERO_BONE_COUNT, PersonRig, heroBind, heroHelperPoses, heroPoseWeights, addHeroMorphs, buildPersonGeometry,
  createSpiderSuitMaterial, createInkOutlineMaterial
} from './pedestrians.js';

// js/hero-preview.js
// Spider-Man as the game draws him (his body, shoulder helpers, pose corrections, suit & ink outline), posed in a few
// fixed poses, for the editors.

// Joint angles as the game uses them (x swings a limb forward when negative, z raises the left arm sideways when
// positive and the right when negative), the pelvis's height and forward tilt
const J = (o) => Object.fromEntries(['spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR']
  .map((k) => [k, { x: (o[k] || [0])[0], y: (o[k] || [0, 0])[1] || 0, z: (o[k] || [0, 0, 0])[2] || 0 }]));
const HERO_POSE_SET = {
  stand: { label: 'Standing', pelvis: 0.96, pitch: 0, j: J({}) },
  out: { label: 'Arms out', pelvis: 0.96, pitch: 0, j: J({ shL: [0, 0, 1.5], shR: [0, 0, -1.5] }) },
  up: { label: 'Arms up', pelvis: 0.96, pitch: 0, j: J({ shL: [0, 0, 2.9], shR: [0, 0, -2.9] }) },
  reach: { label: 'Reach', pelvis: 0.96, pitch: 0, j: J({ shL: [-1.6, 0, 0.1], shR: [-1.6, 0, -0.1], elL: [-0.1], elR: [-0.1] }) },
  swing: { label: 'Swing', pelvis: 0.96, pitch: 0.15, j: J({ spine: [0.1], shL: [-0.5, 0, 2.7], elL: [-0.1], shR: [0.4, 0, -0.5], elR: [-1.2], hipL: [-0.9], knL: [1.4], hipR: [0.2], knR: [0.5] }) },
  crouch: { label: 'Crouch', pelvis: 0.5, pitch: 0.75, j: J({ spine: [0.2], neck: [-1.25], shL: [-0.7, 0, 0.75], elL: [-0.9], shR: [-0.35, 0, -1.25], elR: [-0.25], hipL: [-2.1, 0, 0.45], knL: [2.3], ftL: [0.2], hipR: [-2.1, 0, -0.45], knR: [2.3], ftR: [0.2] }) }
};

function skinnedHeroGeometry(body) {
  const geo = buildPersonGeometry(1, true, body).clone();
  const skin = geo.getAttribute('skin');
  const indices = new Uint16Array(skin.count * 4);
  const weights = new Float32Array(skin.count * 4);
  for (let i = 0; i < skin.count; i++) {
    indices[i * 4] = skin.getX(i);
    indices[i * 4 + 1] = skin.getY(i);
    weights[i * 4] = 1 - skin.getZ(i);
    weights[i * 4 + 1] = skin.getZ(i);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return addHeroMorphs(geo, body);
}

// { group (add it to a scene), setPose(name), mesh, outline }
function createHeroPreview(body = HERO_BODY) {
  const geometry = skinnedHeroGeometry(body);
  const mesh = new THREE.SkinnedMesh(geometry, createSpiderSuitMaterial());
  const outline = new THREE.SkinnedMesh(geometry, createInkOutlineMaterial());
  const bones = Array.from({ length: HERO_BONE_COUNT }, () => {
    const b = new THREE.Bone();
    b.matrixAutoUpdate = false;
    b.matrixWorldAutoUpdate = false;
    return b;
  });
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  outline.bind(mesh.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = outline.frustumCulled = false;
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh, outline);
  const rig = new PersonRig({ seed: 1, scale: 1, girth: 1, hair: 0, bind: heroBind(body) });
  const helpers = [0, 1].map(() => ({ q: new THREE.Quaternion(), t: new THREE.Vector3(), s: 1 }));
  const q = new THREE.Quaternion(), t = new THREE.Vector3(), s = new THREE.Vector3();
  function setPose(name) {
    const P = HERO_POSE_SET[name] || HERO_POSE_SET.stand;
    rig.poseFK(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), P.pitch), new THREE.Vector3(0, P.pelvis, 0), P.j, [new THREE.Vector3(), new THREE.Vector3()]);
    const a = rig.pose;
    for (let b = 0; b < 15; b++) {
      const o = b * 8;
      q.set(a[o], a[o + 1], a[o + 2], a[o + 3]); t.set(a[o + 4], a[o + 5], a[o + 6]); s.setScalar(a[o + 7]);
      bones[b].matrixWorld.compose(t, q, s);
    }
    heroHelperPoses(rig, helpers);
    helpers.forEach((h, k) => bones[15 + k].matrixWorld.compose(h.t, h.q, s.setScalar(h.s)));
    if (mesh.morphTargetInfluences) {
      heroPoseWeights(rig, mesh.morphTargetInfluences);
      mesh.morphTargetInfluences.forEach((v, i) => { outline.morphTargetInfluences[i] = v; });
    }
  }
  setPose('stand');
  return { group, mesh, outline, setPose };
}

export { HERO_POSE_SET, createHeroPreview };
