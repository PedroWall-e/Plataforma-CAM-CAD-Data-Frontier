// src/main.ts — CAD MVP Phase 2
// Import ESTÁTICO (mesma instância THREE) + lazy new TransformControls

import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { invoke }           from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeshData  { vertices: number[]; indices: number[]; }
interface ShapeMesh { shape_id: number;   mesh: MeshData;    }
type PrimType = 'box' | 'cylinder' | 'sphere' | 'cone';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const viewport = document.getElementById('viewport')!;
const statsEl  = document.getElementById('stats')!;
const errorLog = document.getElementById('error-log')!;
const btnEl    = document.getElementById('btn') as HTMLButtonElement;

function showError(msg: string) {
  errorLog.textContent = `⚠ ${msg}`;
  errorLog.style.display = 'block';
  console.error('[CAD]', msg);
}
function clearError() { errorLog.style.display = 'none'; }

// ─── Three.js Scene ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1012);
scene.add(new THREE.GridHelper(200, 20, 0x445566, 0x334455));

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

// TransformControls — import estático (mesma instância THREE), lazy new
// NÃO instanciado aqui: só quando o primeiro mesh aparecer → sem erro Object3D
let tc: TransformControls | null = null;
let pendingTcMode = 'translate';

function getTC(): TransformControls {
  if (!tc) {
    tc = new TransformControls(camera, renderer.domElement);
    tc.setMode(pendingTcMode as 'translate' | 'rotate' | 'scale');
    // r169+: TC extends Controls, not Object3D → adiciona o _root
    const tcRoot = (tc as any).getHelper?.() ?? (tc as any)._root;
    if (tcRoot) scene.add(tcRoot);
    tc.addEventListener('dragging-changed', (e: any) => { orbit.enabled = !e.value; });
    // Transforms são visuais-only por agora (sem chamada backend no mouseUp)
  }
  return tc;
}

// Render loop
(function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
})();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─── State ────────────────────────────────────────────────────────────────────
let activePrim: PrimType = 'box';
let currentShapeId: number | null = null;
let cadMesh: THREE.Mesh | null = null;

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

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function setStats(id: number, data: MeshData) {
  const tris  = data.indices.length  / 3;
  const verts = data.vertices.length / 3;
  statsEl.textContent = `ID:${id} · Verts: ${verts.toLocaleString()} · Tris: ${tris.toLocaleString()}`;
}

function updateGeometry(mesh: THREE.Mesh, data: MeshData) {
  const geo = mesh.geometry;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertices), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
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

function spawnMesh(result: ShapeMesh) {
  if (cadMesh) {
    tc?.detach();
    cadMesh.geometry.dispose();
    (cadMesh.material as THREE.Material).dispose();
    scene.remove(cadMesh);
  }
  currentShapeId = result.shape_id;
  cadMesh = buildMesh(result.mesh);
  cadMesh.name = 'cad_mesh';
  cadMesh.castShadow = true;
  cadMesh.receiveShadow = true;
  scene.add(cadMesh);
  (getTC() as any).attach(cadMesh);
  setStats(result.shape_id, result.mesh);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
function getNum(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement).value);
}

async function loadModel(): Promise<void> {
  clearError();
  btnEl.disabled = true;
  btnEl.textContent = 'Generating…';
  statsEl.textContent = 'Chamando OCCT…';
  try {
    let result: ShapeMesh;
    switch (activePrim) {
      case 'box': {
        const width = getNum('box-w'), height = getNum('box-h'), depth = getNum('box-d');
        if ([width, height, depth].some(v => isNaN(v) || v <= 0))
          throw new Error('W/H/D devem ser > 0');
        result = await invoke<ShapeMesh>('create_box', { width, height, depth });
        break;
      }
      case 'cylinder': {
        const radius = getNum('cyl-r'), height = getNum('cyl-h');
        if (radius <= 0 || height <= 0) throw new Error('Radius/Height > 0');
        result = await invoke<ShapeMesh>('create_cylinder', { radius, height });
        break;
      }
      case 'sphere': {
        const radius = getNum('sph-r');
        if (radius <= 0) throw new Error('Radius > 0');
        result = await invoke<ShapeMesh>('create_sphere', { radius });
        break;
      }
      case 'cone': {
        const radiusBottom = getNum('cone-rb');
        const radiusTop    = getNum('cone-rt');
        const height       = getNum('cone-h');
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
    statsEl.textContent = 'Erro — verifique o log abaixo.';
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Generate';
  }
}

btnEl.addEventListener('click', loadModel);
loadModel();
