// edge-selector.ts — Seleção de Arestas para Fillet/Chamfer (v3: auto-offset bbox)

import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';

export type EdgeMode = 'fillet' | 'chamfer';

export interface EdgeSelectionResult {
  shapeMesh: { shape_id: number; mesh: { vertices: number[]; indices: number[] } };
}

export type OnEdgeApplied = (result: EdgeSelectionResult) => void;
export type OnEdgeCancel  = () => void;

// ─── Cores ────────────────────────────────────────────────────────────────────

const COLOR_NORMAL   = 0x4488cc;
const COLOR_HOVERED  = 0xfbbf24;
const COLOR_SELECTED = 0x6ee7f7;

const MARKER_GEO = new THREE.SphereGeometry(1.5, 10, 10);   // raio 1.5 conforme pedido

function makeMat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthTest: false });
}

// ── Calcula offset entre centro do bbox dos midpoints e centro do bbox do mesh ─
// Este método corrge automaticamente qualquer diferença de sistema de coordenadas
// entre o OCCT (que retorna posições absolutas do solid) e o Three.js mesh.
function computeOcctToThreeOffset(
  midpoints: [number, number, number][],
  meshGeometry: THREE.BufferGeometry,
): THREE.Vector3 {
  // Centro dos midpoints OCCT
  let mx = 0, my = 0, mz = 0;
  for (const [x, y, z] of midpoints) { mx += x; my += y; mz += z; }
  mx /= midpoints.length; my /= midpoints.length; mz /= midpoints.length;

  // Centro do bounding box da geometria Three.js
  meshGeometry.computeBoundingBox();
  const box = meshGeometry.boundingBox;
  if (!box) return new THREE.Vector3(0, 0, 0);

  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;

  // Offset = centro Three.js − centro OCCT
  return new THREE.Vector3(cx - mx, cy - my, cz - mz);
}

// ─── EdgeSelector ─────────────────────────────────────────────────────────────

export class EdgeSelector {
  private scene:   THREE.Scene;
  private camera:  THREE.Camera;
  private canvas:  HTMLCanvasElement;
  private panelEl: HTMLElement;

  private mode: EdgeMode = 'fillet';
  private activeShapeId = -1;
  private markers: THREE.Mesh[] = [];
  private selectedEdges = new Set<number>();
  private hoveredIdx = -1;

  private raycaster = new THREE.Raycaster();
  private mouse     = new THREE.Vector2();
  private _onApplied: OnEdgeApplied;
  private _onCancel:  OnEdgeCancel;
  private active = false;

