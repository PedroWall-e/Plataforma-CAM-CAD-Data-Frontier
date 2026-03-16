// src/main.ts — CAD MVP Phase 2+ (refatorado: Map de shapes, múltiplos objetos)

import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { invoke }           from '@tauri-apps/api/core';
import { initBVH, disposeBVH, computeSnap } from './snap.js';
import { cadStore, IDENTITY }               from './store.js';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeshData  { vertices: number[]; indices: number[]; }
interface ShapeMesh { shape_id: number;   mesh: MeshData;    }
type PrimType = 'box' | 'cylinder' | 'sphere' | 'cone';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const viewport = document.getElementById('viewport')!;
const statsEl  = document.getElementById('stats')!;
const errorLog = document.getElementById('error-log')!;
const btnEl        = document.getElementById('btn')               as HTMLButtonElement;
const btnDelete    = document.getElementById('btn-delete')        as HTMLButtonElement;
const btnFloor     = document.getElementById('btn-floor')         as HTMLButtonElement;
const snapModeEl   = document.getElementById('snap-mode')         as HTMLSelectElement;
const infoPosEl    = document.getElementById('info-pos')          as HTMLSpanElement;
const infoSizeEl   = document.getElementById('info-size')         as HTMLSpanElement;
const txInputDiv   = document.getElementById('transform-input')   as HTMLDivElement;
const txInputLabel = document.getElementById('transform-input-label') as HTMLLabelElement;
const txInputVal   = document.getElementById('transform-input-val')   as HTMLInputElement;
const txInputOk    = document.getElementById('transform-input-ok')    as HTMLButtonElement;
const txInputCancel= document.getElementById('transform-input-cancel') as HTMLButtonElement;

function showError(msg: string) {
  errorLog.textContent = `⚠ ${msg}`;
  errorLog.style.display = 'block';
  console.error('[CAD]', msg);
}
function clearError() { errorLog.style.display = 'none'; }

// ─── Scene ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1012);
scene.add(new THREE.GridHelper(200, 20, 0x445566, 0x334455));
// Indicador XYZ na origem do grid
const axesHelper = new THREE.AxesHelper(30);
scene.add(axesHelper);
// Tooltip label para o AxesHelper  
const axesLabel = document.createElement('div');
axesLabel.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;font-size:10px;color:#aaa;display:none';
axesLabel.textContent = 'X/Y/Z — use com Face Snap para alinhar ao grid';
document.body.appendChild(axesLabel);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(80, 60, 120);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

// Luzes
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const keyLight = new THREE.DirectionalLight(0xddeeff, 1.3);
keyLight.position.set(100, 150, 80);
keyLight.castShadow = true;
scene.add(keyLight);
const rimLight = new THREE.PointLight(0xa78bfa, 0.7, 600);
rimLight.position.set(-60, 120, -150);
scene.add(rimLight);

// OrbitControls
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.07;
orbit.minDistance = 5;
orbit.maxDistance = 800;

// TransformControls — instanciado de forma lazy ao surgir o primeiro mesh
let tc: TransformControls | null = null;
let pendingTcMode = 'translate';

function getTC(): TransformControls {
  if (!tc) {
    tc = new TransformControls(camera, renderer.domElement);
    tc.setMode(pendingTcMode as 'translate' | 'rotate' | 'scale');
    const tcRoot = (tc as any).getHelper?.() ?? (tc as any)._root;
    if (tcRoot) scene.add(tcRoot);
    tc.addEventListener('dragging-changed', async (e: any) => {
      orbit.enabled = !e.value;
      isDragging = e.value;

      if (e.value && pendingClone && selectedShapeId !== null) {
        // drag iniciado com Alt → clona e transfere TC para o clone
        pendingClone = false;
        const originalId = selectedShapeId;
        const original   = shapeMap.get(originalId)!;
        try {
          const result = await invoke<ShapeMesh>('clone_shape', { shapeId: originalId });
          spawnMesh(result); // muda selectedShapeId + anexa TC ao clone
          // copia a posição do original para que o clone surja no mesmo lugar
          const clone = shapeMap.get(result.shape_id)!;
          clone.position.copy(original.position);
          clone.quaternion.copy(original.quaternion);
          clone.scale.copy(original.scale);
        } catch (err) {
          showError(`clone_shape: ${err instanceof Error ? err.message : String(err)}`);
          pendingClone = false;
        }
        return;
      }

      // drag ended → persiste a transformação no kernel OCCT
      if (!e.value && selectedShapeId !== null) {
        const mesh = shapeMap.get(selectedShapeId);
        if (mesh) persistTransform(selectedShapeId, mesh);
      }
    });
  }
  return tc;
}

