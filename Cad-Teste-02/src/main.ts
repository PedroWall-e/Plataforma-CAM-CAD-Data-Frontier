// src/main.ts — CAD MVP Phase 2+ (refatorado: Map de shapes, múltiplos objetos)

import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { invoke }           from '@tauri-apps/api/core';
import { initBVH, disposeBVH, computeSnap } from './snap.js';
import { cadStore, IDENTITY }               from './store.js';
import { historyAdd, historyMarkDeleted, historyClear, _renderHistory } from './history.js';
import { sceneAddShape, sceneRemoveShape, renderSceneTree, sceneGetByShapeId, setSceneCallbacks, sceneAddFolder } from './scene-tree.js';
import { ParamEditor } from './param-editor.js';
import { EdgeSelector } from './edge-selector.js';
import { WorkplaneManager } from './workplane.js';
import { SketchCanvas } from './sketch-canvas.js';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeshData  { vertices: number[]; indices: number[]; }
interface ShapeMesh { shape_id: number;   mesh: MeshData;    }
// ─── ViewSphere 3D (substituição do ViewCube — evitar patente Autodesk) ────────
const VC_SIZE  = 130;  // px — tamanho do ViewSphere
const VC_TOP   = 14;
const VC_RIGHT = 14;

// Cena dedicada sem os objetos da cena principal
const vcScene  = new THREE.Scene();
const vcCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
vcCamera.position.set(0, 0, 4);
// Overlay div (eventos de mouse)
const vcOverlay = document.getElementById('vc-overlay') as HTMLDivElement;

vcScene.add(new THREE.AmbientLight(0xffffff, 0.7));
const vcDirL = new THREE.DirectionalLight(0xffffff, 0.6);
vcDirL.position.set(2, 3, 4); vcScene.add(vcDirL);

// ── Esfera principal ──────────────────────────────────────────────────────────
const vcSphereGeo = new THREE.SphereGeometry(0.9, 32, 32);
const vcSphereMat = new THREE.MeshPhongMaterial({
  color: 0x1a2540, emissive: 0x0a1020,
  specular: 0x6ee7f7, shininess: 60,
  transparent: true, opacity: 0.88,
  wireframe: false,
});
const vcSphere = new THREE.Mesh(vcSphereGeo, vcSphereMat);
vcScene.add(vcSphere);

// Linha de latitude (equador) e meridianos para look visual
const vcLines = new THREE.LineSegments(
  new THREE.WireframeGeometry(new THREE.SphereGeometry(0.92, 8, 4)),
  new THREE.LineBasicMaterial({ color: 0x6ee7f7, transparent: true, opacity: 0.12 })
);
vcScene.add(vcLines);

// ── 6 Labels cardinais como Sprites com Canvas ────────────────────────────────
const VS_POLES = [
  { label: 'Top',    pos: new THREE.Vector3( 0,  1,  0), cam: new THREE.Vector3(0,  200, 1),  color: '#44cc66' },
  { label: 'Bottom', pos: new THREE.Vector3( 0, -1,  0), cam: new THREE.Vector3(0, -200, 1),  color: '#44cc66' },
  { label: 'Front',  pos: new THREE.Vector3( 0,  0,  1), cam: new THREE.Vector3(0,    0, 200), color: '#9966ee' },
  { label: 'Back',   pos: new THREE.Vector3( 0,  0, -1), cam: new THREE.Vector3(0,    0,-200), color: '#9966ee' },
  { label: 'Right',  pos: new THREE.Vector3( 1,  0,  0), cam: new THREE.Vector3(200,  0, 0),  color: '#4488cc' },
  { label: 'Left',   pos: new THREE.Vector3(-1,  0,  0), cam: new THREE.Vector3(-200, 0, 0),  color: '#4488cc' },
] as const;