  private _boundMouseMove: (e: MouseEvent) => void;
  private _boundClick:     (e: MouseEvent) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    panelId: string,
    onApplied: OnEdgeApplied,
    onCancel:  OnEdgeCancel,
  ) {
    this.scene      = scene;
    this.camera     = camera;
    this.canvas     = canvas;
    this.panelEl    = document.getElementById(panelId) as HTMLElement;
    this._onApplied = onApplied;
    this._onCancel  = onCancel;

    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundClick     = this._onClick.bind(this);
  }

  // ── Entrar no modo ─────────────────────────────────────────────────────────

  async enter(shapeId: number, mode: EdgeMode, meshObject?: THREE.Object3D): Promise<void> {
    this.mode = mode;
    this.activeShapeId = shapeId;
    this.selectedEdges.clear();
    this.hoveredIdx = -1;

    let midpoints: [number, number, number][];
    try {
      midpoints = await invoke<[number, number, number][]>('get_edge_midpoints', { shapeId });
    } catch (err) {
      console.error('[EdgeSelector] get_edge_midpoints falhou:', err);
      return;
    }

    if (!midpoints || midpoints.length === 0) {
      console.warn('[EdgeSelector] Sem arestas para shape', shapeId);
      return;
    }

    // ── Calcula offset correto: OCCT retorna midpoints em world-space.
    // Após applyWorldSpaceGeo, o mesh tem:
    //   - geometry em coordenadas locais (vértices centrados em 0)
    //   - mesh.position = centro do bbox world = onde o shape está visualmente
    // O OCCT midpoint está em world-space, portanto JÁ é o que queremos.
    // Os marcadores vão direto para a cena (world-space) — offset = 0.
    const offset = new THREE.Vector3(0, 0, 0);
    // Nota: se o mesh.position fosse ≠ center (e.g., movido por TC antes do fillet),
    // o OCCT já absoveu isso via transform_shape. OK.

    // ── Cria marcadores ───────────────────────────────────────────────────────
    this._clearMarkers();
    for (const [x, y, z] of midpoints) {
      const m = new THREE.Mesh(MARKER_GEO, makeMat(COLOR_NORMAL));
      m.position.set(x + offset.x, y + offset.y, z + offset.z);
      m.renderOrder = 999;
      this.scene.add(m);
      this.markers.push(m);
    }

    this.canvas.addEventListener('mousemove', this._boundMouseMove, true);
    this.canvas.addEventListener('click',     this._boundClick,     true);
    this.active = true;

    this._renderPanel();
    this.panelEl.classList.add('open');
  }

  // ── Sair do modo ──────────────────────────────────────────────────────────

  exit(): void {
    this._clearMarkers();
    this.canvas.removeEventListener('mousemove', this._boundMouseMove, true);
    this.canvas.removeEventListener('click',     this._boundClick,     true);
    this.panelEl.classList.remove('open');
    this.active = false;
    this.hoveredIdx = -1;
    this.selectedEdges.clear();
    this.canvas.style.cursor = '';
  }

  // ── Aplicar ───────────────────────────────────────────────────────────────

  private async _apply(): Promise<void> {
    const statusEl = document.getElementById('es-status');
    const applyBtn = document.getElementById('es-apply') as HTMLButtonElement | null;

    if (this.selectedEdges.size === 0) {
      if (statusEl) statusEl.textContent = '⚠ Selecione pelo menos 1 aresta';
      return;
    }
    const val = parseFloat((document.getElementById('es-value-input') as HTMLInputElement).value);
    if (isNaN(val) || val <= 0) {
      if (statusEl) statusEl.textContent = '⚠ Valor inválido';
      return;
    }

    if (statusEl) statusEl.textContent = '⏳ Calculando…';
    if (applyBtn) applyBtn.disabled = true;

    const indices = Array.from(this.selectedEdges);
    const cmd = this.mode === 'fillet' ? 'fillet_edges' : 'chamfer_edges';
    const payload = this.mode === 'fillet'
      ? { shapeId: this.activeShapeId, edgeIndices: indices, radius: val }
      : { shapeId: this.activeShapeId, edgeIndices: indices, dist: val };

    try {
      const result = await invoke<{ shape_id: number; mesh: { vertices: number[]; indices: number[] } }>(cmd, payload);
      if (statusEl) statusEl.textContent = '✅ Aplicado!';
      this._onApplied({ shapeMesh: result });
      setTimeout(() => this.exit(), 700);
    } catch (err) {
      if (statusEl) statusEl.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`;
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  // ── Raycasting ────────────────────────────────────────────────────────────

  private _updateMouse(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX - r.left) / r.width)  * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }

  private _hitIdx(): number {
    if (!this.markers.length) return -1;
    const hits = this.raycaster.intersectObjects(this.markers, false);
    return hits.length > 0 ? this.markers.indexOf(hits[0].object as THREE.Mesh) : -1;
  }

  private _setColor(idx: number, hex: number): void {
    if (idx >= 0 && idx < this.markers.length)
      (this.markers[idx].material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this.active) return;
    this._updateMouse(e);
    const n = this._hitIdx();

    if (n !== this.hoveredIdx) {
      if (this.hoveredIdx >= 0)
        this._setColor(this.hoveredIdx, this.selectedEdges.has(this.hoveredIdx) ? COLOR_SELECTED : COLOR_NORMAL);
      this.hoveredIdx = n;
      if (n >= 0)
        this._setColor(n, this.selectedEdges.has(n) ? COLOR_SELECTED : COLOR_HOVERED);
    }
    this.canvas.style.cursor = n >= 0 ? 'crosshair' : '';
  }

  private _onClick(e: MouseEvent): void {
    if (!this.active) return;
    this._updateMouse(e);
    const n = this._hitIdx();
    if (n < 0) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    if (this.selectedEdges.has(n)) {
      this.selectedEdges.delete(n);
      this._setColor(n, COLOR_NORMAL);
    } else {
      this.selectedEdges.add(n);
      this._setColor(n, COLOR_SELECTED);
    }
    const el = document.getElementById('es-count');
    if (el) el.textContent = `${this.selectedEdges.size} aresta(s) selecionada(s)`;
  }

  // ── Painel ────────────────────────────────────────────────────────────────

  private _renderPanel(): void {
    const isFillet = this.mode === 'fillet';
    const accent   = isFillet ? '#6ee7f7' : '#a78bfa';
    const valLabel = isFillet ? 'Raio (mm)' : 'Distância (mm)';
    const title    = isFillet ? 'Fillet por Aresta' : 'Chamfer por Aresta';

    this.panelEl.innerHTML = `
      <div class="pe-header">
        <span class="pe-title" style="color:${accent}">✂ ${title}</span>
        <button class="pe-close" id="es-close">✕</button>
      </div>
      <div class="es-hint">Hover = amarelo &nbsp;·&nbsp; Clique = selecionar (ciano)</div>
      <div id="es-count" class="es-count">0 aresta(s) selecionada(s)</div>
      <div class="pe-fields">
        <label class="pe-field">
          <span>${valLabel}</span>
          <input type="number" id="es-value-input" value="3" min="0.01" step="0.5"/>
        </label>
      </div>
      <div class="pe-footer">
        <button class="pe-apply" id="es-apply" style="background:${accent};color:#0f1012">✔ Aplicar</button>
        <button class="pe-cancel" id="es-cancel">Cancelar</button>
      </div>
      <div class="pe-status" id="es-status"></div>`;

    document.getElementById('es-close')!.onclick  = () => { this.exit(); this._onCancel(); };
    document.getElementById('es-cancel')!.onclick = () => { this.exit(); this._onCancel(); };
    document.getElementById('es-apply')!.onclick  = () => this._apply();
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private _clearMarkers(): void {
    for (const m of this.markers) {
      this.scene.remove(m);
      (m.material as THREE.MeshBasicMaterial).dispose();
    }
    this.markers = [];
  }

  isActive(): boolean { return this.active; }
}