// ─── State — declarado ANTES do animate() para evitar TDZ ────────────────────────────
let activePrim: PrimType = 'box';
const shapeMap = new Map<number, THREE.Mesh>();
let selectedShapeId: number | null = null;
let isDragging    = false;
let pendingClone  = false;

// ─── Object info panel (precisa de selectedShapeId antes do animate) ─────────────────
function updateInfoPanel(): void {
  if (selectedShapeId === null) {
    infoPosEl.textContent  = '—';
    infoSizeEl.textContent = '—';
    return;
  }
  const mesh = shapeMap.get(selectedShapeId);
  if (!mesh) return;
  const p = mesh.position;
  infoPosEl.textContent = `X:${fromMM(p.x)} Y:${fromMM(p.y)} Z:${fromMM(p.z)}`;
  const bbox = new THREE.Box3().setFromObject(mesh);
  const s = new THREE.Vector3(); bbox.getSize(s);
  infoSizeEl.textContent = `${fromMM(s.x)} × ${fromMM(s.y)} × ${fromMM(s.z)}`;
}

// Render loop
(function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
  updateInfoPanel();
})();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─── Unit system (mm / cm) ────────────────────────────────────────────────────
type UnitMode = 'mm' | 'cm';
let unitMode: UnitMode = 'mm';
const UNIT_SCALE: Record<UnitMode, number> = { mm: 1, cm: 10 };

/** Converte valor user → mm interno (1 unidade Three.js = 1mm). */
function toMM(v: number): number { return v * UNIT_SCALE[unitMode]; }
/** Converte mm interno → texto na unidade actual. */
function fromMM(v: number): string { return (v / UNIT_SCALE[unitMode]).toFixed(2) + ' ' + unitMode; }

document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    unitMode = (btn as HTMLElement).dataset.unit as UnitMode;
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Actualiza o step dos inputs de primitiva
    document.querySelectorAll('.ctrl input[type="number"]').forEach(inp => {
      (inp as HTMLInputElement).step = unitMode === 'mm' ? '1' : '0.1';
    });
  });
});



// ─── Floor (gravidade) ────────────────────────────────────────────────────────
btnFloor.addEventListener('click', () => {
  if (selectedShapeId === null) return;
  const mesh = shapeMap.get(selectedShapeId)!;
  const bbox = new THREE.Box3().setFromObject(mesh);
  mesh.position.y -= bbox.min.y; // move até o minY da bbox estar em Y=0
  persistTransform(selectedShapeId, mesh);
});

// ─── Transform exact-value input overlay ──────────────────────────────────────
type TxAxis = 'x' | 'y' | 'z';
let txAxis: TxAxis = 'x';
let txMode: 'translate' | 'rotate' | 'scale' = 'translate';

function openTransformInput(mode: 'translate' | 'rotate' | 'scale', axis: TxAxis): void {
  if (selectedShapeId === null) return;
  txMode = mode;
  txAxis = axis;
  const modeLabel = mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
  const unitLabel = mode === 'translate' ? unitMode : mode === 'rotate' ? '°' : 'x';
  txInputLabel.textContent = `${modeLabel} ${axis.toUpperCase()} (${unitLabel})`;
  txInputVal.value = '0';
  txInputDiv.style.display = 'flex';
  setTimeout(() => txInputVal.focus(), 50);
}

function applyTransformInput(): void {
  if (selectedShapeId === null) { closeTransformInput(); return; }
  const raw = parseFloat(txInputVal.value);
  if (isNaN(raw)) { closeTransformInput(); return; }
  const mesh = shapeMap.get(selectedShapeId)!;
  if (txMode === 'translate') {
    mesh.position[txAxis] += toMM(raw);
  } else if (txMode === 'rotate') {
    const euler = new THREE.Euler().copy(mesh.rotation);
    euler[txAxis] += THREE.MathUtils.degToRad(raw);
    mesh.rotation.copy(euler);
  } else {
    mesh.scale[txAxis] *= raw !== 0 ? raw : 1;
  }
  persistTransform(selectedShapeId, mesh);
  closeTransformInput();
}

