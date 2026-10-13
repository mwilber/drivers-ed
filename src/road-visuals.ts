import * as THREE from 'three';
import { APPROACHES, ROAD_SIGNS, ROAD_POSTS, SIGNAL_FIXTURES, LANE_ARROWS, type RoadSign } from './traffic-layout.ts';
import { signalState } from './traffic-rules.ts';
import { ROAD_HEIGHT } from './world-layout.ts';

export const ROAD_FIXTURE_BUDGET = { drawCalls: 24, triangles: 5000, geometryBytes: 131072, textureBytes: 9437184 } as const;

type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;
const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
};

/** Signs, arrows and signal silhouettes persist at every distance in cockpit/mirror passes.
 * The optional canvas factory lets geometry checks run without a browser; pixels are checked live. */
export function createRoadVisuals(scene: THREE.Scene, canvasFactory: CanvasFactory = browserCanvas) {
  const group = new THREE.Group(); group.name = 'Road fixtures'; scene.add(group);
  const cube = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x7b8181, roughness: 0.7 });
  // The face/back separation is smaller than depth precision at long cockpit distances.
  // Bias only the metal boards behind their unchanged faces, avoiding distant z-fighting.
  const boardMaterial = poleMaterial.clone(); boardMaterial.polygonOffset = true;
  boardMaterial.polygonOffsetFactor = 4; boardMaterial.polygonOffsetUnits = 4;
  const pending = new Map<string, { name: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; matrices: THREE.Matrix4[]; shadow: boolean }>();
  const pose = new THREE.Object3D();
  function add(name: string, geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial,
    x: number, y: number, z: number, w = 1, h = 1, d = 1, rotationY = 0, rotationX = 0, rotationZ = 0, shadow = true) {
    const key = `${name}:${geometry.uuid}:${material.uuid}`;
    if (!pending.has(key)) pending.set(key, { name, geometry, material, matrices: [], shadow });
    pose.position.set(x, y, z); pose.scale.set(w, h, d); pose.rotation.set(rotationX, rotationY, rotationZ); pose.updateMatrix();
    pending.get(key)!.matrices.push(pose.matrix.clone());
  }
  for (const post of ROAD_POSTS) add('Metal supports', cube, poleMaterial, post.x, post.height / 2, post.z, post.width, post.height, post.depth);
  const textures = new Map<string, THREE.CanvasTexture>();
  function signTexture(sign: RoadSign) {
    const key = `${sign.kind}-${sign.mph ?? ''}`;
    if (textures.has(key)) return textures.get(key)!;
    const canvas = canvasFactory(512, 512);
    const c = canvas.getContext('2d')!;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (sign.kind === 'stop') {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = Math.PI / 8 + i * Math.PI / 4;
        const x = 256 + Math.cos(angle) * 263, y = 256 + Math.sin(angle) * 263;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.fillStyle = '#b62725'; c.fill(); c.lineWidth = 12; c.strokeStyle = '#fff8ee'; c.stroke();
      c.fillStyle = '#fff8ee'; c.font = 'bold 145px sans-serif'; c.fillText('STOP', 256, 266);
    } else if (sign.kind === 'yield') {
      c.beginPath(); c.moveTo(26, 40); c.lineTo(486, 40); c.lineTo(256, 480); c.closePath();
      c.fillStyle = '#fff8ee'; c.fill(); c.lineWidth = 36; c.strokeStyle = '#b62725'; c.stroke();
      c.fillStyle = '#a12626'; c.font = 'bold 86px sans-serif'; c.fillText('YIELD', 256, 190);
    } else {
      c.fillStyle = '#fff8ee'; c.fillRect(0, 0, 512, 512);
      c.strokeStyle = '#262e2c'; c.lineWidth = 10; c.strokeRect(16, 16, 480, 480);
      c.fillStyle = sign.kind === 'parking' ? '#1b653e' : '#202726';
      if (sign.kind === 'speed') {
        c.font = 'bold 70px sans-serif'; c.fillText('SPEED', 256, 95); c.fillText('LIMIT', 256, 178);
        c.font = 'bold 235px sans-serif'; c.fillText(String(sign.mph), 256, 352);
      } else if (sign.kind === 'parking') {
        c.font = 'bold 285px sans-serif'; c.fillText('P', 256, 210);
        c.font = 'bold 56px sans-serif'; c.fillText('PARKING', 256, 416);
      } else {
        c.font = 'bold 86px sans-serif';
        for (const [i, text] of ['NO', 'TURN', 'ON RED'].entries()) c.fillText(text, 256, 120 + i * 136);
      }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.set(key, texture); return texture;
  }
  function backing(points: readonly (readonly [number, number])[]) {
    const shape = new THREE.Shape(); points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false, steps: 1 });
    geometry.translate(0, 0, -0.037); return geometry;
  }
  const boards = {
    rectangle: backing([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]),
    stop: backing(Array.from({ length: 8 }, (_, i) => {
      const angle = Math.PI / 8 + i * Math.PI / 4; return [Math.cos(angle) * 269 / 512, Math.sin(angle) * 269 / 512] as const;
    })),
    yield: backing([[-0.5, 234 / 512], [0, -0.5], [0.5, 234 / 512]]),
  };
  const faceMaterials = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
  function signBoard(texture: THREE.CanvasTexture, width: number, height: number, sign: RoadSign, y: number, plaque = false) {
    if (!faceMaterials.has(texture)) faceMaterials.set(texture, new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.1, roughness: 0.9, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.15 }));
    const x = sign.x - sign.direction.x * 0.08, z = sign.z - sign.direction.z * 0.08;
    const yaw = Math.atan2(-sign.direction.x, -sign.direction.z);
    const shape = plaque ? 'rectangle' : sign.kind === 'stop' || sign.kind === 'yield' ? sign.kind : 'rectangle';
    add(`Sign backs: ${shape}`, boards[shape], boardMaterial, x, y, z, width, height, 1, yaw);
    add(`Sign faces: ${plaque ? 'all-way' : `${sign.kind}-${sign.mph ?? ''}`}`, plane, faceMaterials.get(texture)!, x, y, z, width, height, 1, yaw, 0, 0, false);
  }
  for (const sign of ROAD_SIGNS) {
    const shared = sign.kind === 'speed' && ROAD_SIGNS.some(other => other.kind !== 'speed' && other.x === sign.x && other.z === sign.z);
    const width = sign.kind === 'speed' ? 0.9 : 1.1;
    const height = sign.kind === 'speed' ? 1.2 : 1.1;
    signBoard(signTexture(sign), width, height, sign, shared ? 1.25 : 2.65);
    if (sign.allWay) {
      if (!textures.has('all-way')) {
        const canvas = canvasFactory(512, 128);
        const c = canvas.getContext('2d')!; c.fillStyle = '#fff8ee'; c.fillRect(0, 0, 512, 128);
        c.fillStyle = '#202726'; c.font = 'bold 80px sans-serif'; c.textAlign = 'center'; c.fillText('ALL WAY', 256, 96);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.set('all-way', texture);
      }
      signBoard(textures.get('all-way')!, 0.8, 0.2, sign, 1.97, true);
    }
  }
  const arrowTextures = new Map<string, THREE.CanvasTexture>();
  const arrowMaterials = new Map<string, THREE.MeshStandardMaterial>();
  for (const arrow of LANE_ARROWS) {
    const key = arrow.turns.slice().sort().join(',');
    if (!arrowTextures.has(key)) {
      const canvas = canvasFactory(256, 256);
      const c = canvas.getContext('2d')!;
      c.strokeStyle = c.fillStyle = '#f3f1df'; c.lineWidth = 16;
      c.beginPath(); c.moveTo(128, 235); c.lineTo(128, arrow.turns.includes('straight') ? 45 : 125); c.stroke();
      const head = (x: number, y: number, angle: number) => {
        c.save(); c.translate(x, y); c.rotate(angle); c.beginPath(); c.moveTo(0, -24); c.lineTo(-24, 12); c.lineTo(24, 12); c.closePath(); c.fill(); c.restore();
      };
      if (arrow.turns.includes('straight')) head(128, 40, 0);
      for (const turn of ['left', 'right'] as const) {
        if (!arrow.turns.includes(turn)) continue;
        const x = turn === 'left' ? 36 : 220;
        c.beginPath(); c.moveTo(128, 160); c.quadraticCurveTo(128, 125, x, 125); c.stroke();
        head(x, 125, turn === 'left' ? -Math.PI / 2 : Math.PI / 2);
      }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      arrowTextures.set(key, texture);
      arrowMaterials.set(key, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 1 }));
    }
    add(`Lane arrows: ${key}`, plane, arrowMaterials.get(key)!, arrow.x, ROAD_HEIGHT + 0.012, arrow.z, 2.8, 3.8, 1, 0, -Math.PI / 2, Math.atan2(-arrow.direction.x, -arrow.direction.z), false);
  }
  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x252c2c });
  const hood = new THREE.BufferGeometry(), hoodVertices: number[] = [];
  // Open underneath so the lens remains unobstructed from the driver's approach.
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 10, b = (i + 1) * Math.PI / 10;
    const ax = Math.cos(a) * 0.205, ay = Math.sin(a) * 0.205, bx = Math.cos(b) * 0.205, by = Math.sin(b) * 0.205;
    hoodVertices.push(ax, ay, 0.16, bx, by, 0.16, bx, by, 0.4, ax, ay, 0.16, bx, by, 0.4, ax, ay, 0.4);
  }
  hood.setAttribute('position', new THREE.Float32BufferAttribute(hoodVertices, 3)); hood.computeVertexNormals();
  const hoodMaterial = housingMaterial.clone(); hoodMaterial.side = THREE.DoubleSide;
  const lensGeometry = new THREE.CircleGeometry(0.18, 20);
  const lenses: { group: 'ns' | 'ew'; color: number; matrix: THREE.Matrix4 }[] = [];
  const mast = new THREE.Object3D(), point = new THREE.Vector3();
  for (const signal of SIGNAL_FIXTURES) {
    const yaw = Math.atan2(-signal.direction.x, -signal.direction.z);
    mast.position.set(signal.x, 5.2, signal.z); mast.rotation.y = yaw; mast.updateMatrix();
    add('Signal housings', cube, housingMaterial, signal.x, 5.2, signal.z, 0.5, 1.55, 0.3, yaw);
    point.set(0, 0, -0.17).applyMatrix4(mast.matrix);
    add('Signal housings', cube, housingMaterial, point.x, point.y, point.z, 0.64, 1.7, 0.04, yaw);
    const signalGroup = APPROACHES.find(a => a.id === signal.approachId)!.signalGroup;
    for (let i = 0; i < 3; i++) {
      point.set(0, 0.49 - i * 0.49, 0).applyMatrix4(mast.matrix);
      add('Signal visors', hood, hoodMaterial, point.x, point.y, point.z, 1, 1, 1, yaw);
      lenses.push({ group: signalGroup, color: i, matrix: mast.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.49 - i * 0.49, 0.16)) });
    }
    const start = new THREE.Vector3(signal.pole.x, 5.7, signal.pole.z);
    const end = new THREE.Vector3(signal.x, 5.7, signal.z);
    add('Metal supports', cube, poleMaterial, (start.x + end.x) / 2, 5.7, (start.z + end.z) / 2, start.distanceTo(end), 0.12, 0.12, -Math.atan2(end.z - start.z, end.x - start.x));
  }
  for (const batch of pending.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length); mesh.name = batch.name;
    batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.computeBoundingSphere();
    mesh.castShadow = batch.shadow; mesh.receiveShadow = batch.shadow || batch.name.startsWith('Lane arrows:'); group.add(mesh);
  }
  const colors = ['red', 'yellow', 'green'] as const;
  const signalBatches = [-1, 0, 1, 2].map(color => {
    const hex = color < 0 ? 0x333a37 : [0xe43b2e, 0xf8bb33, 0x2ac657][color]!;
    const material = new THREE.MeshStandardMaterial({ color: hex, emissive: color < 0 ? 0 : hex, emissiveIntensity: color < 0 ? 0 : 3 });
    const mesh = new THREE.InstancedMesh(lensGeometry, material, color < 0 ? lenses.length : SIGNAL_FIXTURES.length);
    mesh.name = color < 0 ? 'Signal lenses: inactive' : `Signal lenses: ${colors[color]}`;
    group.add(mesh); return { mesh, color };
  });
  let previousState = '';
  function update(seconds: number) {
    const state = signalState(seconds), key = `${state.ns}:${state.ew}`;
    if (key === previousState) return;
    previousState = key;
    for (const batch of signalBatches) {
      let count = 0;
      for (const lens of lenses) {
        const active = state[lens.group] === colors[lens.color];
        if (batch.color < 0 ? !active : active && batch.color === lens.color) batch.mesh.setMatrixAt(count++, lens.matrix);
      }
      batch.mesh.count = count; batch.mesh.instanceMatrix.needsUpdate = true; batch.mesh.computeBoundingSphere();
    }
  }
  update(0);
  const meshes = group.children as THREE.InstancedMesh[];
  function stats() {
    const geometries = new Set(meshes.map(m => m.geometry));
    const geometryBytes = [...geometries].reduce((sum, g) => sum + Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0), 0)
      + meshes.reduce((sum, m) => sum + m.instanceMatrix.array.byteLength, 0);
    const textureBytes = [...textures.values(), ...arrowTextures.values()].reduce((sum, t) => sum + t.image.width * t.image.height * 4, 0);
    return { drawCalls: meshes.filter(m => m.count > 0).length, triangles: meshes.reduce((sum, m) => sum + m.count * (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3, 0), geometryBytes, textureBytes };
  }
  return { group, update, stats };
}
