// sketch-canvas.ts — Fase 4: Overlay SVG para Sketching 2D
//
// Ferramentas: Retângulo, Círculo (como polígono aproximado), Linha
// Converte contornos 2D do canvas → 3D world-space via WorkplaneManager
// Envia perfis para o backend (extrude / revolve) via invoke()

import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { WorkplaneManager } from './workplane.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SketchTool = 'rect' | 'circle' | 'line' | 'none';

export interface SketchContour {
  type:   'polyline' | 'circle';
  points: [number, number][];  // u,v no espaço do plano
  closed: boolean;
}

export type OnExtrudeCallback = (shapeMesh: { shape_id: number; mesh: { vertices: number[]; indices: number[] } }) => void;

// ─── SketchCanvas ─────────────────────────────────────────────────────────────

export class SketchCanvas {
  private svg:      SVGSVGElement;
  private panelEl:  HTMLElement;
  private wp:       WorkplaneManager;
  private camera:   THREE.Camera;
  private renderer: THREE.WebGLRenderer;

  private tool:      SketchTool = 'none';
  private contours:  SketchContour[] = [];
  private previewEl: SVGElement | null = null;

  // Estado de drag
  private dragging = false;
  private startUV:  [number, number] = [0, 0];

  private _onExtrude: OnExtrudeCallback;

  constructor(
    svgContainerId: string,
    panelId: string,
    workplane: WorkplaneManager,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    onExtrude: OnExtrudeCallback,
  ) {
    this.wp       = workplane;
    this.camera   = camera;
    this.renderer = renderer;
    this._onExtrude = onExtrude;

    this.panelEl = document.getElementById(panelId) as HTMLElement;

    // Cria SVG overlay
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.id = svgContainerId;
    this.svg.style.cssText = `
      position:fixed; inset:0; pointer-events:none;
      z-index:30; overflow:visible;
    `;
    document.body.appendChild(this.svg);

    this._buildPanel();
  }

  // ── API pública ────────────────────────────────────────────────────────────