function closeTransformInput(): void {
  txInputDiv.style.display = 'none';
}

txInputOk.addEventListener('click', applyTransformInput);
txInputCancel.addEventListener('click', closeTransformInput);
txInputVal.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') applyTransformInput();
  if (e.key === 'Escape') closeTransformInput();
});

// Atalhos Blender-style: G/R/S + X/Y/Z abre o input
window.addEventListener('keydown', (ke: KeyboardEvent) => {
  if (txInputDiv.style.display !== 'none') return; // já aberto
  if (selectedShapeId === null) return;
  if (ke.ctrlKey || ke.metaKey) return;
  const modes: Record<string, 'translate' | 'rotate' | 'scale'> = { g: 'translate', r: 'rotate', s: 'scale' };
  const axes: Record<string, TxAxis> = { x: 'x', y: 'y', z: 'z' };
  const mode = modes[ke.key.toLowerCase()];
  const axis = axes[ke.key.toLowerCase()];
  if (mode) { openTransformInput(mode, 'x'); ke.preventDefault(); }
  else if (axis && txMode) { openTransformInput(txMode, axis); ke.preventDefault(); }
});



// Cores de material
const MAT_DEFAULT = { color: 0x9eadba, emissive: new THREE.Color(0x000000) };
const MAT_SELECT  = new THREE.Color(0x1a3a6e); // emissive do objeto selecionado

/** Seleciona um shape: destaca com emissive + acopla TC. */
function selectShape(id: number): void {
  // Remove destaque do anterior
  if (selectedShapeId !== null && selectedShapeId !== id) {
    const prev = shapeMap.get(selectedShapeId);
    if (prev) (prev.material as THREE.MeshStandardMaterial).emissive.copy(MAT_DEFAULT.emissive);
  }
  selectedShapeId = id;
  const mesh = shapeMap.get(id);
  if (!mesh) return;
  (mesh.material as THREE.MeshStandardMaterial).emissive.copy(MAT_SELECT);
  getTC().attach(mesh);
}

/** Deseleciona tudo. */
function deselectAll(): void {
  if (selectedShapeId !== null) {
    const m = shapeMap.get(selectedShapeId);
    if (m) (m.material as THREE.MeshStandardMaterial).emissive.copy(MAT_DEFAULT.emissive);
  }
  selectedShapeId = null;
  tc?.detach();
  clearFaceHighlight();
}

// ─── Face highlight overlay ────────────────────────────────────────────────
let faceHighlightMesh: THREE.Mesh | null = null;

/** Mostra um disco roxo na face clicada como indicador visual. */
function highlightFace(hit: THREE.Intersection): void {
  clearFaceHighlight();
  if (!hit.face) return;
  const src = hit.object as THREE.Mesh;
  // Normal da face em world-space para orientar o disco
  const worldNormal = hit.face.normal.clone().transformDirection(src.matrixWorld).normalize();
  // Disc de raio fixo centrado no ponto de hit, virado para a normal
  const geo = new THREE.CircleGeometry(8, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xa78bfa, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide,
  });
  faceHighlightMesh = new THREE.Mesh(geo, mat);
  faceHighlightMesh.position.copy(hit.point);
  faceHighlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
  // Afasta ligeiramente da superficie para evitar z-fighting
  faceHighlightMesh.position.addScaledVector(worldNormal, 0.3);
  scene.add(faceHighlightMesh);
}

function clearFaceHighlight(): void {
  if (!faceHighlightMesh) return;
  scene.remove(faceHighlightMesh);
  faceHighlightMesh.geometry.dispose();
  (faceHighlightMesh.material as THREE.Material).dispose();
  faceHighlightMesh = null;
}

// ─── Delete handler ─────────────────────────────────────────────────────────
btnDelete.addEventListener('click', deleteSelected);
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
}, { capture: false }); // Não usa capture para não disputar com o undo/redo listener

async function deleteSelected(): Promise<void> {
  if (selectedShapeId === null) return;
  const id   = selectedShapeId;
  const mesh = shapeMap.get(id)!;
  deselectAll();
  tc?.detach();
  disposeBVH(mesh);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  scene.remove(mesh);
  shapeMap.delete(id);
  cadStore.removeShape(id);
  try { await invoke('delete_shape', { shapeId: id }); } catch { /* silencioso */ }
  updateStats();
}

