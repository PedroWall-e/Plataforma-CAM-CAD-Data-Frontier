// workplane.ts — Fase 4: Gerenciador de Plano de Trabalho (Workplane)
//
// Responsabilidades:
//   - Guarda o plano ativo (origin, normal, u_axis, v_axis)
//   - Conversão 2D (canvas u,v) ↔ 3D world-space
//   - Renderiza grid visual 3D sobre a face selecionada (Three.js LineSegments)

import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PlaneInfo {
  origin: [number, number, number];
  normal: [number, number, number];
  u_axis: [number, number, number];
  v_axis: [number, number, number];
}

// ─── WorkplaneManager ─────────────────────────────────────────────────────────

export class WorkplaneManager {
  private scene: THREE.Scene;
  private plane: PlaneInfo | null = null;
  private gridLines: THREE.LineSegments | null = null;

  // Matrix que converte coordenadas 2D do plano → 3D world (col-major, Three.js)
  private planeMatrix: THREE.Matrix4 = new THREE.Matrix4();

  // shape_id e face_index ativos (para referência)
  activeShapeId = -1;
  activeFaceIndex = -1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Ativa o plano de trabalho sobre uma face do shape.
   *  Retorna as informações do plano ou null em erro. */
  async activate(shapeId: number, faceIndex: number): Promise<PlaneInfo | null> {
    try {
      const info = await invoke<PlaneInfo>('get_face_plane', { shapeId, faceIndex });
      this.plane = info;
      this.activeShapeId  = shapeId;
      this.activeFaceIndex = faceIndex;
      this._buildMatrix(info);
      this._buildGrid();
      return info;
    } catch (err) {
      console.error('[Workplane] get_face_plane falhou:', err);
      return null;
    }
  }

  /** Desativa o plano de trabalho e remove o grid visual. */
  deactivate(): void {
    this._removeGrid();
    this.plane = null;
    this.activeShapeId = -1;
    this.activeFaceIndex = -1;
  }

  /** Retorna true se há um plano ativo. */
  isActive(): boolean { return this.plane !== null; }

  /** Retorna os elementos da Matrix4 col-major para enviar ao Rust (16 floats). */
  getMatrixElements(): number[] {
    return Array.from(this.planeMatrix.elements);
  }

  /** Converte coordenadas 2D (u, v) do plano → ponto 3D world-space. */
  uvTo3D(u: number, v: number): THREE.Vector3 {
    return new THREE.Vector3(u, v, 0).applyMatrix4(this.planeMatrix);
  }

  /** Converte ponto 3D world-space → coordenadas 2D (u, v) no plano.
   *  Assume projjeção ortogonal sobre o plano. */
  worldToUV(worldPt: THREE.Vector3): [number, number] {
    if (!this.plane) return [0, 0];
    const o = new THREE.Vector3(...this.plane.origin);
    const u = new THREE.Vector3(...this.plane.u_axis);
    const v = new THREE.Vector3(...this.plane.v_axis);
    const d = worldPt.clone().sub(o);
    return [d.dot(u), d.dot(v)];
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  private _buildMatrix(info: PlaneInfo): void {
    const [ox, oy, oz] = info.origin;
    const [ux, uy, uz] = info.u_axis;
    const [vx, vy, vz] = info.v_axis;
    const [nx, ny, nz] = info.normal;

    // Three.js Matrix4 col-major:
    // col0 = u_axis, col1 = v_axis, col2 = normal, col3 = origin
    this.planeMatrix.set(
      ux, vx, nx, ox,
      uy, vy, ny, oy,
      uz, vz, nz, oz,
       0,  0,  0,  1,
    );
  }

  private _buildGrid(): void {
    this._removeGrid();

    const GRID_SIZE  = 200; // mm — tamanho total do grid
    const GRID_STEP  = 10;  // mm — espaçamento entre linhas
    const HALF = GRID_SIZE / 2;

    const points: THREE.Vector3[] = [];

    // Linhas paralelas a u_axis
    for (let v = -HALF; v <= HALF; v += GRID_STEP) {
      points.push(this.uvTo3D(-HALF, v));
      points.push(this.uvTo3D( HALF, v));
    }
    // Linhas paralelas a v_axis
    for (let u = -HALF; u <= HALF; u += GRID_STEP) {
      points.push(this.uvTo3D(u, -HALF));
      points.push(this.uvTo3D(u,  HALF));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0x6ee7f7,
      transparent: true,
      opacity: 0.22,
      depthTest: false,
    });
    this.gridLines = new THREE.LineSegments(geo, mat);
    this.gridLines.renderOrder = 10;
    this.scene.add(this.gridLines);
  }

  private _removeGrid(): void {
    if (this.gridLines) {
      this.scene.remove(this.gridLines);
      this.gridLines.geometry.dispose();
      (this.gridLines.material as THREE.Material).dispose();
      this.gridLines = null;
    }
  }
}
