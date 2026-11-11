import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// js/lens-editor-stub.js
// Stands in for js/tsl-materials.js in the editors (lens-editor.html, body-editor.html, suit-editor.html): the suit
// material and the game's lighting (lighting.js) only need the city's shared lighting uniforms, not the city's
// materials (which pull in the whole map). And for js/city-config.js in the moves editor (pose-editor.html), which runs
// js/spiderman.js: the street he starts on
const cityUniforms = {
  uSunColor: uniform(new THREE.Color(0xffca92)),
  uSkyTopColor: uniform(new THREE.Color(0x2c568c)),
  uSkyHorizonColor: uniform(new THREE.Color(0xebd1b5)),
  uSkySunDir: uniform(new THREE.Vector3(-0.66, 0.34, -0.67).normalize()),
  uInteriorGlow: uniform(0.3), // daytime
  uNightLit: uniform(0.0),
  uRoadWetness: uniform(0.38),
  uCanyonBounce: uniform(0.52),
  uAmbientFlat: uniform(new THREE.Color(0.62, 0.62, 0.68))
};

const ISLAND_BOUNDS = { sidewalkHeight: 0 };
const streetZ = () => 0;

export { cityUniforms, ISLAND_BOUNDS, streetZ };