// ─── Face Snap mode ───────────────────────────────────────────────────
interface FacePick { shapeId: number; worldPoint: THREE.Vector3; worldNormal: THREE.Vector3; }
let faceSnapActive = false;
let firstFacePick: FacePick | null = null;
const btnFaceSnap  = document.getElementById('btn-face-snap') as HTMLButtonElement;
const snapStatusEl = document.getElementById('snap-status')   as HTMLSpanElement;
const snapAlignEl  = document.getElementById('snap-align')    as HTMLSelectElement;

function setSnapStatus(msg: string, visible = true) {
  snapStatusEl.textContent = msg;
  snapStatusEl.style.display = visible ? 'inline' : 'none';
}

function applyFaceSnap(faceA: FacePick, faceB: FacePick): void {
  const meshA = shapeMap.get(faceA.shapeId);
  const meshB = shapeMap.get(faceB.shapeId);
  if (!meshA || !meshB) return;

  const mode = snapAlignEl.value; // 'face' ou 'center'

  if (mode === 'center') {
    // Centro ↔ Centro: move o centro de B para o centro de A
    const bboxA = new THREE.Box3().setFromObject(meshA);
    const bboxB = new THREE.Box3().setFromObject(meshB);
    const centerA = new THREE.Vector3(); bboxA.getCenter(centerA);
    const centerB = new THREE.Vector3(); bboxB.getCenter(centerB);
    meshB.position.add(centerA.clone().sub(centerB));
  } else {
    // Face ↔ Face (modo "paralelas"): apenas rotação — faces ficam paralelas, sem alterar posição
    const targetNormal = faceA.worldNormal.clone().negate();
    const delta = new THREE.Quaternion().setFromUnitVectors(faceB.worldNormal, targetNormal);
    meshB.quaternion.premultiply(delta);
    meshB.updateWorldMatrix(true, false);
    // Move apenas o suficiente para as faces (planos) se tocarem, sem repositionamento lateral
    // Projecção do ponto B no eixo da normal para calcular gap
    const centerB = new THREE.Vector3();
    new THREE.Box3().setFromObject(meshB).getCenter(centerB);
    // distância entre o plano de A e o centro de B na direção da normal
    const gapAlongNormal = faceA.worldNormal.clone().dot(faceA.worldPoint.clone().sub(centerB));
    meshB.position.addScaledVector(faceA.worldNormal, gapAlongNormal);
  }

  persistTransform(faceB.shapeId, meshB);
}

btnFaceSnap.addEventListener('click', () => {
  faceSnapActive = !faceSnapActive;
  firstFacePick  = null;
  btnFaceSnap.classList.toggle('active', faceSnapActive);
  btnFaceSnap.textContent = faceSnapActive ? '🧲 Cancelar' : '🧲 Face Snap';
  setSnapStatus(faceSnapActive ? 'Clique na face do objeto A' : '', faceSnapActive);
  // desacopla TC para não interferir com a selecção de faces
  if (faceSnapActive) tc?.detach();
});

// ─── Click-to-select + Face Snap click handler ───────────────────────────
const _clickRay = new THREE.Raycaster();
const _pointerDownXY = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
  _pointerDownXY.set(e.clientX, e.clientY);
  if (e.altKey && selectedShapeId !== null) pendingClone = true;
});