function makeVSLabel(text: string, color: string, hovered = false): THREE.SpriteMaterial {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle   = hovered ? 'rgba(110,231,247,0.92)' : 'rgba(20,35,65,0.85)';
  ctx.fill();
  ctx.strokeStyle = hovered ? '#fff' : color;
  ctx.lineWidth   = hovered ? 4 : 2.5;
  ctx.stroke();
  ctx.fillStyle   = hovered ? '#0f1012' : '#ddeeff';
  ctx.font = `bold ${text.length > 4 ? 18 : 22}px system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 64);
  return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
}

const vcLabelSprites = VS_POLES.map(p => {
  const sp = new THREE.Sprite(makeVSLabel(p.label, p.color));
  sp.scale.set(0.52, 0.52, 1);
  sp.position.copy(p.pos).multiplyScalar(1.05);
  vcScene.add(sp);
  return sp;
});

// Esfera invisível de hit-test (raio maior para facilitar clique)
const vcHitGeo = new THREE.SphereGeometry(1.0, 16, 8);
const vcHitMat = new THREE.MeshBasicMaterial({ visible: false });
const vcHitMesh = new THREE.Mesh(vcHitGeo, vcHitMat);
vcScene.add(vcHitMesh);

// ── Câmeras por vista ─────────────────────────────────────────────────────────
const VS_FACE_CAMS: THREE.Vector3[] = VS_POLES.map(p => new THREE.Vector3(...p.cam as unknown as [number,number,number]));

let _vcAnimFrame: number | null = null;
function animateCameraTo(target: THREE.Vector3): void {
  const start = camera.position.clone();
  const t0 = performance.now();
  if (_vcAnimFrame !== null) cancelAnimationFrame(_vcAnimFrame);
  function step(now: number) {
    const t = Math.min((now - t0) / 450, 1);
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(start, target, e);
    camera.lookAt(orbit.target);
    orbit.update();
    if (t < 1) _vcAnimFrame = requestAnimationFrame(step);
    else { orbit.update(); }
  }
  _vcAnimFrame = requestAnimationFrame(step);
}

// ── Hover & clique nos labels ─────────────────────────────────────────────────
const vcRay = new THREE.Raycaster();
const vcMouse2 = new THREE.Vector2();
let _vcHoveredLabel = -1;

function vcSetMouse(e: MouseEvent | PointerEvent): void {
  const rect = vcOverlay.getBoundingClientRect();
  vcMouse2.set(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  );
  vcRay.setFromCamera(vcMouse2, vcCamera);
}

function vcUpdateHover(e: MouseEvent | PointerEvent): void {
  vcSetMouse(e);
  const hits = vcRay.intersectObjects(vcLabelSprites, false);
  const newIdx = hits.length > 0 ? vcLabelSprites.indexOf(hits[0].object as THREE.Sprite) : -1;

  if (newIdx !== _vcHoveredLabel) {
    if (_vcHoveredLabel >= 0) {
      vcLabelSprites[_vcHoveredLabel].material.dispose();
      vcLabelSprites[_vcHoveredLabel].material = makeVSLabel(VS_POLES[_vcHoveredLabel].label, VS_POLES[_vcHoveredLabel].color, false);
    }
    _vcHoveredLabel = newIdx;
    if (newIdx >= 0) {
      vcLabelSprites[newIdx].material.dispose();
      vcLabelSprites[newIdx].material = makeVSLabel(VS_POLES[newIdx].label, VS_POLES[newIdx].color, true);
    }
  }
  vcOverlay.style.cursor = newIdx >= 0 ? 'pointer' : (_vcDragging ? 'grabbing' : 'grab');
}

vcOverlay.addEventListener('mousemove', vcUpdateHover);

vcOverlay.addEventListener('click', (e: MouseEvent) => {
  if (_vcDragMoved) return;
  vcSetMouse(e);
  const hits = vcRay.intersectObjects(vcLabelSprites, false);
  if (hits.length > 0) {
    const idx = vcLabelSprites.indexOf(hits[0].object as THREE.Sprite);
    if (idx >= 0) animateCameraTo(VS_FACE_CAMS[idx]);
  }
});

// ── Drag to orbit ─────────────────────────────────────────────────────────────
let _vcDragging = false;
let _vcDragMoved = false;
let _vcDragLastX = 0;
let _vcDragLastY = 0;

vcOverlay.addEventListener('pointerdown', (e: PointerEvent) => {
  _vcDragging = true; _vcDragMoved = false;
  _vcDragLastX = e.clientX; _vcDragLastY = e.clientY;
  vcOverlay.setPointerCapture(e.pointerId); e.stopPropagation();
});
vcOverlay.addEventListener('pointermove', (e: PointerEvent) => {
  vcUpdateHover(e);
  if (!_vcDragging) return;
  const dx = e.clientX - _vcDragLastX, dy = e.clientY - _vcDragLastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) _vcDragMoved = true;
  _vcDragLastX = e.clientX; _vcDragLastY = e.clientY;
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
  sph.theta -= dx * 0.012;
  sph.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.012));
  camera.position.setFromSpherical(sph).add(orbit.target);
  camera.lookAt(orbit.target); orbit.update();
});
vcOverlay.addEventListener('pointerup', () => { _vcDragging = false; });

// Renderiza o ViewSphere usando scissorTest no renderer principal
function renderViewCube(): void {
  const W = renderer.domElement.clientWidth;
  const H = renderer.domElement.clientHeight;
  const vcLeft   = W - VC_RIGHT - VC_SIZE;
  const vcBottom = H - VC_TOP   - VC_SIZE;

  renderer.setScissorTest(true);
  renderer.setScissor(vcLeft, vcBottom, VC_SIZE, VC_SIZE);
  renderer.setViewport(vcLeft, vcBottom, VC_SIZE, VC_SIZE);

  renderer.setClearColor(_vcBgColor, 1);
  renderer.clear(true, true, false);

  // Sincroniza rotação da esfera + labels com a câmera invertida
  vcSphere.quaternion.copy(camera.quaternion).invert();
  vcLines.quaternion.copy(vcSphere.quaternion);
  // Sprites são billboard — apenas move posição relativa para orientação correta
  vcLabelSprites.forEach((sp, i) => {
    sp.position.copy(VS_POLES[i].pos).applyQuaternion(vcSphere.quaternion).multiplyScalar(1.05);
  });

  renderer.render(vcScene, vcCamera);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(_lightTheme ? 0xe8ecf0 : 0x0f1012, 1);
}

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
// Transform Input Box (TIB)
const tibEl       = document.getElementById('tib')         as HTMLDivElement;
const tibInput    = document.getElementById('tib-input')   as HTMLInputElement;
const tibLabel    = document.getElementById('tib-label')   as HTMLSpanElement;
const tibReset    = document.getElementById('tib-reset')   as HTMLButtonElement;
// Grid config
const gridCellEl  = document.getElementById('grid-cell')   as HTMLInputElement;
const gridTotalEl = document.getElementById('grid-total')  as HTMLInputElement;
const gridOxEl    = document.getElementById('grid-ox')     as HTMLInputElement;
const gridOzEl    = document.getElementById('grid-oz')     as HTMLInputElement;
const btnAxesToggle = document.getElementById('btn-axes-toggle') as HTMLButtonElement;

function showError(msg: string) {
  errorLog.textContent = `⚠ ${msg}`;
  errorLog.style.display = 'block';
  console.error('[CAD]', msg);
}
function clearError() { errorLog.style.display = 'none'; }

// ─── Scene ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1012);

// ─── Grid (reconstruído dinamicamente) ─────────────────────────────────────────────
let currentGrid: THREE.GridHelper | null = null;

function updateGrid(): void {
  if (currentGrid) { scene.remove(currentGrid); currentGrid.dispose(); }
  const cell  = Math.max(1, parseFloat(gridCellEl?.value  ?? '10'));
  const total = Math.max(cell * 2, parseFloat(gridTotalEl?.value ?? '1000'));
  const ox    = parseFloat(gridOxEl?.value ?? '0') || 0;
  const oz    = parseFloat(gridOzEl?.value ?? '0') || 0;
  const divs  = Math.round(total / cell);
  currentGrid = new THREE.GridHelper(total, divs, 0x445566, 0x334455);
  currentGrid.position.set(ox, 0, oz);
  scene.add(currentGrid);
  // Actualiza AxesHelper para a mesma origem
  axesHelper.position.set(ox, 0, oz);
}
// updateGrid chamado quando os inputs mudam — também move o originGroup
[gridCellEl, gridTotalEl, gridOxEl, gridOzEl].forEach(inp => {
  inp?.addEventListener('change', () => {
    updateGrid();
    const ox = parseFloat(gridOxEl?.value ?? '0') || 0;
    const oz = parseFloat(gridOzEl?.value ?? '0') || 0;
    if (originGroup) originGroup.position.set(ox, 0, oz);
  });
});

// Indicador de origem — três quadrados coloridos semi-transparentes nos eixos
const originGroup = new THREE.Group();
// XZ plane (chão) — azul
const xzPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
);
xzPlane.rotation.x = -Math.PI / 2;
originGroup.add(xzPlane);
// XY plane (parede frontal) — vermelho
const xyPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
);
originGroup.add(xyPlane);
// YZ plane (parede lateral) — verde
const yzPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshBasicMaterial({ color: 0x44cc66, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
);
yzPlane.rotation.y = Math.PI / 2;
originGroup.add(yzPlane);
// Eixos (linhas) sobre os planos
const axesHelper = new THREE.AxesHelper(50);
originGroup.add(axesHelper);
scene.add(originGroup);
// Inicializa grid com valores default
updateGrid();
// Toggle visibilidade
btnAxesToggle.addEventListener('click', () => {
  originGroup.visible = !originGroup.visible;
  btnAxesToggle.textContent = originGroup.visible ? 'XYZ 👁 visível' : 'XYZ ∅ oculto';
  btnAxesToggle.style.opacity = originGroup.visible ? '1' : '.5';
});

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

// ─── Transform Input Box (TIB) ────────────────────────────────────────────────────
const AXIS_COLORS: Record<string, string> = { X:'#ff6666', Y:'#66ff66', Z:'#66aaff', default:'#6ee7f7' };
let tibActive   = false;
let tibTyped    = false;
let tibLastAxis = 'X'; // último eixo activo — guardado para usar após drag terminar
const tibStartPos = new THREE.Vector3();
const tibStartRot = new THREE.Euler();
const tibStartScl = new THREE.Vector3();

function tibShow(mesh: THREE.Mesh): void {
  tibActive = true;
  tibTyped  = false;
  tibStartPos.copy(mesh.position);
  tibStartRot.copy(mesh.rotation);
  tibStartScl.copy(mesh.scale);
  tibInput.value = '0';
  tibEl.classList.remove('show');
  tibEl.style.display = 'flex';
  requestAnimationFrame(() => tibEl.classList.add('show'));
  // Posição inicial: canto inferior direito da cena (se não foi ainda movido pelo user)
  if (_tibX === 0 && _tibY === 0) {
    _tibX = Math.max(20, innerWidth  - 230);
    _tibY = Math.max(80, innerHeight - 200);
  }
  tibPositionUpdate();
  setTimeout(() => tibInput.focus(), 80);
}

function tibHide(): void {
  tibActive = false;
  tibEl.style.display = 'none';
  tibEl.className = ''; // remove axis-x/y/z + show
}

// ─── TIB — posição fixa + arrastável pelo header ───────────────────────────────────
let _tibMouseX = 100;
let _tibMouseY = 100;
// Posição fixa do TIB (actualizada pelo drag do header)
let _tibX = 0;
let _tibY = 0;
let _tibDragging = false;
let _tibDragOffX = 0;
let _tibDragOffY = 0;
const tibHeader = document.getElementById('tib-header') as HTMLDivElement;

tibHeader.addEventListener('pointerdown', (e: PointerEvent) => {
  // Não inicia drag se o click foi no botão ↩ 0
  if ((e.target as HTMLElement).closest('#tib-reset')) return;
  _tibDragging = true;
  _tibDragOffX = e.clientX - _tibX;
  _tibDragOffY = e.clientY - _tibY;
  tibHeader.setPointerCapture(e.pointerId);
  e.stopPropagation();
});
document.addEventListener('pointermove', (e: PointerEvent) => {
  _tibMouseX = e.clientX; _tibMouseY = e.clientY;
  if (_tibDragging) {
    _tibX = e.clientX - _tibDragOffX;
    _tibY = e.clientY - _tibDragOffY;
    tibEl.style.left = `${_tibX}px`;
    tibEl.style.top  = `${_tibY}px`;
  }
});
document.addEventListener('pointerup', () => { _tibDragging = false; });

function tibPositionUpdate(): void {
  // Posição fixa — chama apenas ao abrir o TIB (não segue o mouse)
  // O user pode mover o TIB arrastando o header
  tibEl.style.left = `${_tibX}px`;
  tibEl.style.top  = `${_tibY}px`;
}

/** Converte mm interno → número na unidade actual (só o número, sem sufixo — para inputs type=number). */
function toUnitNum(v: number): string { return (v / UNIT_SCALE[unitMode]).toFixed(2); }

function tibUpdateValue(mesh: THREE.Mesh): void {
  if (tibTyped) return;
  const axisRaw: string = (tc as any)?.axis ?? tibLastAxis;
  if (axisRaw) tibLastAxis = axisRaw;
  const axisLow = axisRaw.toLowerCase();
  const mode    = pendingTcMode;

  // atualiza class CSS do eixo (mantém 'show')
  tibEl.className = `show${axisLow.length === 1 ? ` axis-${axisLow}` : ''}`;
  const color = AXIS_COLORS[axisRaw] ?? AXIS_COLORS.default;
  tibLabel.style.color = color;

  if (mode === 'translate') {
    const d = mesh.position.clone().sub(tibStartPos);
    // toUnitNum devolve só o número — compativel com <input type="number">
    if (axisLow === 'x')      tibInput.value = toUnitNum(d.x);
    else if (axisLow === 'y') tibInput.value = toUnitNum(d.y);
    else if (axisLow === 'z') tibInput.value = toUnitNum(d.z);
    else                      tibInput.value = toUnitNum(d.length());
    tibLabel.textContent = `Δ ${axisRaw || 'XYZ'} (${unitMode})`;
  } else if (mode === 'rotate') {
    const a = axisLow as 'x'|'y'|'z';
    if (a && a.length === 1) {
      // Ângulo absoluto atual (não delta) — assim o snap com Ctrl mostra 45, 90, 135...
      tibInput.value = THREE.MathUtils.radToDeg(mesh.rotation[a]).toFixed(2);
    }
    tibLabel.textContent = `θ ${axisRaw || 'ROT'} (°)`;
  } else {
    const a = axisLow as 'x'|'y'|'z';
    if (a && a.length === 1) {
      tibInput.value = (mesh.scale[a] / tibStartScl[a]).toFixed(3);
    }
    tibLabel.textContent = `Scale ${axisRaw || 'XYZ'}`;
  }
}

function tibApplyTyped(): void {
  if (selectedShapeId === null) { tibHide(); return; }
  const val  = parseFloat(tibInput.value);
  if (isNaN(val)) { tibHide(); return; }
  const mesh = shapeMap.get(selectedShapeId)!;
  // Usa tibLastAxis porque tc.axis é null depois do drag terminar
  const axisRaw = (tc as any)?.axis || tibLastAxis || 'X';
  const a  = axisRaw.toLowerCase() as 'x'|'y'|'z';
  const mode = pendingTcMode;
  if (mode === 'translate' && a.length === 1) {
    mesh.position[a] = tibStartPos[a] + toMM(val);
  } else if (mode === 'rotate' && a.length === 1) {
    // Aplica como ângulo absoluto (não acumulado)
    mesh.rotation[a] = THREE.MathUtils.degToRad(val);
  } else if (mode === 'scale' && a.length === 1) {
    mesh.scale[a] = tibStartScl[a] * (val !== 0 ? val : 1);
  }
  persistTransform(selectedShapeId, mesh);
  tibHide();
}

const AXIS_CYCLE: Record<string, string> = { X:'Y', Y:'Z', Z:'X', x:'y', y:'z', z:'x' };

function tibCycleAxis(): void {
  // Aplica o valor actual (se não for 0) e avança para o próximo eixo
  const val = parseFloat(tibInput.value);
  if (!isNaN(val) && val !== 0 && selectedShapeId !== null) {
    const mesh = shapeMap.get(selectedShapeId)!;
    const a    = tibLastAxis.toLowerCase() as 'x'|'y'|'z';
    const mode = pendingTcMode;
    if      (mode === 'translate' && a.length === 1) { mesh.position[a] = tibStartPos[a] + toMM(val); tibStartPos.copy(mesh.position); }
    else if (mode === 'rotate'    && a.length === 1) { mesh.rotation[a] = THREE.MathUtils.degToRad(val); tibStartRot.copy(mesh.rotation); }
    else if (mode === 'scale'     && a.length === 1) { mesh.scale[a] = tibStartScl[a] * (val || 1); tibStartScl.copy(mesh.scale); }
    persistTransform(selectedShapeId, mesh);
  }
  // Cicla para o próximo eixo
  tibLastAxis = AXIS_CYCLE[tibLastAxis] ?? 'X';
  tibTyped    = false;
  tibInput.value = '0';
  const axisLow = tibLastAxis.toLowerCase();
  tibEl.className = `show axis-${axisLow}`;
  const color = AXIS_COLORS[tibLastAxis] ?? AXIS_COLORS.default;
  tibLabel.style.color  = color;
  const mode = pendingTcMode;
  tibLabel.textContent = mode === 'translate' ? `Δ ${tibLastAxis} (${unitMode})`
                        : mode === 'rotate'   ? `Δ ${tibLastAxis} (°)`
                        : `Scale ${tibLastAxis}`;
  tibInput.focus(); tibInput.select();
}

tibInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter')  { tibApplyTyped(); e.preventDefault(); return; }
  if (e.key === 'Escape') { tibHide(); return; }
  if (e.key === 'Tab')    { tibCycleAxis(); e.preventDefault(); return; }
  e.stopPropagation();
  tibTyped = true;
});
// TIB fecha via deselectAll / selectShape / Esc / Enter — não aqui.

// TransformControls — instanciado de forma lazy ao surgir o primeiro mesh
let tc: TransformControls | null = null;
let pendingTcMode = 'translate';

function getTC(): TransformControls {
  if (!tc) {
    tc = new TransformControls(camera, renderer.domElement);
    tc.setMode(pendingTcMode as 'translate' | 'rotate' | 'scale');
    const tcRoot = (tc as any).getHelper?.() ?? (tc as any)._root;
    if (tcRoot) scene.add(tcRoot);

    // Actualiza TIB em tempo real enquanto o user arrasta
    tc.addEventListener('objectChange', () => {
      if (!tibActive || selectedShapeId === null) return;
      const mesh = shapeMap.get(selectedShapeId);
      if (mesh) { tibUpdateValue(mesh); tibPositionUpdate(); }
    });

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
          spawnMesh(result);
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

      if (e.value) {
        // drag iniciado → mostra TIB
        const mesh = selectedShapeId !== null ? shapeMap.get(selectedShapeId) : null;
        if (mesh) tibShow(mesh);
      } else {
        // drag terminado
        if (tibTyped) {
          // user digitou durante o drag: aplica imediatamente
          tibApplyTyped();
        } else {
          // arraste normal: persiste mas mantém TIB visível para o user ajustar
          tibTyped = false; // reseta flag para próximo input
          if (selectedShapeId !== null) {
            const mesh = shapeMap.get(selectedShapeId);
            if (mesh) persistTransform(selectedShapeId, mesh);
          }
          // TIB permanece aberto até click-fora (ver listener abaixo)
        }
      }
    });
  }
  return tc;
}

// ─── State — declarado ANTES do animate() para evitar TDZ ────────────────────────────
let activePrim: PrimType = 'box';
const shapeMap = new Map<number, THREE.Mesh>();
const originalScales = new Map<number, THREE.Vector3>(); // escala original na criação
let selectedShapeId: number | null = null;
let isDragging    = false;
let pendingClone  = false;

// ─── Multi-seleção para Booleanos ─────────────────────────────────────────────
// selectionOrder[0] = A (primeiro clicado), selectionOrder[1] = B (segundo)
const selectionOrder: number[] = [];
const _boolRow = document.getElementById('boolean-row') as HTMLDivElement | null;

function updateBoolRow(): void {
  if (!_boolRow) return;
  if (selectionOrder.length === 2) {
    _boolRow.style.display = 'flex';
    // Destaca A em azul, B em vermelho
    shapeMap.forEach((mesh, id) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (id === selectionOrder[0])      mat.emissive.setHex(0x003366);  // A
      else if (id === selectionOrder[1]) mat.emissive.setHex(0x550000);  // B
      else                               mat.emissive.setHex(0x000000);
    });
  } else {
    _boolRow.style.display = 'none';
  }
}

function addToSelection(id: number): void {
  const idx = selectionOrder.indexOf(id);
  if (idx >= 0) {
    // Já selecionado → remove (toggle)
    selectionOrder.splice(idx, 1);
    const m = shapeMap.get(id) as any;
    if (m?.material?.emissive) m.material.emissive.setHex(0x111111);
  } else {
    if (selectionOrder.length >= 2) {
      // já tem 2 → substitui o mais antigo
      const oldId = selectionOrder.shift()!;
      const om = shapeMap.get(oldId) as any;
      if (om?.material?.emissive) om.material.emissive.setHex(0x000000);
    }
    selectionOrder.push(id);
  }
  updateBoolRow();
}

function clearBoolSelection(): void {
  selectionOrder.forEach(id => {
    const m = shapeMap.get(id) as any;
    if (m?.material?.emissive) m.material.emissive.setHex(0x000000);
  });
  selectionOrder.length = 0;
  if (_boolRow) _boolRow.style.display = 'none';
}

// ─── Booleanos: handlers dos botões ────────────────────────────────────────────
async function runBoolean(op: 'boolean_union' | 'boolean_cut' | 'boolean_intersect'): Promise<void> {
  if (selectionOrder.length < 2) return;
  const [idA, idB] = selectionOrder;
  try {
    type ShapeMesh = { shape_id: number; mesh: { vertices: number[]; indices: number[] } };
    const result = await invoke<ShapeMesh>(op, { idA, idB });
    // Atualiza a geometria do mesh A com o resultado
    const meshA = shapeMap.get(idA)!;
    // ★ applyWorldSpaceGeo: normaliza coordenadas + gizmo
    applyWorldSpaceGeo(idA, meshA, result.mesh.vertices, result.mesh.indices);
    // Remove mesh B da cena
    const meshB = shapeMap.get(idB)!;
    scene.remove(meshB);
    meshB.geometry.dispose();
    shapeMap.delete(idB);
    cadStore.removeShape(idB);
    // Limpa seleção
    clearBoolSelection();
    selectedShapeId = idA;
    (meshA.material as THREE.MeshStandardMaterial).emissive.setHex(0x111111);
  } catch (err) {
    console.error(`${op} falhou:`, err);
  }
}

document.getElementById('btn-union')?.    addEventListener('click', () => runBoolean('boolean_union'));
document.getElementById('btn-cut')?.      addEventListener('click', () => runBoolean('boolean_cut'));
document.getElementById('btn-intersect')?.addEventListener('click', () => runBoolean('boolean_intersect'));


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

// \u2500\u2500\u2500 Origin plane hover + select \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Planos: 0=XZ(floor/azul), 1=XY(frontal/vermelho), 2=YZ(lateral/verde)
const originPlanes: THREE.Mesh[] = [xzPlane as THREE.Mesh, xyPlane as THREE.Mesh, yzPlane as THREE.Mesh];
const PLANE_BASE_OPACITY    = [0.18, 0.12, 0.12];
const PLANE_HOVER_OPACITY   = [0.45, 0.35, 0.35];
const PLANE_SELECT_OPACITY  = [0.65, 0.55, 0.55];
let hoveredPlaneIdx  = -1;
let selectedPlaneIdx = -1;
const _originRay = new THREE.Raycaster();
const _mouseVec   = new THREE.Vector2();

// Clique num plano → seleciona / deseleciona
renderer.domElement.addEventListener('click', (e: MouseEvent) => {
  if (!originGroup.visible) return;
  _mouseVec.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  _originRay.setFromCamera(_mouseVec, camera);
  const hits = _originRay.intersectObjects(originPlanes, false);
  if (hits.length > 0) {
    const idx = originPlanes.indexOf(hits[0].object as THREE.Mesh);
    selectedPlaneIdx = (selectedPlaneIdx === idx) ? -1 : idx; // toggle
  }
});

function updateOriginPlanes(): void {
  if (!originGroup.visible) return;
  _mouseVec.set((_tibMouseX / innerWidth) * 2 - 1, -(_tibMouseY / innerHeight) * 2 + 1);
  _originRay.setFromCamera(_mouseVec, camera);
  const hits = _originRay.intersectObjects(originPlanes, false);
  hoveredPlaneIdx = hits.length > 0 ? originPlanes.indexOf(hits[0].object as THREE.Mesh) : -1;

  originPlanes.forEach((plane, i) => {
    const mat = plane.material as THREE.MeshBasicMaterial;
    if (i === selectedPlaneIdx) {
      mat.opacity = PLANE_SELECT_OPACITY[i];
    } else if (i === hoveredPlaneIdx) {
      mat.opacity = PLANE_HOVER_OPACITY[i];
    } else {
      mat.opacity = PLANE_BASE_OPACITY[i];
    }
  });
}

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
    // Actualiza os spans com a unidade nos labels
    document.querySelectorAll('.unit-lbl').forEach(el => {
      el.textContent = `(${unitMode})`;
    });
  });
});

// ─── i18n ─────────────────────────────────────────────────────────────────────
type Lang = 'pt' | 'en';
let currentLang: Lang = 'pt';

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  pt: {
    width:'Largura', height:'Altura', depth:'Profund.', radius:'Raio',
    rBottom:'R. Base', rTop:'R. Topo', generate:'Gerar', floor:'⬇ Chão',
    deleteLbl:'🗑 Apagar', language:'Língua', xyzVisible:'XYZ 👁 visível',
    theme:'Tema', zoom:'Zoom', orbit:'Giro', pan:'Pan',
    box:'Caixa', cylinder:'Cilindro', sphere:'Esfera', cone:'Cone',
    faceSnap:'🧲 Encaixe de Face', faceFace:'Face ↔ Face', centerCenter:'Centro ↔ Centro',
    snapMode:'Encaixe', off:'Desli.', faceAuto:'Face Auto',
  },
  en: {
    width:'Width', height:'Height', depth:'Depth', radius:'Radius',
    rBottom:'R Bottom', rTop:'R Top', generate:'Generate', floor:'⬇ Floor',
    deleteLbl:'🗑 Delete', language:'Language', xyzVisible:'XYZ 👁 visible',
    theme:'Theme', zoom:'Zoom', orbit:'Orbit', pan:'Pan',
    box:'Box', cylinder:'Cylinder', sphere:'Sphere', cone:'Cone',
    faceSnap:'🧲 Face Snap', faceFace:'Face ↔ Face', centerCenter:'Center ↔ Center',
    snapMode:'Snap', off:'Off', faceAuto:'Face Auto',
  },
};

function applyLang(lang: Lang): void {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = (el as HTMLElement).dataset.i18n!;
    const text = TRANSLATIONS[lang][key];
    if (text) el.textContent = text;
  });
  const btnLang = document.getElementById('btn-lang') as HTMLButtonElement | null;
  if (btnLang) btnLang.textContent = lang === 'pt' ? 'EN' : 'PT-BR';
}

const btnLang = document.getElementById('btn-lang') as HTMLButtonElement | null;
btnLang?.addEventListener('click', () => applyLang(currentLang === 'pt' ? 'en' : 'pt'));
// Aplica PT-BR imediatamente ao carregar
applyLang('pt');

// ─── Tema claro / escuro (afeta UI + viewport 3D) ────────────────────────────
let _lightTheme = false;

function applyTheme3D(light: boolean): void {
  // Fundo da cena 3D
  const bgDark  = new THREE.Color(0x0f1012);
  const bgLight = new THREE.Color(0xe8ecf0);
  scene.background = light ? bgLight : bgDark;

  // Grid helper: recria com cores temáticas
  if (currentGrid) {
    scene.remove(currentGrid); currentGrid.dispose();
  }
  const cell  = Math.max(1, parseFloat((document.getElementById('grid-cell')  as HTMLInputElement)?.value ?? '10'));
  const total = Math.max(cell * 2, parseFloat((document.getElementById('grid-total') as HTMLInputElement)?.value ?? '1000'));
  const ox    = parseFloat((document.getElementById('grid-ox') as HTMLInputElement)?.value ?? '0') || 0;
  const oz    = parseFloat((document.getElementById('grid-oz') as HTMLInputElement)?.value ?? '0') || 0;
  const divs  = Math.round(total / cell);
  const cCenter = light ? 0x778899 : 0x445566;
  const cLines  = light ? 0xaabbcc : 0x334455;
  currentGrid = new THREE.GridHelper(total, divs, cCenter, cLines);
  currentGrid.position.set(ox, 0, oz);
  scene.add(currentGrid);

  // Cor dos objetos gerados: no tema claro ficam mais escuros p/ visibilidade
  shapeMap.forEach(mesh => {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat?.color) {
      mat.color.set(light ? 0x3a6080 : 0x5a8fb0);
      mat.needsUpdate = true;
    }
  });

  // ViewCube Background (no renderViewCube)
  _vcBgColor = light ? 0xe2e8ef : 0x0d1117;

  // updateGrid no renderViewCube já usa _vcBgColor
}

let _vcBgColor = 0x0d1117; // usado em renderViewCube

const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement | null;
btnTheme?.addEventListener('click', () => {
  _lightTheme = !_lightTheme;
  document.body.classList.toggle('light-theme', _lightTheme);
  if (btnTheme) btnTheme.textContent = _lightTheme ? '🌙 Escuro' : '☀ Claro';
  applyTheme3D(_lightTheme);
});

// ─── Barra de navegação inferior ─────────────────────────────────────────────
const _nbZoomSlider = document.getElementById('nb-zoom-slider') as HTMLInputElement | null;

// Sincroniza slider com a distância da câmera ao target
function nbSyncSlider(): void {
  if (!_nbZoomSlider) return;
  const dist = camera.position.distanceTo(orbit.target);
  _nbZoomSlider.value = String(Math.round(dist));
}

_nbZoomSlider?.addEventListener('input', () => {
  const dist = parseFloat(_nbZoomSlider!.value);
  const dir = camera.position.clone().sub(orbit.target).normalize();
  camera.position.copy(orbit.target).addScaledVector(dir, dist);
  orbit.update();
});

function nbZoom(delta: number): void {
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
  sph.radius = Math.max(10, sph.radius + delta);
  camera.position.setFromSpherical(sph).add(orbit.target);
  orbit.update(); nbSyncSlider();
}
function nbOrbit(dt: number, dp: number): void {
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
  sph.theta += dt; sph.phi = Math.max(0.05, Math.min(Math.PI-0.05, sph.phi + dp));
  camera.position.setFromSpherical(sph).add(orbit.target);
  camera.lookAt(orbit.target); orbit.update();
}
function nbPan(dx: number, dy: number): void {
  const right = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
  const up    = camera.up.clone();
  orbit.target.addScaledVector(right, dx).addScaledVector(up, dy);
  camera.position.addScaledVector(right, dx).addScaledVector(up, dy);
  orbit.update();
}

// Hold-to-repeat helper
function nbHold(el: string | null, fn: () => void, interval = 80): void {
  const btn = typeof el === 'string' ? document.getElementById(el) : el;
  if (!btn) return;
  let tid: ReturnType<typeof setInterval> | null = null;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); tid = setInterval(fn, interval); });
  const stop = () => { if (tid) { clearInterval(tid); tid = null; } };
  btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop);
}

nbHold('nb-zoom-out', () => nbZoom(10));
nbHold('nb-zoom-in',  () => nbZoom(-10));
nbHold('nb-orb-l',    () => nbOrbit(-0.08, 0));
nbHold('nb-orb-r',    () => nbOrbit( 0.08, 0));
nbHold('nb-orb-u',    () => nbOrbit(0, -0.08));
nbHold('nb-orb-d',    () => nbOrbit(0,  0.08));
nbHold('nb-pan-l',    () => nbPan(-3, 0));
nbHold('nb-pan-r',    () => nbPan( 3, 0));
nbHold('nb-pan-u',    () => nbPan(0,  3));
nbHold('nb-pan-d',    () => nbPan(0, -3));
document.getElementById('nb-home')?.addEventListener('click', () => animateCameraTo(new THREE.Vector3(80, 60, 120)));


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
const _filletRow    = document.getElementById('fillet-row')    as HTMLDivElement | null;
const _filletRadius = document.getElementById('fillet-radius') as HTMLInputElement | null;

function selectShape(id: number): void {
  if (selectedShapeId !== null && selectedShapeId !== id) {
    const prev = shapeMap.get(selectedShapeId);
    if (prev) (prev.material as THREE.MeshStandardMaterial).emissive.copy(MAT_DEFAULT.emissive);
    tibHide(); // fecha TIB ao trocar de objeto
  }
  selectedShapeId = id;
  const mesh = shapeMap.get(id);
  if (!mesh) return;
  (mesh.material as THREE.MeshStandardMaterial).emissive.copy(MAT_SELECT);
  getTC().attach(mesh);
  if (_filletRow) _filletRow.style.display = 'flex'; // mostra painel de arestas
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
  tibHide(); // fecha TIB ao desselecionar
  if (_filletRow) _filletRow.style.display = 'none';
}


// ─── applyWorldSpaceGeo ───────────────────────────────────────────────────────
//
// Sempre que o OCCT retorna geometria em world-space (fillet, chamfer, boolean,
// undo, redo, shell), usamos esta função para:
//   1. Montar a geometria world-space
//   2. Calcular o centro do bounding box (= posição visual do objeto)
//   3. Converter para coordenadas locais (subtrai o centro)
//   4. Definir mesh.position = centro (gizmo aparece sobre o shape)
//   5. Resetar rotation/scale (OCCT já absorveu esses valores)
//   6. Registrar a nova matriz no cadStore (histórico)
//
function applyWorldSpaceGeo(
  shapeId: number,
  mesh: THREE.Mesh,
  verts: number[] | Float32Array,
  indices: number[] | Uint32Array,
): void {
  const posArr = verts   instanceof Float32Array ? verts   : new Float32Array(verts);
  const idxArr = indices instanceof Uint32Array  ? indices : new Uint32Array(indices);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  // Centro do bounding box em world-space → novo mesh.position
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);

  // Converte vértices para coordenadas locais (relativo ao centro)
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  mesh.geometry.dispose();
  mesh.geometry = geo;
  initBVH(mesh);

  // Reseta transform Three.js: position = centro world, rotation/scale = identidade
  mesh.position.copy(center);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  mesh.updateWorldMatrix(true, false);

  // Salva a nova matriz no histórico (cadStore)
  cadStore.setMatrix(shapeId, Array.from(mesh.matrixWorld.elements));

  // Reattacha gizmo se este shape está selecionado
  if (tc && selectedShapeId === shapeId) tc.attach(mesh);
}

// ─── Fillet / Chamfer handlers ─────────────────────────────────────────────────
async function runEdgeOp(op: 'fillet_shape' | 'chamfer_shape' | 'shell_shape'): Promise<void> {
  if (selectedShapeId === null) return;
  const id     = selectedShapeId;
  const mesh   = shapeMap.get(id)!;
  const radius = parseFloat(_filletRadius?.value ?? '3');
  if (isNaN(radius) || radius <= 0) return;
  try {
    type ShapeMesh = { shape_id: number; mesh: { vertices: number[]; indices: number[] } };
    const result = await invoke<ShapeMesh>(op, { shapeId: id, radius, dist: radius, thickness: radius });
    // ★ applyWorldSpaceGeo: reseta mesh.position + gizmo automaticamente
    applyWorldSpaceGeo(id, mesh, result.mesh.vertices, result.mesh.indices);
  } catch (err) {
    console.error(`${op} falhou:`, err);
  }
}


document.getElementById('btn-fillet')?.addEventListener('click',  () => runEdgeOp('fillet_shape'));
document.getElementById('btn-chamfer')?.addEventListener('click', () => runEdgeOp('chamfer_shape'));

// Shell usa input separado (shell-thickness)
document.getElementById('btn-shell')?.addEventListener('click', async () => {
  if (selectedShapeId === null) return;
  const id   = selectedShapeId;
  const mesh = shapeMap.get(id)!;
  const t    = parseFloat((document.getElementById('shell-thickness') as HTMLInputElement)?.value ?? '3');
  if (isNaN(t) || t <= 0) return;
  try {
    type ShapeMesh = { shape_id: number; mesh: { vertices: number[]; indices: number[] } };
    const result = await invoke<ShapeMesh>('shell_shape', { shapeId: id, thickness: t });
    applyWorldSpaceGeo(id, mesh, result.mesh.vertices, result.mesh.indices); // ★
  } catch (err) { console.error('shell_shape falhou:', err); }
});

// ─── Painel lateral #ops-panel ───────────────────────────────────────────────
const _opsPanel = document.getElementById('ops-panel') as HTMLElement | null;
const _opsTab   = document.getElementById('ops-tab')   as HTMLElement | null;

function toggleOpsPanel(open?: boolean): void {
  if (!_opsPanel) return;
  const isOpen = _opsPanel.classList.contains('open');
  const shouldOpen = open ?? !isOpen;
  _opsPanel.classList.toggle('open', shouldOpen);
  if (_opsTab) _opsTab.style.left = shouldOpen ? '240px' : '0';
}

_opsTab?.addEventListener('click', () => toggleOpsPanel());
document.getElementById('ops-close')?.addEventListener('click', () => toggleOpsPanel(false));

// Colapso individual de cada seção
document.querySelectorAll('.ops-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    const body = btn.nextElementSibling as HTMLElement;
    if (body) body.classList.toggle('collapsed', expanded);
  });
});


// ─── Face highlight overlay ────────────────────────────────────────────────
let faceHighlightMesh: THREE.Mesh | null = null;

/** Destaca precisamente a face lógica completa do mesh — agrupa todos os triângulos co-planares. */
function highlightFace(hit: THREE.Intersection): void {
  clearFaceHighlight();
  if (!hit.face) return;
  const src = hit.object as THREE.Mesh;
  const geo = src.geometry as THREE.BufferGeometry;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const idxAttr = geo.getIndex();

  // Normal da face clicada em world-space (normalizado)
  const worldNormal = hit.face.normal.clone()
    .transformDirection(src.matrixWorld).normalize();
  // d = distância do plano à origem (plano: worldNormal · x = d)
  const d = worldNormal.dot(hit.point);

  // Recolhe vértices de todos os triângulos co-planares (mesma normal ≈ mesma face lógica)
  const EPS = 0.01;
  const faceVerts: number[] = [];
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const ia = idxAttr ? idxAttr.getX(t * 3)     : t * 3;
    const ib = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
    tmpA.fromBufferAttribute(posAttr, ia).applyMatrix4(src.matrixWorld);
    tmpB.fromBufferAttribute(posAttr, ib).applyMatrix4(src.matrixWorld);
    tmpC.fromBufferAttribute(posAttr, ic).applyMatrix4(src.matrixWorld);

    // Calcula normal do triângulo
    const edge1 = tmpB.clone().sub(tmpA);
    const edge2 = tmpC.clone().sub(tmpA);
    const triNormal = edge1.cross(edge2).normalize();

    // Co-planar: normal paralela E mesmo plano
    const normalAlign = Math.abs(triNormal.dot(worldNormal));
    const planeDist   = Math.abs(worldNormal.dot(tmpA) - d);
    if (normalAlign > (1 - EPS) && planeDist < EPS) {
      faceVerts.push(tmpA.x, tmpA.y, tmpA.z);
      faceVerts.push(tmpB.x, tmpB.y, tmpB.z);
      faceVerts.push(tmpC.x, tmpC.y, tmpC.z);
    }
  }

  if (faceVerts.length === 0) return; // fallback — nenhum triângulo encontrado

  const hlGeo = new THREE.BufferGeometry();
  hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faceVerts), 3));
  const hlMat = new THREE.MeshBasicMaterial({
    color: 0xa78bfa, transparent: true, opacity: 0.55,
    depthTest: false, side: THREE.DoubleSide,
  });
  faceHighlightMesh = new THREE.Mesh(hlGeo, hlMat);
  // Afasta ligeiramente da superfície para evitar z-fighting
  faceHighlightMesh.position.addScaledVector(worldNormal, 0.5);
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

// ─── Ctrl + Rotate → snap a 45° ──────────────────────────────────────────────
const SNAP_45 = Math.PI / 4; // 45 graus em radianos

// Garante que o OrbitControls NÃO use Ctrl para pan (evita conflito com snap de TC)
// OrbitControls usa mouseButtons.RIGHT para pan; com Ctrl não deve interferir
(orbit as any).mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 }; // ROTATE=0, DOLLY=1, PAN=2
(orbit as any).keyPanSpeed = 0; // desabilita pan por teclado

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Control') return;
  if (tc && pendingTcMode === 'rotate') {
    tc.rotationSnap = SNAP_45;
    // Força update imediato do TIB se estiver numa drag ativa
    if (tibActive && selectedShapeId !== null) {
      const mesh = shapeMap.get(selectedShapeId);
      if (mesh) tibUpdateValue(mesh);
    }
  }
});
window.addEventListener('keyup', (e: KeyboardEvent) => {
  if (e.key !== 'Control') return;
  if (tc) {
    tc.rotationSnap = null; // volta a livre
    if (tibActive && selectedShapeId !== null) {
      const mesh = shapeMap.get(selectedShapeId);
      if (mesh) tibUpdateValue(mesh);
    }
  }
});

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
  // Remove da árvore e do histórico
  sceneRemoveShape(id);
  historyMarkDeleted(id);
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
    // Face ↔ Face: roda meshB para a face oposta a faceA, depois encosta a face
    // 1. Alinhar normal: face de B deve apontar na direção oposta a face de A
    const targetNormal = faceA.worldNormal.clone().negate();
    const rotDelta = new THREE.Quaternion().setFromUnitVectors(
      faceB.worldNormal.clone().normalize(),
      targetNormal.normalize()
    );
    meshB.quaternion.premultiply(rotDelta);
    meshB.updateWorldMatrix(true, false);

    // 2. Recalcular a posição do ponto de toque de B após a rotação
    //    (o worldPoint de B estava antes da rotação, então recalculamos via bbox)
    const bboxB = new THREE.Box3().setFromObject(meshB);
    const centerB = new THREE.Vector3(); bboxB.getCenter(centerB);

    // 3. Mover B de modo que a face de B toque na face de A
    //    A face de A está no plano: normal·(x – faceA.worldPoint) = 0
    //    Queremos que o extremo de B na direção de targetNormal toque esse plano
    //    a. Distância do centro de B ao plano de A:
    const distToPlane = faceA.worldNormal.dot(faceA.worldPoint.clone().sub(centerB));
    //    b. Metade da extensão de B nessa direção (extent)
    const sizeB = new THREE.Vector3(); bboxB.getSize(sizeB);
    const halfExtent = Math.abs(faceA.worldNormal.dot(sizeB)) / 2;
    //    c. Translation necessária para encostar as faces
    const translation = distToPlane - halfExtent;
    meshB.position.addScaledVector(faceA.worldNormal, translation);

    // 4. Centralizar B no centro de A (dentro do plano)
    meshB.updateWorldMatrix(true, false);
    const bboxAfter = new THREE.Box3().setFromObject(meshB);
    const newCenterB = new THREE.Vector3(); bboxAfter.getCenter(newCenterB);
    const bboxA = new THREE.Box3().setFromObject(meshA);
    const centerA = new THREE.Vector3(); bboxA.getCenter(centerA);
    // Projetar o deslocamento centerA→newCenterB no plano da face (remover componente normal)
    const lateralDiff = centerA.clone().sub(newCenterB);
    const normalComp = faceA.worldNormal.clone().multiplyScalar(lateralDiff.dot(faceA.worldNormal));
    lateralDiff.sub(normalComp); // remove componente na direção normal
    meshB.position.add(lateralDiff);
  }

  persistTransform(faceB.shapeId, meshB);
}

btnFaceSnap.addEventListener('click', () => {
  faceSnapActive = !faceSnapActive;
  firstFacePick  = null;
  btnFaceSnap.classList.toggle('active', faceSnapActive);
  btnFaceSnap.textContent = faceSnapActive ? '🧲 Cancelar' : '🧲 Face Snap';
  setSnapStatus(faceSnapActive ? 'Clique na face do objeto A' : '', faceSnapActive);
  if (!faceSnapActive) clearHoverHighlight();
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
    // Testa planos de grid primeiro (podem ser usados como face A ou B)
    const gridHitsPu = _clickRay.intersectObjects(originPlanes, false);
    if (gridHitsPu.length > 0) {
      const gHit = gridHitsPu[0];
      const planeIdx = originPlanes.indexOf(gHit.object as THREE.Mesh);
      const gridNormals = [new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1), new THREE.Vector3(1,0,0)];
      const gNormal = gridNormals[planeIdx] ?? new THREE.Vector3(0,1,0);
      const gridFace: FacePick = {
        shapeId: -1, worldPoint: gHit.point.clone(), worldNormal: gNormal
      };
      if (!firstFacePick) {
        firstFacePick = gridFace;
        setSnapStatus('Clique na face do objeto B');
      } else if (firstFacePick.shapeId !== -1) {
        // faceA é um objeto 3D, faceB é um plano de grid
        const meshA2 = shapeMap.get(firstFacePick.shapeId)!;
        // Apenas translação: move A para tocar no plano do grid
        const bboxA2 = new THREE.Box3().setFromObject(meshA2);
        const cA2 = new THREE.Vector3(); bboxA2.getCenter(cA2);
        const distA2 = gNormal.dot(gHit.point.clone().sub(cA2));
        const sizeA2 = new THREE.Vector3(); bboxA2.getSize(sizeA2);
        const halfA2 = Math.abs(gNormal.dot(sizeA2)) / 2;
        meshA2.position.addScaledVector(gNormal, distA2 + halfA2);
        persistTransform(firstFacePick.shapeId, meshA2);
        clearFaceHighlight();
        faceSnapActive = false; firstFacePick = null;
        btnFaceSnap.classList.remove('active');
        btnFaceSnap.textContent = '🧲 Face Snap';
        setSnapStatus('', false);
        clearHoverHighlight();
      }
      return;
    }
    const worldNormal = hit.face!.normal.clone()
      .transformDirection(hitMesh.matrixWorld).normalize();
    if (!firstFacePick) {
      firstFacePick = { shapeId: hitId, worldPoint: hit.point.clone(), worldNormal };
      highlightFace(hit); // destaca a face A em roxo
      setSnapStatus('Clique na face do objeto B');
    } else if (hitId !== firstFacePick.shapeId) {
      const faceB = { shapeId: hitId, worldPoint: hit.point.clone(), worldNormal };
      applyFaceSnap(firstFacePick, faceB);
      clearFaceHighlight(); clearHoverHighlight();
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
    // Com Shift: adiciona à seleção booleana (A/B)
    if (e.shiftKey) {
      addToSelection(hitId);
    } else {
      clearBoolSelection();
      selectShape(hitId);
    }
  }
});

// Click no fundo (sem objecto) → deseleciona tudo
renderer.domElement.addEventListener('click', (e: MouseEvent) => {
  const dx = e.clientX - _pointerDownXY.x;
  const dy = e.clientY - _pointerDownXY.y;
  if (dx * dx + dy * dy > 25) return; // foi drag
  const cm2 = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  _clickRay.setFromCamera(cm2, camera);
  if (_clickRay.intersectObjects([...shapeMap.values()], false).length === 0) {
    clearBoolSelection();
    deselectAll();
  }
});

// ─── Hover face highlight durante faceSnap ────────────────────────────────────
let _hoverHighlightMesh: THREE.Mesh | null = null;

function clearHoverHighlight(): void {
  if (!_hoverHighlightMesh) return;
  scene.remove(_hoverHighlightMesh);
  _hoverHighlightMesh.geometry.dispose();
  (_hoverHighlightMesh.material as THREE.Material).dispose();
  _hoverHighlightMesh = null;
}

function showHoverHighlight(hit: THREE.Intersection, isGridPlane = false): void {
  clearHoverHighlight();
  if (isGridPlane) {
    // Simples quad para o plano do grid
    const geo = new THREE.PlaneGeometry(60, 60);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24, transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide,
    });
    _hoverHighlightMesh = new THREE.Mesh(geo, mat);
    _hoverHighlightMesh.position.copy((hit.object as THREE.Mesh).position);
    _hoverHighlightMesh.quaternion.copy((hit.object as THREE.Mesh).quaternion);
    scene.add(_hoverHighlightMesh);
    return;
  }
  if (!hit.face) return;
  const src = hit.object as THREE.Mesh;
  const geo = src.geometry as THREE.BufferGeometry;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const idxAttr = geo.getIndex();
  const worldNormal = hit.face.normal.clone().transformDirection(src.matrixWorld).normalize();
  const d = worldNormal.dot(hit.point);
  const EPS = 0.01;
  const faceVerts: number[] = [];
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ia = idxAttr ? idxAttr.getX(t*3) : t*3;
    const ib = idxAttr ? idxAttr.getX(t*3+1) : t*3+1;
    const ic = idxAttr ? idxAttr.getX(t*3+2) : t*3+2;
    tA.fromBufferAttribute(posAttr, ia).applyMatrix4(src.matrixWorld);
    tB.fromBufferAttribute(posAttr, ib).applyMatrix4(src.matrixWorld);
    tC.fromBufferAttribute(posAttr, ic).applyMatrix4(src.matrixWorld);
    const e1 = tB.clone().sub(tA), e2 = tC.clone().sub(tA);
    const tn = e1.cross(e2).normalize();
    if (Math.abs(tn.dot(worldNormal)) > 1-EPS && Math.abs(worldNormal.dot(tA)-d) < EPS) {
      faceVerts.push(tA.x,tA.y,tA.z, tB.x,tB.y,tB.z, tC.x,tC.y,tC.z);
    }
  }
  if (!faceVerts.length) return;
  const hlGeo = new THREE.BufferGeometry();
  hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faceVerts), 3));
  const hlMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24, transparent: true, opacity: 0.3, depthTest: false, side: THREE.DoubleSide,
  });
  _hoverHighlightMesh = new THREE.Mesh(hlGeo, hlMat);
  _hoverHighlightMesh.position.addScaledVector(worldNormal, 0.5);
  scene.add(_hoverHighlightMesh);
}

renderer.domElement.addEventListener('mousemove', (e: MouseEvent) => {
  if (!faceSnapActive) { clearHoverHighlight(); return; }
  const cm = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  _clickRay.setFromCamera(cm, camera);
  // Verifica planos de grid primeiro
  const gridHits = _clickRay.intersectObjects(originPlanes, false);
  if (gridHits.length > 0) {
    showHoverHighlight(gridHits[0], true);
    return;
  }
  const meshHits = _clickRay.intersectObjects([...shapeMap.values()], false);
  if (meshHits.length > 0 && meshHits[0].face) showHoverHighlight(meshHits[0]);
  else clearHoverHighlight();
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

// ─── Grid toggle button ───────────────────────────────────────────────────────
const btnGridToggle = document.getElementById('btn-grid-toggle') as HTMLButtonElement;
const gridConfigEl  = document.getElementById('grid-config')     as HTMLDivElement;
btnGridToggle.addEventListener('click', () => {
  const open = gridConfigEl.style.display !== 'none';
  gridConfigEl.style.display = open ? 'none' : 'flex';
  btnGridToggle.textContent  = open ? '⊞ Grid' : '⊟ Grid';
  btnGridToggle.style.color  = open ? '' : '#6ee7f7';
});

// ─── Reset de transformação (botão ↩ 0 no TIB) ───────────────────────────────
function resetTransform(): void {
  if (selectedShapeId === null) return;
  const mesh = shapeMap.get(selectedShapeId)!;
  const mode = pendingTcMode;
  if (mode === 'translate') {
    mesh.position.set(0, 0, 0);
  } else if (mode === 'rotate') {
    mesh.rotation.set(0, 0, 0);
  } else {
    const orig = originalScales.get(selectedShapeId);
    if (orig) mesh.scale.copy(orig);
    else mesh.scale.set(1, 1, 1);
  }
  persistTransform(selectedShapeId, mesh);
  tibTyped = false;
  tibInput.value = '0';
}
tibReset.addEventListener('click', (e) => { e.stopPropagation(); resetTransform(); });

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

/** Ícones e labels por tipo de primitiva */
const PRIM_ICONS: Record<string, string> = { box:'📦', cylinder:'🔵', sphere:'⚽', cone:'🔺' };
let _lastPrimLabel = 'Shape'; // definido antes de spawnMesh ser chamado

/** Adiciona (ou substitui) um shape no Map e na cena. */
function spawnMesh(result: ShapeMesh, label?: string, icon?: string): void {
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
  originalScales.set(result.shape_id, mesh.scale.clone()); // guarda escala original
  cadStore.setMatrix(result.shape_id, IDENTITY); // regista no histórico

  // ── Árvore de cena + Histórico ──────────────────────────────────────────────
  const itemIcon  = icon  ?? PRIM_ICONS[activePrim] ?? '📦';
  const itemLabel = label ?? _lastPrimLabel ?? 'Shape';
  if (!existing) {
    sceneAddShape(result.shape_id, itemLabel, itemIcon);
  }

  // Seleciona o shape recém-criado no TransformControls
  selectedShapeId = result.shape_id;
  (getTC() as any).attach(mesh);

  // Sincroniza seleção na árvore
  const stNode = sceneGetByShapeId(result.shape_id);
  if (stNode) {
    document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
    document.querySelector(`[data-node-id="${stNode.id}"]`)?.classList.add('selected');
  }

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
    let label = 'Shape';
    switch (activePrim) {
      case 'box': {
        const width = toMM(getNum('box-w')), height = toMM(getNum('box-h')), depth = toMM(getNum('box-d'));
        if ([width, height, depth].some(v => isNaN(v) || v <= 0))
          throw new Error('W/H/D devem ser > 0');
        result = await invoke<ShapeMesh>('create_box', { width, height, depth });
        label = `Caixa ${getNum('box-w')}×${getNum('box-h')}×${getNum('box-d')}`;
        historyAdd('box', label, result.shape_id, { W: getNum('box-w'), H: getNum('box-h'), D: getNum('box-d') });
        break;
      }
      case 'cylinder': {
        const radius = toMM(getNum('cyl-r')), height = toMM(getNum('cyl-h'));
        if (radius <= 0 || height <= 0) throw new Error('Radius/Height > 0');
        result = await invoke<ShapeMesh>('create_cylinder', { radius, height });
        label = `Cilindro R${getNum('cyl-r')} H${getNum('cyl-h')}`;
        historyAdd('cylinder', label, result.shape_id, { R: getNum('cyl-r'), H: getNum('cyl-h') });
        break;
      }
      case 'sphere': {
        const radius = toMM(getNum('sph-r'));
        if (radius <= 0) throw new Error('Radius > 0');
        result = await invoke<ShapeMesh>('create_sphere', { radius });
        label = `Esfera R${getNum('sph-r')}`;
        historyAdd('sphere', label, result.shape_id, { R: getNum('sph-r') });
        break;
      }
      case 'cone': {
        const radiusBottom = toMM(getNum('cone-rb'));
        const radiusTop    = toMM(getNum('cone-rt'));
        const height       = toMM(getNum('cone-h'));
        if (radiusBottom <= 0 || height <= 0)
          throw new Error('R Bottom/Height > 0 (R Top pode ser 0)');
        result = await invoke<ShapeMesh>('create_cone', { radiusBottom, radiusTop, height });
        label = `Cone Rb${getNum('cone-rb')} Rt${getNum('cone-rt')} H${getNum('cone-h')}`;
        historyAdd('cone', label, result.shape_id, { Rb: getNum('cone-rb'), Rt: getNum('cone-rt'), H: getNum('cone-h') });
        break;
      }
      default:
        throw new Error(`Primitiva desconhecida: ${activePrim}`);
    }
    _lastPrimLabel = label;
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

// ─── Painel Direito — Toggle + Abas ─────────────────────────────────────────
const _histPanel = document.getElementById('history-panel') as HTMLElement | null;
const _histTab   = document.getElementById('history-tab')   as HTMLButtonElement | null;

function toggleHistPanel(open?: boolean): void {
  if (!_histPanel) return;
  const isOpen    = _histPanel.classList.contains('open');
  const shouldOpen = open ?? !isOpen;
  _histPanel.classList.toggle('open', shouldOpen);
  if (_histTab) _histTab.style.right = shouldOpen ? '260px' : '0';
}

_histTab?.addEventListener('click', () => toggleHistPanel());
document.getElementById('history-close')?.addEventListener('click', () => toggleHistPanel(false));

// Abas: Cena / Histórico
document.querySelectorAll('.hist-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLElement).dataset.tab;
    document.querySelectorAll('.hist-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.hist-tab-content').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    if (tab === 'hist') _renderHistory();
    if (tab === 'scene') renderSceneTree();
  });
});

// Árvore: callbacks
setSceneCallbacks(
  node => { if (node.shapeId != null) selectShape(node.shapeId); },
  node => { if (node.shapeId != null) { selectedShapeId = node.shapeId; deleteSelected(); } },
  (_node, _name) => { /* renomeio já tratado internamente */ },
);

// Árvore: Nova Pasta
document.getElementById('st-new-folder')?.addEventListener('click', () => sceneAddFolder());
// Árvore: Renomear selecionado
document.getElementById('st-rename')?.addEventListener('click', () => {
  const node = sceneGetByShapeId(selectedShapeId ?? -1);
  if (!node) return;
  // Simula double-click forçando o modo de edição
  const el = document.querySelector(`[data-node-id="${node.id}"] .tree-item-name`) as HTMLElement | null;
  el?.dispatchEvent(new MouseEvent('dblclick'));
});
// Árvore: Delete selecionado
document.getElementById('st-delete-sel')?.addEventListener('click', () => deleteSelected());

// Histórico: Limpar
document.getElementById('history-clear')?.addEventListener('click', () => { historyClear(); });

// ─── Ctrl+C / Ctrl+V (Clone) ─────────────────────────────────────────────────
let _copiedShapeId: number | null = null;

window.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'c' && selectedShapeId !== null) {
    _copiedShapeId = selectedShapeId;
    console.log('[CAD] Copiado shape', _copiedShapeId);
    e.preventDefault();
  } else if (e.key === 'v' && _copiedShapeId !== null) {
    e.preventDefault();
    try {
      const result = await invoke<ShapeMesh>('clone_shape', { shapeId: _copiedShapeId });
      _lastPrimLabel = (sceneGetByShapeId(_copiedShapeId)?.name ?? 'Shape') + ' (cópia)';
      spawnMesh(result, _lastPrimLabel, '⧉');
      // Deslocamento leve para não sobrepor
      const mesh = shapeMap.get(result.shape_id);
      if (mesh) { mesh.position.x += 20; mesh.position.z += 20; persistTransform(result.shape_id, mesh); }
      historyAdd('clone', _lastPrimLabel, result.shape_id, { de: _copiedShapeId });
    } catch (err) { showError(`Clone falhou: ${err instanceof Error ? err.message : String(err)}`); }
  }
});

// ─── Salvar / Abrir Projeto ──────────────────────────────────────────────────
document.getElementById('btn-save-project')?.addEventListener('click', async () => {
  try {
    const data = JSON.stringify({ version: 1, matrices: cadStore.getMatrices() }, null, 2);
    // Download direto no browser (funciona sem plugin)
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'projeto.cadproj'; a.click();
    URL.revokeObjectURL(url);
    console.log('[CAD] Projeto salvo via download');
  } catch (err) { showError(`Salvar falhou: ${err}`); }
});

document.getElementById('btn-open-project')?.addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.cadproj,application/json';
  inp.onchange = async () => {
    const file = inp.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const proj = JSON.parse(text);
      console.log('[CAD] Projeto aberto:', proj);
      // TODO: restaurar shapes do projeto (Fase 3.1 DAG)
      showError('Abrir projeto: suporte completo na Fase 3.1 (DAG). Matrizes carregadas.');
    } catch (err) { showError(`Abrir falhou: ${err}`); }
  };
  inp.click();
});

// ─── Export STL ──────────────────────────────────────────────────────────────
document.getElementById('btn-export-stl')?.addEventListener('click', async () => {
  if (selectedShapeId === null) { showError('Selecione um shape para exportar STL'); return; }
  try {
    const path = prompt('Caminho para salvar STL (ex: C:/minha-peca.stl):');
    if (!path?.trim()) return;
    await invoke('export_stl', { shapeId: selectedShapeId, path: path.trim() });
    console.log('[CAD] STL exportado:', path);
  } catch (err) { showError(`Export STL: ${err instanceof Error ? err.message : String(err)}`); }
});

// ─── Export STEP ─────────────────────────────────────────────────────────────
document.getElementById('btn-export-step')?.addEventListener('click', async () => {
  if (selectedShapeId === null) { showError('Selecione um shape para exportar STEP'); return; }
  try {
    const path = prompt('Caminho para salvar STEP (ex: C:/minha-peca.step):');
    if (!path?.trim()) return;
    await invoke('export_step', { shapeId: selectedShapeId, path: path.trim() });
    console.log('[CAD] STEP exportado:', path);
  } catch (err) { showError(`Export STEP: ${err instanceof Error ? err.message : String(err)}`); }
});

// ─── Param Editor — Fase 3.1 DAG ─────────────────────────────────────────────
const _paramEditor = new ParamEditor('param-editor', (updatedMeshes) => {
  // Callback: recebe lista de {shape_id, mesh} re-avaliados pelo Rust e atualiza Three.js
  for (const sm of updatedMeshes) {
    const mesh = shapeMap.get(sm.shape_id);
    if (mesh) {
      updateGeometry(mesh, sm.mesh);
    } else {
      // Shape novo (dependente que criou novo ID) — adiciona à cena
      spawnMesh({ shape_id: sm.shape_id, mesh: sm.mesh });
    }
  }
  renderSceneTree();
});

// Duplo-clique num item da Árvore de Cena abre o editor de parâmetros
document.getElementById('scene-tree')?.addEventListener('dblclick', async (e) => {
  const li = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
  if (!li) return;
  const nodeEl = li.dataset.nodeId;
  if (!nodeEl) return;

  // Busca o node da cena para obter o shapeId
  const sceneNode = document.querySelector(`[data-node-id="${nodeEl}"]`) as HTMLElement | null;
  const shapeIdStr = sceneNode?.dataset.shapeId;
  if (!shapeIdStr) return;
  const shapeId = parseInt(shapeIdStr, 10);

  // Busca o nó no DAG do Rust via get_graph
  try {
    const graph = await invoke<{ nodes: { id: number; label: string; shape_id: number | null; op: { type: string } & Record<string, number> }[]; edges: unknown[] }>('get_graph');
    const dagNode = graph.nodes.find(n => n.shape_id === shapeId);
    if (!dagNode) { showError('Nó não encontrado no DAG'); return; }

    const opType = dagNode.op.type;
    const currentParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(dagNode.op)) {
      if (k !== 'type' && typeof v === 'number') currentParams[k] = v;
    }

    _paramEditor.open(dagNode.id, opType, currentParams, dagNode.label);
  } catch (err) {
    showError(`get_graph: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ─── Edge Selector — Fillet/Chamfer por Aresta ───────────────────────────────


const _edgeSelector = new EdgeSelector(
  scene, camera,
  renderer.domElement,
  'param-editor',
  ({ shapeMesh }) => {
    const oldMesh = shapeMap.get(shapeMesh.shape_id);
    if (oldMesh) {
      // ★ applyWorldSpaceGeo: normaliza coords world-space + reposiciona gizmo
      applyWorldSpaceGeo(shapeMesh.shape_id, oldMesh, shapeMesh.mesh.vertices, shapeMesh.mesh.indices);
    } else {
      spawnMesh({ shape_id: shapeMesh.shape_id, mesh: shapeMesh.mesh });
    }
    renderSceneTree();
  },

  () => { /* cancelado — sem ação */ }
);

// \u2500\u2500\u2500 Undo / Redo (Op\u00e7\u00e3o B \u2014 backend C++ stack) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

async function applyUndoRedoMesh(result: { shape_id: number; mesh: { vertices: number[]; indices: number[] } }): Promise<void> {
  const mesh = shapeMap.get(result.shape_id);
  if (!mesh) return;
  // ★ applyWorldSpaceGeo: normaliza coords + gizmo
  applyWorldSpaceGeo(result.shape_id, mesh, result.mesh.vertices, result.mesh.indices);
}

document.addEventListener('keydown', async (e: KeyboardEvent) => {
  // Ctrl+Z → Undo
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
    if (selectedShapeId === null) return;
    e.preventDefault();
    try {
      const result = await invoke<{ shape_id: number; mesh: { vertices: number[]; indices: number[] } }>(
        'undo_shape', { shapeId: selectedShapeId }
      );
      await applyUndoRedoMesh(result);
      console.log('[Undo] shape', selectedShapeId);
    } catch (err) {
      console.log('[Undo] Nada a desfazer ou falhou:', err);
    }
    return;
  }
  // Ctrl+Y ou Ctrl+Shift+Z → Redo
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    if (selectedShapeId === null) return;
    e.preventDefault();
    try {
      const result = await invoke<{ shape_id: number; mesh: { vertices: number[]; indices: number[] } }>(
        'redo_shape', { shapeId: selectedShapeId }
      );
      await applyUndoRedoMesh(result);
      console.log('[Redo] shape', selectedShapeId);
    } catch (err) {
      console.log('[Redo] Nada a refazer ou falhou:', err);
    }
  }
});