  setTool(tool: SketchTool): void {
    this.tool = tool;
    this.svg.style.pointerEvents = tool !== 'none' ? 'all' : 'none';
    this.svg.style.cursor = tool !== 'none' ? 'crosshair' : '';

    // Atualiza botões do painel
    this.panelEl.querySelectorAll<HTMLButtonElement>('.sk-tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset['tool'] === tool);
    });
  }

  clearContours(): void {
    this.contours = [];
    this._redrawSVG();
  }

  dispose(): void {
    this.svg.remove();
    this._removeListeners();
  }

  show(): void {
    this.svg.style.display = 'block';
    this.panelEl.classList.add('open');
    this._addListeners();
  }

  hide(): void {
    this.svg.style.display = 'none';
    this.svg.style.pointerEvents = 'none';
    this.panelEl.classList.remove('open');
    this._removeListeners();
    this.setTool('none');
  }

  // ── Canvas / SVG ──────────────────────────────────────────────────────────

  /** Converte ponto do mouse (clientX, clientY) → coordenadas UV no plano */
  private _mouseToUV(e: MouseEvent): [number, number] {
    // Converte canvas pixel → NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    // Lança raio da câmera e intersecta o plano de trabalho
    if (!this.wp.isActive()) return [0, 0];
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Plano Three.js: normal + ponto
    const wp = this.wp;
    const planeInfo = (wp as any).plane as { origin: [number,number,number]; normal: [number,number,number] } | null;
    if (!planeInfo) return [0, 0];

    const planeTHREE = new THREE.Plane(
      new THREE.Vector3(...planeInfo.normal),
      -new THREE.Vector3(...planeInfo.normal).dot(new THREE.Vector3(...planeInfo.origin))
    );
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(planeTHREE, hit)) return [0, 0];
    return wp.worldToUV(hit);
  }

  /** Converte UV → coordenadas pixel do SVG */
  private _uvToSVGPx(u: number, v: number): [number, number] {
    const world = this.wp.uvTo3D(u, v);
    const ndc = world.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [
      (ndc.x * 0.5 + 0.5) * rect.width  + rect.left,
      (ndc.y * -0.5 + 0.5) * rect.height + rect.top,
    ];
  }

  // ── Listeners ─────────────────────────────────────────────────────────────

  private _boundPointerDown = (e: PointerEvent) => this._onPointerDown(e);
  private _boundPointerMove = (e: PointerEvent) => this._onPointerMove(e);
  private _boundPointerUp   = (e: PointerEvent) => this._onPointerUp(e);

  private _addListeners(): void {
    this.svg.addEventListener('pointerdown', this._boundPointerDown);
    this.svg.addEventListener('pointermove', this._boundPointerMove);
    this.svg.addEventListener('pointerup',   this._boundPointerUp);
  }

  private _removeListeners(): void {
    this.svg.removeEventListener('pointerdown', this._boundPointerDown);
    this.svg.removeEventListener('pointermove', this._boundPointerMove);
    this.svg.removeEventListener('pointerup',   this._boundPointerUp);
  }

  private _onPointerDown(e: PointerEvent): void {
    if (this.tool === 'none') return;
    e.stopPropagation();
    this.dragging = true;
    this.startUV = this._mouseToUV(e);
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this.dragging || this.tool === 'none') return;
    const [u, v] = this._mouseToUV(e);
    this._updatePreview(this.startUV, [u, v]);
  }

  private _onPointerUp(e: PointerEvent): void {
    if (!this.dragging || this.tool === 'none') return;
    this.dragging = false;
    const endUV = this._mouseToUV(e);
    this._commitContour(this.startUV, endUV);
    this._clearPreview();
    this._redrawSVG();
  }

  // ── Geração de contornos ──────────────────────────────────────────────────

  private _commitContour(start: [number, number], end: [number, number]): void {
    const [u0, v0] = start;
    const [u1, v1] = end;
    if (Math.abs(u1 - u0) < 0.5 && Math.abs(v1 - v0) < 0.5) return; // ignora clique sem drag

    if (this.tool === 'rect') {
      this.contours.push({
        type: 'polyline', closed: true,
        points: [[u0,v0],[u1,v0],[u1,v1],[u0,v1]],
      });
    } else if (this.tool === 'circle') {
      const cx = (u0 + u1) / 2, cy = (v0 + v1) / 2;
      const rx = Math.abs(u1 - u0) / 2, ry = Math.abs(v1 - v0) / 2;
      const r = (rx + ry) / 2;
      const N = 36;
      const pts: [number, number][] = [];
      for (let i = 0; i < N; ++i) {
        const a = (i / N) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      this.contours.push({ type: 'circle', closed: true, points: pts });
    } else if (this.tool === 'line') {
      this.contours.push({ type: 'polyline', closed: false, points: [start, end] });
    }
  }

  // ── SVG Render ────────────────────────────────────────────────────────────

  private _redrawSVG(): void {
    // Remove elementos não-preview
    Array.from(this.svg.children).forEach(el => {
      if (el !== this.previewEl) this.svg.removeChild(el);
    });

    for (const c of this.contours) {
      const screenPts = c.points.map(([u, v]) => this._uvToSVGPx(u, v));
      const d = screenPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + (c.closed ? ' Z' : '');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'rgba(110,231,247,0.08)');
      path.setAttribute('stroke', '#6ee7f7');
      path.setAttribute('stroke-width', '1.5');
      this.svg.insertBefore(path, this.previewEl);
    }
  }

  private _updatePreview(start: [number, number], end: [number, number]): void {
    this._clearPreview();
    const [u0, v0] = start, [u1, v1] = end;
    let d = '';

    if (this.tool === 'rect') {
      const pts = [[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v]) => this._uvToSVGPx(u, v));
      d = pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
    } else if (this.tool === 'circle') {
      const cx = (u0+u1)/2, cy = (v0+v1)/2, r = (Math.abs(u1-u0)+Math.abs(v1-v0))/4;
      const N = 24;
      const pts = Array.from({length:N}, (_,i) => {
        const a = (i/N)*Math.PI*2;
        return this._uvToSVGPx(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
      });
      d = pts.map((p,i)=>`${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
    } else if (this.tool === 'line') {
      const p0 = this._uvToSVGPx(u0,v0), p1 = this._uvToSVGPx(u1,v1);
      d = `M${p0[0]},${p0[1]} L${p1[0]},${p1[1]}`;
    }

    if (!d) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'rgba(110,231,247,0.04)');
    path.setAttribute('stroke', '#6ee7f7');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-dasharray', '4 2');
    this.svg.appendChild(path);
    this.previewEl = path;
  }

  private _clearPreview(): void {
    if (this.previewEl) { this.svg.removeChild(this.previewEl); this.previewEl = null; }
  }

  // ── Extrude / Revolve ─────────────────────────────────────────────────────

  /** Flatten dos contornos em float[] para o backend */
  private _flattenContours(): number[] {
    const pts: number[] = [];
    for (const c of this.contours)
      for (const [u, v] of c.points) { pts.push(u); pts.push(v); }
    return pts;
  }

  async applyExtrude(depth: number, fuseWith?: number): Promise<void> {
    if (this.contours.length === 0) { console.warn('[Sketch] Sem contornos'); return; }
    const xy = this._flattenContours();
    const mat = this.wp.getMatrixElements();
    try {
      const result = await invoke<{ shape_id: number; mesh: { vertices: number[]; indices: number[] } }>(
        'extrude_profile', { xyPoints: xy, planeMatrix: mat, depth, fuseWith: fuseWith ?? null }
      );
      this._onExtrude(result);
      this.clearContours();
    } catch (err) { console.error('[Sketch] extrude_profile:', err); }
  }

  async applyRevolve(angleDeg: number, axis: [number,number,number], fuseWith?: number): Promise<void> {
    if (this.contours.length === 0) { console.warn('[Sketch] Sem contornos'); return; }
    const xy = this._flattenContours();
    const mat = this.wp.getMatrixElements();
    try {
      const result = await invoke<{ shape_id: number; mesh: { vertices: number[]; indices: number[] } }>(
        'revolve_profile', { xyPoints: xy, planeMatrix: mat, axis, angleDeg: angleDeg, fuseWith: fuseWith ?? null }
      );
      this._onExtrude(result);
      this.clearContours();
    } catch (err) { console.error('[Sketch] revolve_profile:', err); }
  }

  // ── Painel ────────────────────────────────────────────────────────────────

  private _buildPanel(): void {
    this.panelEl.innerHTML = `
      <div class="sk-header">
        <span class="sk-title">✏ Sketch 2D</span>
        <button class="sk-close" id="sk-close">✕</button>
      </div>
      <div class="sk-tools">
        <button class="sk-tool-btn" data-tool="rect"   title="Retângulo">▭ Rect</button>
        <button class="sk-tool-btn" data-tool="circle" title="Círculo">◯ Circ</button>
        <button class="sk-tool-btn" data-tool="line"   title="Linha">/ Linha</button>
      </div>
      <div class="sk-sep"></div>
      <div class="sk-ops">
        <label class="sk-label">Profundidade (mm)</label>
        <input id="sk-depth" type="number" value="20" min="0.1" step="1" class="sk-input"/>
        <button id="sk-extrude" class="sk-apply">⬆ Extrude</button>
      </div>
      <div class="sk-ops" style="margin-top:6px">
        <label class="sk-label">Ângulo (°)</label>
        <input id="sk-angle" type="number" value="360" min="1" max="360" step="5" class="sk-input"/>
        <button id="sk-revolve" class="sk-apply" style="background:rgba(167,139,250,.8)">↻ Revolve</button>
      </div>
      <div class="sk-ops" style="margin-top:4px">
        <button id="sk-clear" class="sk-cancel" style="flex:1">🗑 Limpar</button>
        <button id="sk-close2" class="sk-cancel" style="flex:1">✕ Sair</button>
      </div>
      <div id="sk-status" class="sk-status"></div>
    `;

    this.panelEl.querySelectorAll<HTMLButtonElement>('.sk-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTool((btn.dataset['tool'] ?? 'none') as SketchTool));
    });

    const doClose = () => { this.hide(); this.wp.deactivate(); };

    document.getElementById('sk-close')?.addEventListener('click', doClose);
    document.getElementById('sk-close2')?.addEventListener('click', doClose);
    document.getElementById('sk-clear')?.addEventListener('click', () => this.clearContours());

    document.getElementById('sk-extrude')?.addEventListener('click', async () => {
      const depth = parseFloat((document.getElementById('sk-depth') as HTMLInputElement).value);
      if (isNaN(depth) || depth <= 0) return;
      const st = document.getElementById('sk-status')!;
      st.textContent = '⏳ Extrudindo…';
      await this.applyExtrude(depth, this.wp.activeShapeId >= 0 ? this.wp.activeShapeId : undefined);
      st.textContent = '✅ Feito';
    });

    document.getElementById('sk-revolve')?.addEventListener('click', async () => {
      const angle = parseFloat((document.getElementById('sk-angle') as HTMLInputElement).value);
      if (isNaN(angle) || angle <= 0) return;
      const st = document.getElementById('sk-status')!;
      st.textContent = '⏳ Revolvendo…';
      // Eixo de revolução = Y (vertical) — padrão para tornear cilindros
      await this.applyRevolve(angle, [0, 1, 0], undefined);
      st.textContent = '✅ Feito';
    });
  }
}