renderer.domElement.addEventListener('pointerup', (e: PointerEvent) => {
  // Ignora se foi um drag (deslocamento > 5 px)
  const dx = e.clientX - _pointerDownXY.x;
  const dy = e.clientY - _pointerDownXY.y;
  if (dx * dx + dy * dy > 25) return;

  const cm = new THREE.Vector2(
    (e.clientX / innerWidth)  * 2 - 1,
    -(e.clientY / innerHeight) * 2 + 1,
  );
  _clickRay.setFromCamera(cm, camera);
  const hits = _clickRay.intersectObjects([...shapeMap.values()], false);
  if (hits.length === 0 || !hits[0].face) return;

  const hit     = hits[0];
  const hitMesh = hit.object as THREE.Mesh;
  const hitId   = [...shapeMap.entries()].find(([, m]) => m === hitMesh)?.[0];
  if (hitId === undefined) return;

  if (faceSnapActive) {
    const worldNormal = hit.face!.normal.clone()
      .transformDirection(hitMesh.matrixWorld).normalize();
    if (!firstFacePick) {
      firstFacePick = { shapeId: hitId, worldPoint: hit.point.clone(), worldNormal };
      highlightFace(hit); // destaca a face A em roxo
      setSnapStatus('Clique na face do objeto B');
    } else if (hitId !== firstFacePick.shapeId) {
      const faceB = { shapeId: hitId, worldPoint: hit.point.clone(), worldNormal };
      applyFaceSnap(firstFacePick, faceB);
      clearFaceHighlight();  // limpa o highlight da face A
      // Sai do modo snap
      faceSnapActive = false;
      firstFacePick  = null;
      btnFaceSnap.classList.remove('active');
      btnFaceSnap.textContent = '🧲 Face Snap';
      setSnapStatus('', false);
      // Re-seleciona o objeto movido
      selectedShapeId = hitId;
      getTC().attach(hitMesh);
    }
  } else {
    // Click normal: seleciona o shape clicado
    selectShape(hitId);
  }
});

// Click no fundo (sem objecto) → deseleciona tudo
renderer.domElement.addEventListener('click', (e: MouseEvent) => {
  const dx = e.clientX - _pointerDownXY.x;
  const dy = e.clientY - _pointerDownXY.y;
  if (dx * dx + dy * dy > 25) return; // foi drag
  const cm2 = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  _clickRay.setFromCamera(cm2, camera);
  if (_clickRay.intersectObjects([...shapeMap.values()], false).length === 0) deselectAll();
});

// ─── Mouse tracking + Snap handler ───────────────────────────────────────────
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointermove', (e: PointerEvent) => {
  mouse.x =  (e.clientX / innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  if (!isDragging || selectedShapeId === null) return;
  const dragged = shapeMap.get(selectedShapeId);
  if (!dragged) return;
  const targets = [...shapeMap.values()].filter(m => m !== dragged);
  const snap = computeSnap(mouse, camera, dragged, targets);
  // Só aplica auto-snap se o modo estiver activo
  if (snap && snapModeEl.value === 'face') {
    dragged.position.copy(snap.position);
    dragged.quaternion.copy(snap.quaternion);
  }
});


// ─── Primitive selector ───────────────────────────────────────────────────────
document.querySelectorAll('.prim-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activePrim = (btn as HTMLElement).dataset.type as PrimType;
    document.querySelectorAll('.prim-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.params-group').forEach(g =>
      ((g as HTMLElement).style.display = 'none'));
    const grp = document.getElementById(`params-${activePrim}`);
    if (grp) grp.style.display = 'flex';
  });
});