document.getElementById('btn-fillet-edges')?.addEventListener('click', () => {
  if (selectedShapeId === null) { showError('Selecione um shape primeiro'); return; }
  if (_edgeSelector.isActive()) return;
  _edgeSelector.enter(selectedShapeId, 'fillet', shapeMap.get(selectedShapeId));
});

document.getElementById('btn-chamfer-edges')?.addEventListener('click', () => {
  if (selectedShapeId === null) { showError('Selecione um shape primeiro'); return; }
  if (_edgeSelector.isActive()) return;
  _edgeSelector.enter(selectedShapeId, 'chamfer', shapeMap.get(selectedShapeId));
});

// ── Fase 4: Workplane + Sketch 2D ──────────────────────────────────────────
const _workplane = new WorkplaneManager(scene);
const _sketch = new SketchCanvas(
  'sk-svg-overlay',
  'sketch-panel',
  _workplane,
  camera,
  renderer,
  (result) => {
    // Callback ao aplicar Extrude / Revolve: insere o novo shape na cena
    const { shape_id, mesh } = result;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1)); // ← fix: BufferAttribute
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6ee7f7, metalness: 0.3, roughness: 0.5 });
    const meshObj = new THREE.Mesh(geo, mat);
    meshObj.userData['shapeId'] = shape_id;
    scene.add(meshObj);
    shapeMap.set(shape_id, meshObj);
    cadStore.setMatrix(shape_id, IDENTITY.slice());   // ← fix: setMatrix, not set
    historyAdd('clone', `Sketch Extrude #${shape_id}`, shape_id); // ← fix: valid HistOpType + correct arg order
    sceneAddShape(shape_id, `Sketch #${shape_id}`, '✏');          // ← fix: icon string, not meshObj
    console.log('[Sketch] Novo shape:', shape_id);
  }
);

document.getElementById('btn-start-sketch')?.addEventListener('click', async () => {
  // Precisa de um shape selecionado. Se houver face via raycasting, usaremos ela.
  if (selectedShapeId === null) { showError('Selecione um shape primeiro'); return; }
  // Usa face 0 como padrão (pode ser refinado para face selecionada depois)
  const defaultFaceIndex = 0;
  const planeInfo = await _workplane.activate(selectedShapeId, defaultFaceIndex);
  if (!planeInfo) { showError('Falha ao detectar o plano da face'); return; }
  _sketch.show();
  console.log('[Sketch] Workplane ativo:', planeInfo);
});

renderer.autoClear = false; // clear manual para compatibilidade com scissor
(function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.setClearColor(_lightTheme ? 0xe8ecf0 : 0x0f1012, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  updateInfoPanel();
  updateOriginPlanes();
  renderViewCube();
})();
