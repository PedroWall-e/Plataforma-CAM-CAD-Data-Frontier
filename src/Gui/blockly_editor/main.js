/**
 * main.js — Módulo ES (type="module")
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsabilidades:
 *   1. Inicializar workspace Blockly com tema dark.
 *   2. Em cada mudança de bloco → transpilador gera Python → painel de código.
 *   3. Debounce de 500ms → fetch POST /generate → servidor executa build123d.
 *   4. STLLoader carrega a resposta binária → THREE.Mesh na cena 3D.
 *
 * SEPARAÇÃO App / Gui (AI_INSTRUCTIONS.md §2):
 *   - Este arquivo é 100% GUI: renderiza pixels, não computa matemática.
 *   - Todo B-Rep é gerado em src/App/server/main.py (headless, no servidor).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

/* global Blockly, generatePythonFromWorkspace */

const SERVER_URL = "http://localhost:8000";
const DEBOUNCE_MS = 500;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tema Blockly (dark)
// ─────────────────────────────────────────────────────────────────────────────
const CAD_THEME = Blockly.Theme.defineTheme("cad_dark", {
    base: Blockly.Themes.Classic,
    componentStyles: {
        workspaceBackgroundColour: "#0c1019",
        toolboxBackgroundColour: "#161b27",
        toolboxForegroundColour: "#e2e8f0",
        flyoutBackgroundColour: "#161b27",
        flyoutForegroundColour: "#e2e8f0",
        flyoutOpacity: 0.95,
        scrollbarColour: "#2d3748",
        insertionMarkerColour: "#3d7fff",
        cursorColour: "#3d7fff",
    },
    fontStyle: { family: "'Inter', sans-serif", weight: "500", size: 13 },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Inicializar Blockly
// ─────────────────────────────────────────────────────────────────────────────
const workspace = Blockly.inject("blockly-canvas", {
    toolbox: document.getElementById("toolbox"),
    theme: CAD_THEME,
    renderer: "zelos",
    grid: { spacing: 24, length: 3, colour: "rgba(255,255,255,0.04)", snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 3, minScale: 0.3 },
    trashcan: true,
    move: { scrollbars: { horizontal: true, vertical: true }, drag: true, wheel: true },
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Three.js — Cena 3D
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("viewer-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setClearColor(0x080c12, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x080c12, 80, 200);

// Câmera
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(60, 50, 90);

// Luzes
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(50, 80, 50);
dirLight.castShadow = true;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x3d7fff, 0.5);
rimLight.position.set(-40, -20, -60);
scene.add(rimLight);

// Grid decorativo
const gridHelper = new THREE.GridHelper(120, 24, 0x1e2535, 0x161b27);
scene.add(gridHelper);

// Controles de órbita
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;
controls.minDistance = 5;
controls.maxDistance = 400;

// ── Resize automático ─────────────────────────────────────────────────────
function resizeViewer() {
    const parent = canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resizeViewer).observe(canvas.parentElement);
resizeViewer();

// ── Loop de renderização ──────────────────────────────────────────────────
(function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
})();

// ─────────────────────────────────────────────────────────────────────────────
// 4. STLLoader — carregar malha na cena
// ─────────────────────────────────────────────────────────────────────────────
const stlLoader = new STLLoader();
let currentMesh = null;

/** Material CAD — superfície metálica escura com wireframe sutil */
const CAD_MATERIAL = new THREE.MeshPhysicalMaterial({
    color: 0x4a9eff,
    metalness: 0.3,
    roughness: 0.45,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
});

/**
 * Carrega geometria STL de um ArrayBuffer e exibe na cena.
 * Remove o mesh anterior automaticamente.
 * @param {ArrayBuffer} buffer
 */
function loadSTLBuffer(buffer) {
    // Remover mesh anterior
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        currentMesh = null;
    }

    const geometry = stlLoader.parse(buffer);
    geometry.computeVertexNormals();
    geometry.center();

    // Auto-escala: normalizar para caber bem na câmera
    const box = new THREE.Box3().setFromObject(new THREE.Mesh(geometry));
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 40 / maxDim : 1;

    currentMesh = new THREE.Mesh(geometry, CAD_MATERIAL);
    currentMesh.scale.setScalar(scale);
    currentMesh.castShadow = true;
    currentMesh.receiveShadow = true;
    scene.add(currentMesh);

    // Reposicionar câmera
    camera.position.set(60, 45, 80);
    controls.target.set(0, 0, 0);
    controls.update();

    // Atualizar contador de triângulos
    const tris = geometry.index
        ? geometry.index.count / 3
        : geometry.attributes.position.count / 3;
    setViewerStatus(`${Math.round(tris).toLocaleString("pt-BR")} triângulos`, "ok");
    document.getElementById("triangle-count").textContent =
        `${Math.round(tris).toLocaleString("pt-BR")} △`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Comunicação com o servidor /generate
// ─────────────────────────────────────────────────────────────────────────────
const spinner = document.getElementById("render-spinner");

async function sendCodeToServer(pythonCode) {
    spinner.classList.add("visible");
    setViewerStatus("Gerando B-Rep…", "loading");

    try {
        const res = await fetch(`${SERVER_URL}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: pythonCode }),
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(errJson.detail ?? res.statusText);
        }

        const buffer = await res.arrayBuffer();
        loadSTLBuffer(buffer);

    } catch (err) {
        setViewerStatus(`Erro: ${err.message}`, "error");
        console.error("[3D Viewer]", err);
    } finally {
        spinner.classList.remove("visible");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Verificação de saúde do servidor
// ─────────────────────────────────────────────────────────────────────────────
const dotEl = document.getElementById("server-dot");
const labelEl = document.getElementById("server-label");

async function checkServerHealth() {
    dotEl.className = "dot pending";
    labelEl.textContent = "Conectando…";
    try {
        const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
            dotEl.className = "dot online";
            labelEl.textContent = `Servidor online · port 8000`;
            return true;
        }
        throw new Error(`HTTP ${res.status}`);
    } catch {
        dotEl.className = "dot offline";
        labelEl.textContent = "Servidor offline — rode: uvicorn src.App.server.main:app --reload";
        return false;
    }
}

// Checar na carga e a cada 10s
checkServerHealth();
setInterval(checkServerHealth, 10_000);

// ─────────────────────────────────────────────────────────────────────────────
// 7. Debounce + listener Blockly
// ─────────────────────────────────────────────────────────────────────────────
const codeOutput = document.getElementById("code-output");
const statusCode = document.getElementById("status-code");

let debounceTimer = null;

function setCodeStatus(msg, cls) {
    statusCode.textContent = msg;
    statusCode.className = cls;
}

function setViewerStatus(msg, cls) {
    const el = document.getElementById("viewer-status");
    el.textContent = msg;
    el.className = cls;
}

const IGNORED_EVENTS = new Set([
    Blockly.Events.VIEWPORT_CHANGE,
    Blockly.Events.TOOLBOX_ITEM_SELECT,
    Blockly.Events.THEME_CHANGE,
]);

workspace.addChangeListener((event) => {
    if (IGNORED_EVENTS.has(event.type)) return;

    // ── Transpilação imediata → painel de código ──────────────────────────
    let python = "";
    try {
        python = generatePythonFromWorkspace(workspace);
        codeOutput.value = python;
        const n = workspace.getAllBlocks(false).length;
        setCodeStatus(n > 0 ? `${n} blocos · Python OK` : "Aguardando…", n > 0 ? "ok" : "");
    } catch (err) {
        codeOutput.value = `# [ERRO]\n# ${err.message}`;
        setCodeStatus("Erro de transpilação", "error");
        return;
    }

    // ── Debounce → enviar ao servidor ─────────────────────────────────────
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const hasBlocks = workspace.getAllBlocks(false).length > 0;
        if (hasBlocks && python.trim()) {
            sendCodeToServer(python);
        }
    }, DEBOUNCE_MS);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Botões
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("btn-clear").addEventListener("click", () => {
    if (!workspace.getAllBlocks(false).length) return;
    if (confirm("Limpar todos os blocos?")) {
        workspace.clear();
        codeOutput.value = "";
        setCodeStatus("Workspace limpa.", "");
    }
});

document.getElementById("btn-copy").addEventListener("click", async () => {
    if (!codeOutput.value.trim()) return;
    await navigator.clipboard.writeText(codeOutput.value).catch(() => {
        codeOutput.select(); document.execCommand("copy");
    });
    const btn = document.getElementById("btn-copy");
    const orig = btn.textContent;
    btn.textContent = "✅ Copiado!"; btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
});

document.getElementById("btn-generate").addEventListener("click", () => {
    const code = codeOutput.value;
    if (code.trim()) sendCodeToServer(code);
});

// Blockly resize
new ResizeObserver(() => Blockly.svgResize(workspace))
    .observe(document.getElementById("blockly-canvas"));

console.info("[main.js] CAD Editor M11-M12 iniciado.");