// ─── Transform mode buttons ───────────────────────────────────────────────────
document.querySelectorAll('.tr-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset.mode ?? 'translate';
    pendingTcMode = mode;
    tc?.setMode(mode as 'translate' | 'rotate' | 'scale');
    document.querySelectorAll('.tr-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ─── Persist transform → OCCT ────────────────────────────────────────────────

/** Envia a matrixWorld actual do mesh ao backend e atualiza a geometria com
 *  a tessalação devolvida. Reseta o transform Three.js para identidade —
 *  o shape OCCT agora já contém a transform gravada na B-Rep. */
async function persistTransform(shapeId: number, mesh: THREE.Mesh): Promise<void> {
  mesh.updateWorldMatrix(true, false);
  const matrix = Array.from(mesh.matrixWorld.elements) as number[];
  try {
    // Notifica o OCCT da nova posição — não toca no mesh Three.js!
    // O TC continua acumulando transformações naturalmente.
    await invoke('transform_shape', { shapeId, matrix });
    cadStore.setMatrix(shapeId, matrix);
  } catch (err) {
    showError(`transform_shape[${shapeId}]: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Restaura as transformações do store nos meshes Three.js e no OCCT. */
async function syncFromStore(): Promise<void> {
  const matrices = cadStore.getMatrices();
  await Promise.all(
    Object.entries(matrices).map(async ([id, matrix]) => {
      const shapeId = Number(id);
      const mesh = shapeMap.get(shapeId);
      if (!mesh) return;
      // Decompõe a matriz de volta em position/quaternion/scale do mesh
      const m4 = new THREE.Matrix4().fromArray(matrix);
      m4.decompose(mesh.position, mesh.quaternion, mesh.scale);
      // Sincroniza o OCCT com a posição anterior
      try {
        await invoke('transform_shape', { shapeId, matrix });
      } catch (err) {
        showError(`sync[${shapeId}]: ${String(err)}`);
      }
    }),
  );
}

// ─── Undo / Redo ─────────────────────────────────────────────────────────
window.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (cadStore.undo()) await syncFromStore();
  } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
    e.preventDefault();
    if (cadStore.redo()) await syncFromStore();
  }
});

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function updateStats() {
  const count = shapeMap.size;
  if (count === 0) { statsEl.textContent = '—'; return; }
  statsEl.textContent = `${count} shape${count > 1 ? 's' : ''} na cena`;
}

function buildMesh(data: MeshData): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertices), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const centre = new THREE.Vector3();
  geo.boundingBox!.getCenter(centre);
  geo.translate(-centre.x, -centre.y, -centre.z);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x9eadba, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide,
  }));
}

/** Substitui a geometria de um mesh in-place (usado em booleanas e retessela\u00e7\u00e3o). */
export function updateGeometry(mesh: THREE.Mesh, data: MeshData): void {
  const old = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertices), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
  geo.computeVertexNormals();
  mesh.geometry = geo;
  initBVH(mesh);  // reconstrói BVH na nova geometria
  old.dispose();
}

/** Adiciona (ou substitui) um shape no Map e na cena. */
function spawnMesh(result: ShapeMesh): void {
  // Se já existe um mesh com esse ID (re-generate do mesmo shape), descarta o antigo
  const existing = shapeMap.get(result.shape_id);
  if (existing) {
    if (selectedShapeId === result.shape_id) tc?.detach();
    disposeBVH(existing);
    existing.geometry.dispose();
    (existing.material as THREE.Material).dispose();
    scene.remove(existing);
  }

  const mesh = buildMesh(result.mesh);
  initBVH(mesh);
  mesh.name = `cad_shape_${result.shape_id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  shapeMap.set(result.shape_id, mesh);
  cadStore.setMatrix(result.shape_id, IDENTITY); // regista no histórico

  // Seleciona o shape recém-criado no TransformControls
  selectedShapeId = result.shape_id;
  (getTC() as any).attach(mesh);

  updateStats();
}

// ─── Generate ─────────────────────────────────────────────────────────────────
function getNum(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement).value);
}

async function loadModel(): Promise<void> {
  clearError();
  btnEl.disabled = true;
  btnEl.textContent = 'Generating…';
  try {
    let result: ShapeMesh;
    switch (activePrim) {
      case 'box': {
        const width = toMM(getNum('box-w')), height = toMM(getNum('box-h')), depth = toMM(getNum('box-d'));
        if ([width, height, depth].some(v => isNaN(v) || v <= 0))
          throw new Error('W/H/D devem ser > 0');
        result = await invoke<ShapeMesh>('create_box', { width, height, depth });
        break;
      }
      case 'cylinder': {
        const radius = toMM(getNum('cyl-r')), height = toMM(getNum('cyl-h'));
        if (radius <= 0 || height <= 0) throw new Error('Radius/Height > 0');
        result = await invoke<ShapeMesh>('create_cylinder', { radius, height });
        break;
      }
      case 'sphere': {
        const radius = toMM(getNum('sph-r'));
        if (radius <= 0) throw new Error('Radius > 0');
        result = await invoke<ShapeMesh>('create_sphere', { radius });
        break;
      }
      case 'cone': {
        const radiusBottom = toMM(getNum('cone-rb'));
        const radiusTop    = toMM(getNum('cone-rt'));
        const height       = toMM(getNum('cone-h'));
        if (radiusBottom <= 0 || height <= 0)
          throw new Error('R Bottom/Height > 0 (R Top pode ser 0)');
        result = await invoke<ShapeMesh>('create_cone', { radiusBottom, radiusTop, height });
        break;
      }
      default:
        throw new Error(`Primitiva desconhecida: ${activePrim}`);
    }
    spawnMesh(result!);
  } catch (err: unknown) {
    showError(`${activePrim}: ${err instanceof Error ? err.message : String(err)}`);
    updateStats();
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Generate';
  }
}

btnEl.addEventListener('click', loadModel);
loadModel();
