// src/snap.ts — Snapping magnético via three-mesh-bvh (SEM monkey-patch global)

import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface SnapResult {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

// ── Objectos reutilizáveis (evita GC durante drag) ────────────────────────────
const _raycaster   = new THREE.Raycaster();
const _bbox        = new THREE.Box3();
const _bboxSize    = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _localDown   = new THREE.Vector3(0, -1, 0);

// ── BVH helpers ───────────────────────────────────────────────────────────────

/** Constrói o BVH na geometria do mesh. Chama após buildMesh/updateGeometry. */
export function initBVH(mesh: THREE.Mesh): void {
  const geo = mesh.geometry as any;
  if (geo.boundsTree) return; // já tem BVH
  // Adiciona computeBoundsTree apenas a esta instância, sem patch global
  geo.computeBoundsTree = computeBoundsTree;
  geo.computeBoundsTree();
  // Activa o acceleratedRaycast apenas neste mesh (sem modificar o prototype)
  (mesh as any)._savedRaycast = mesh.raycast;
  mesh.raycast = acceleratedRaycast;
}

/** Limpa o BVH ao destruir o mesh. */
export function disposeBVH(mesh: THREE.Mesh): void {
  const geo = mesh.geometry as any;
  if (geo.boundsTree) {
    geo.disposeBoundsTree = disposeBoundsTree;
    geo.disposeBoundsTree();
  }
  // Restaura o raycast original
  if ((mesh as any)._savedRaycast) {
    mesh.raycast = (mesh as any)._savedRaycast;
  }
}

/** Verifica se um mesh tem BVH construído. */
function hasBVH(mesh: THREE.Mesh): boolean {
  return !!(mesh.geometry as any).boundsTree;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Devolve position + quaternion para colar o mesh arrastado na face detetada.
 * Só faz raycast em meshes que tenham BVH (os nossos shapes CAD).
 * Retorna null se nenhuma superfície-alvo estiver sob o cursor.
 */
export function computeSnap(
  mouse: THREE.Vector2,
  camera: THREE.Camera,
  dragged: THREE.Mesh,
  targets: THREE.Mesh[],
): SnapResult | null {
  const bvhTargets = targets.filter(hasBVH);
  if (bvhTargets.length === 0) return null;

  _raycaster.setFromCamera(mouse, camera);
  const hits = _raycaster.intersectObjects(bvhTargets, false);
  if (hits.length === 0 || !hits[0].face) return null;

  const hit = hits[0];

  _worldNormal
    .copy(hit.face!.normal)
    .transformDirection((hit.object as THREE.Mesh).matrixWorld)
    .normalize();

  _bbox.setFromObject(dragged);
  _bbox.getSize(_bboxSize);
  const halfExtent = _bboxSize.length() * 0.5;

  const position = hit.point.clone().addScaledVector(_worldNormal, halfExtent);

  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    _localDown,
    _worldNormal,
  );

  return { position, quaternion };
}
