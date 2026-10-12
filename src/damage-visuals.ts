import * as THREE from 'three';
import { DAMAGE_PANELS, type DamagePanel, type VehicleDamage } from './vehicle-damage.ts';
import { CAR } from './vehicle-config.ts';

/** Each panel owns its material and original geometry; repairs never accumulate transforms. */
export function createDamageVisuals(paint = 0xc8cec8) {
  const group = new THREE.Group();
  const panels = new Map<DamagePanel, { meshes: { mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>; original: Float32Array }[]; marks: THREE.Group }>();
  for (const panel of DAMAGE_PANELS) panels.set(panel, { meshes: [], marks: new THREE.Group() });
  function panelBox(panel: DamagePanel, width: number, height: number, depth: number, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth, 4, 2, 4), new THREE.MeshStandardMaterial({ color: paint, roughness: 0.92 }));
    mesh.position.set(x, y, z);
    // Lift the lower outer vertices around each tire. The same panel buffers and
    // outer footprint remain; the small visual arches do not change colliders.
    if (height === 0.42 && (panel === 'front' || panel === 'rear')) {
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
        const dz = pz + z - (panel === 'front' ? -CAR.wheelbase / 2 : CAR.wheelbase / 2);
        if (Math.abs(px) > 0.7 && Math.abs(dz) < 0.36) {
          positions.setY(i, Math.max(py, CAR.tireRadius + Math.sqrt(0.36 ** 2 - dz ** 2) - y));
        }
      }
      mesh.geometry.computeVertexNormals();
    }
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    panels.get(panel)!.meshes.push({ mesh, original: new Float32Array(mesh.geometry.attributes.position!.array) });
  }
  // Independent body panels retain the original dimensions and collider footprint.
  panelBox('front', 1.8, 0.42, 1.3, 0, 0.51, -1.6);
  panelBox('rear', 1.8, 0.42, 1.3, 0, 0.51, 1.6);
  panelBox('left', 0.9, 0.42, 1.9, -0.45, 0.51, 0);
  panelBox('right', 0.9, 0.42, 1.9, 0.45, 0.51, 0);
  panelBox('front', 1.72, 0.17, 1.3, 0, 0.81, -1.54);
  panelBox('rear', 1.72, 0.15, 0.7, 0, 0.79, 1.8);
  panelBox('roof', 1.73, 0.1, 1.95, 0, 1.62, 0.35);
  const markMaterial = new THREE.MeshBasicMaterial({ color: 0x574c3f, side: THREE.DoubleSide });
  const scratchGeometry = new THREE.PlaneGeometry(1, 0.008);
  for (const panel of DAMAGE_PANELS) {
    const marks = panels.get(panel)!.marks;
    if (panel === 'front') marks.position.set(0, 0.9, -1.54);
    if (panel === 'rear') marks.position.set(0, 0.87, 1.8);
    if (panel === 'roof') marks.position.set(0, 1.675, 0.35);
    if (panel === 'front' || panel === 'rear' || panel === 'roof') marks.rotation.x = -Math.PI / 2;
    if (panel === 'left' || panel === 'right') {
      marks.position.set(panel === 'left' ? -0.905 : 0.905, 0.55, 0);
      marks.rotation.y = Math.PI / 2;
    }
    const scratches = new THREE.InstancedMesh(scratchGeometry, markMaterial, 7);
    const pose = new THREE.Object3D();
    for (let i = 0; i < 7; i++) {
      pose.position.set((i % 3 - 1) * 0.24, (Math.floor(i / 3) - 1) * 0.055, 0.001);
      pose.rotation.z = 0.12 + (i % 2) * 0.15;
      pose.scale.x = 0.24 + i * 0.025; pose.updateMatrix(); scratches.setMatrixAt(i, pose.matrix);
    }
    scratches.computeBoundingSphere(); marks.add(scratches);
    group.add(marks);
  }
  let revision = -1;
  let lastDamage: VehicleDamage | undefined;
  return {
    group,
    snapshotBytes: [...panels.values()].reduce((sum, panel) => sum + panel.meshes.reduce((bytes, entry) => bytes + entry.original.byteLength, 0), 0),
    update(damage: VehicleDamage) {
      if (lastDamage === damage && revision === damage.revision) return;
      lastDamage = damage;
      revision = damage.revision;
      for (const panel of DAMAGE_PANELS) {
        const { dent, scratch } = damage.panels[panel];
        const visual = panels.get(panel)!;
        for (const { mesh, original } of visual.meshes) {
          const positions = mesh.geometry.attributes.position!;
          for (let i = 0; i < positions.count; i++) {
            const x = original[i * 3]!, y = original[i * 3 + 1]!, z = original[i * 3 + 2]!;
            const patch = Math.max(0, 1 - Math.abs(x) / 0.8) * Math.max(0, 1 - Math.abs(z) / 0.9);
            positions.setXYZ(i, x, y - dent * 0.12 * patch * (y > 0 ? 1 : 0.2), z);
          }
          positions.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
          mesh.material.color.set(paint).lerp(new THREE.Color(0x7c8177), dent * 0.55);
        }
        visual.marks.visible = scratch > 0;
        (visual.marks.children[0] as THREE.InstancedMesh).count = Math.ceil(scratch * 7);
      }
    },
  };
}
