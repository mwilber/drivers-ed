import * as THREE from 'three';
import { centerMarkings, CROSSINGS, STREETS, JUNCTION_RADIUS, junction, type Marking } from './road-network.ts';
import { APPROACHES, ROAD_SIGNS, ROAD_POSTS, SIGNAL_FIXTURES, LANE_ARROWS, type RoadSign } from './traffic-layout.ts';
import { signalState } from './traffic-rules.ts';
import { ROAD_HEIGHT } from './world-layout.ts';

export function createRoadVisuals(scene: THREE.Scene) {
  const paints = new Map<number, THREE.MeshStandardMaterial>();
  function paint(line: Marking) {
    if (!paints.has(line.color)) paints.set(line.color, new THREE.MeshStandardMaterial({ color: line.color, roughness: 1 }));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(line.width, 0.006, line.depth), paints.get(line.color));
    mesh.position.set(line.x, ROAD_HEIGHT + 0.005, line.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const marking of centerMarkings()) paint(marking);
  for (const crossing of CROSSINGS) {
    const horizontalRoad = !!crossing.direction.x;
    const length = (horizontalRoad ? crossing.depth : crossing.width) - 4;
    for (let offset = -length / 2 + 0.5; offset < length / 2; offset += 1) paint({
      x: crossing.x + (horizontalRoad ? 0 : offset), z: crossing.z + (horizontalRoad ? offset : 0),
      width: horizontalRoad ? 2 : 0.5, depth: horizontalRoad ? 0.5 : 2, color: 0xf3f1df,
    });
  }
  // Edge paint follows the same gaps as the lane endpoints; junction centers stay clear.
  for (const s of STREETS.filter(s => s.id !== 'lot-access')) {
    const a = junction(s.from), b = junction(s.to), length = Math.hypot(b.x - a.x, b.z - a.z);
    const u = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    for (const side of [-1, 1]) {
      const middle = { x: (a.x + b.x) / 2 - u.z * side * (s.width / 2 - 0.15), z: (a.z + b.z) / 2 + u.x * side * (s.width / 2 - 0.15) };
      paint({ ...middle, width: u.x ? length - JUNCTION_RADIUS * 2 : 0.1, depth: u.z ? length - JUNCTION_RADIUS * 2 : 0.1, color: 0xf3f1df });
    }
  }
  for (const approach of APPROACHES) {
    if (!approach.line) continue;
    if (approach.kind !== 'yield') paint(approach.line);
    else {
      // Inverted triangles distinguish a yield line from a stop bar.
      const u = approach.direction, right = { x: -u.z, z: u.x };
      for (const offset of [-1.7, -0.85, 0, 0.85, 1.7]) {
        const geometry = new THREE.BufferGeometry();
        const x = approach.x + right.x * offset, z = approach.z + right.z * offset;
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          x + u.x * 0.4, ROAD_HEIGHT + 0.012, z + u.z * 0.4,
          x - u.x * 0.3 + right.x * 0.3, ROAD_HEIGHT + 0.012, z - u.z * 0.3 + right.z * 0.3,
          x - u.x * 0.3 - right.x * 0.3, ROAD_HEIGHT + 0.012, z - u.z * 0.3 - right.z * 0.3,
        ], 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xf3f1df, roughness: 1, side: THREE.DoubleSide }));
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }
  }
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x7b8181, roughness: 0.7 });
  function poleBox(width: number, height: number, depth: number, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), poleMaterial);
    mesh.position.set(x, y, z); mesh.castShadow = true; scene.add(mesh);
    return mesh;
  }
  for (const post of ROAD_POSTS) poleBox(post.width, post.height, post.depth, post.x, post.height / 2, post.z);
  const textures = new Map<string, THREE.CanvasTexture>();
  function signTexture(sign: RoadSign) {
    const key = `${sign.kind}-${sign.mph ?? ''}`;
    if (textures.has(key)) return textures.get(key)!;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
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
  function signBoard(texture: THREE.CanvasTexture, width: number, height: number, sign: RoadSign, y: number) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.1, roughness: 0.9, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.15 }));
    face.position.set(sign.x - sign.direction.x * 0.08, y, sign.z - sign.direction.z * 0.08);
    face.rotation.y = Math.atan2(-sign.direction.x, -sign.direction.z);
    scene.add(face);
  }
  for (const sign of ROAD_SIGNS) {
    const shared = sign.kind === 'speed' && ROAD_SIGNS.some(other => other.kind !== 'speed' && other.x === sign.x && other.z === sign.z);
    const width = sign.kind === 'speed' ? 0.9 : 1.1;
    const height = sign.kind === 'speed' ? 1.2 : 1.1;
    signBoard(signTexture(sign), width, height, sign, shared ? 1.25 : 2.65);
    if (sign.allWay) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const c = canvas.getContext('2d')!; c.fillStyle = '#fff8ee'; c.fillRect(0, 0, 512, 128);
      c.fillStyle = '#202726'; c.font = 'bold 80px sans-serif'; c.textAlign = 'center'; c.fillText('ALL WAY', 256, 96);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      signBoard(texture, 0.8, 0.2, sign, 1.97);
    }
  }
  const arrowTextures = new Map<string, THREE.CanvasTexture>();
  for (const arrow of LANE_ARROWS) {
    const key = arrow.turns.slice().sort().join(',');
    if (!arrowTextures.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
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
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.8), new THREE.MeshStandardMaterial({ map: arrowTextures.get(key), transparent: true, depthWrite: false, roughness: 1 }));
    mesh.receiveShadow = true;
    mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(-arrow.direction.x, -arrow.direction.z));
    mesh.position.set(arrow.x, ROAD_HEIGHT + 0.012, arrow.z); scene.add(mesh);
  }
  const lamps: { group: 'ns' | 'ew'; lenses: THREE.MeshStandardMaterial[] }[] = [];
  for (const signal of SIGNAL_FIXTURES) {
    const mast = new THREE.Group(); mast.position.set(signal.x, 5.2, signal.z);
    mast.rotation.y = Math.atan2(-signal.direction.x, -signal.direction.z);
    scene.add(mast);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.55, 0.3), new THREE.MeshStandardMaterial({ color: 0x252c2c }));
    mast.add(housing);
    const lenses = [0xe43b2e, 0xf8bb33, 0x2ac657].map((color, i) => {
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), material);
      lens.position.set(0, 0.49 - i * 0.49, 0.16); mast.add(lens); return material;
    });
    const start = new THREE.Vector3(signal.pole.x, 5.7, signal.pole.z);
    const end = new THREE.Vector3(signal.x, 5.7, signal.z);
    const boom = poleBox(start.distanceTo(end), 0.12, 0.12, (start.x + end.x) / 2, 5.7, (start.z + end.z) / 2);
    boom.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
    const group = APPROACHES.find(a => a.id === signal.approachId)!.signalGroup;
    lamps.push({ group, lenses });
  }
  return {
    update(seconds: number) {
      const state = signalState(seconds);
      for (const lamp of lamps) for (const [i, color] of ['red', 'yellow', 'green'].entries()) {
        const active = state[lamp.group] === color;
        lamp.lenses[i]!.emissiveIntensity = active ? 3 : 0;
        lamp.lenses[i]!.color.setHex(active ? [0xe43b2e, 0xf8bb33, 0x2ac657][i]! : 0x333a37);
      }
    },
  };
}
