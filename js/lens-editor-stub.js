import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// js/lens-editor-stub.js
// Stands in for js/tsl-materials.js in the lens editor (lens-editor.html): the suit material only needs the city's
// shared lighting uniforms, not the city's materials (which pull in the whole map)
const cityUniforms = {
  uInteriorGlow: uniform(0.3), // daytime
  uAmbientFlat: uniform(new THREE.Color(0.62, 0.62, 0.68))
};

export { cityUniforms };
