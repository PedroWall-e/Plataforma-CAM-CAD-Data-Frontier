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

/**
 * SERVER_URL — detecta automaticamente o ambiente:
 *   • Dev local (localhost / 127.0.0.1 / file://) → uvicorn direto na porta 8000
 *   • Docker (nginx proxy) / qualquer outro host → /api (proxy reverso)
 */
const SERVER_URL = (() => {
    const { hostname, protocol } = window.location;
    const isLocal = protocol === "file:"
        || hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "";
    return isLocal ? "http://localhost:8000" : `${window.location.origin}/api`;
})();

const DEBOUNCE_MS = 500;

console.info(`[main.js] SERVER_URL resolvida: ${SERVER_URL}`);

/** STEP model base64 da última geração IA */
let currentStepBase64 = null;

/** Flag de conectividade — atualizada pelo health check */
let serverOnline = false;

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
    // Não tentar se o servidor estiver offline (evita erros redundantes no loop Blockly)
    if (!serverOnline) {
        setViewerStatus("🔌 Servidor inacessível — reinicie o servidor.", "error");
        return;
    }

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
        const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            dotEl.className = "dot online";
            labelEl.textContent =
                `Servidor online · v${data.version ?? "?"} · · IA: ${data.ai_engine ? "✅" : "⚠ sem chave"}`;
            serverOnline = true;
            return true;
        }
        throw new Error(`HTTP ${res.status}`);
    } catch {
        dotEl.className = "dot offline";
        const cmd = SERVER_URL.includes("localhost")
            ? "uvicorn src.App.server.main:app --reload --port 8000"
            : "docker compose up --build";
        labelEl.textContent = `🔌 Servidor inacessível — rode: ${cmd}`;
        serverOnline = false;
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

// ──────────────────────────────────────────────────────────────────────────────
// 9. AI Chat Panel — M17-M18
// ──────────────────────────────────────────────────────────────────────────────

const aiLog = document.getElementById("ai-log");
const aiPromptEl = document.getElementById("ai-prompt");
const btnAIGen = document.getElementById("btn-ai-generate");

/**
 * Adiciona uma mensagem ao log de chat do painel de IA.
 * @param {"user"|"agent"|"status"} role
 * @param {string} text
 * @returns {HTMLElement} o elemento criado (para atualição posterior)
 */
function addChatMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `ai-msg ai-msg--${role}`;
    msg.innerHTML = `<div class="ai-msg__bubble"></div>`;
    msg.querySelector(".ai-msg__bubble").textContent = text;
    aiLog.appendChild(msg);
    aiLog.scrollTop = aiLog.scrollHeight;
    return msg;
}

/** Fases de status animadas durante a geração IA */
const AI_STATUS_PHASES = [
    "Gerando modelo…",
    "Analisando topologia…",
    "Otimizando B-Rep…",
];

/**
 * Envia o prompt ao endpoint /generate_from_text (Self-Healing Loop).
 * Lê X-Attempts para mostrar quantas tentativas foram necessárias.
 * Carrega o STL retornado no viewer 3D (mesma cena do Blockly).
 *
 * @param {string} promptText - Descrição em linguagem natural
 */
async function sendAIPrompt(promptText) {
    if (!promptText.trim()) return;

    // Bloquear input durante geração
    btnAIGen.disabled = true;
    aiPromptEl.disabled = true;
    btnAIGen.classList.add("loading");

    // Exibir mensagem do usuário no chat
    addChatMessage("user", promptText);

    // Criar bubble de status animate (será atualizada)
    const statusBubble = addChatMessage("status", AI_STATUS_PHASES[0]);
    let phaseIdx = 0;
    const phaseTimer = setInterval(() => {
        phaseIdx = (phaseIdx + 1) % AI_STATUS_PHASES.length;
        statusBubble.querySelector(".ai-msg__bubble").textContent =
            AI_STATUS_PHASES[phaseIdx];
    }, 1400);

    // Spinner no viewer 3D
    spinner.classList.add("visible");
    setViewerStatus("IA gerando…", "loading");

    try {
        const res = await fetch(`${SERVER_URL}/generate_from_text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: promptText }),
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(errJson.detail ?? res.statusText);
        }

        // ── M21-M22: processar JSON rico ──────────────────────────────────────────
        const json = await res.json();

        // a) Decodificar STL base64 → ArrayBuffer → viewer 3D
        try {
            const stlBuffer = _base64ToArrayBuffer(json.stl_base64);
            loadSTLBuffer(stlBuffer);
        } catch (decErr) {
            throw new Error(`Falha ao decodificar STL: ${decErr.message}`);
        }

        // b) Exibir código Python gerado no painel de código
        if (json.python_code) {
            codeOutput.value = json.python_code;
            setCodeStatus(`IA gerou ${json.python_code.split("\n").length} linhas`, "ok");
        }

        // c) Armazenar STEP base64 e habilitar botão de download
        currentStepBase64 = json.step_base64 || null;
        btnDownloadStep.disabled = !currentStepBase64;
        if (currentStepBase64) {
            btnDownloadStep.title = `Baixar modelo STEP gerado em ${json.attempts} tentativa(s)`;
        }

        // Mensagem de sucesso no chat
        clearInterval(phaseTimer);
        statusBubble.querySelector(".ai-msg__bubble").textContent = "";
        const hasStep = currentStepBase64 ? " + STEP" : "";
        addChatMessage(
            "agent",
            `✓ Modelo gerado em ${json.attempts} tentativa${json.attempts > 1 ? "s" : ""
            }! (Self-Healing Loop${hasStep})`
        );

    } catch (err) {
        clearInterval(phaseTimer);
        statusBubble.querySelector(".ai-msg__bubble").textContent = "";
        addChatMessage("agent", `⚠ Erro: ${err.message.slice(0, 200)}`);
        setViewerStatus("Falha na geração IA", "error");
        console.error("[AI Panel]", err);

    } finally {
        spinner.classList.remove("visible");
        btnAIGen.disabled = false;
        aiPromptEl.disabled = false;
        btnAIGen.classList.remove("loading");
        aiPromptEl.value = "";
        aiPromptEl.style.height = "30px";
    }
}

// ── Event listeners do chat panel ───────────────────────────────────────────────
if (btnAIGen) {
    btnAIGen.addEventListener("click", () => sendAIPrompt(aiPromptEl.value));
}

if (aiPromptEl) {
    // Enter envia; Shift+Enter quebra linha
    aiPromptEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendAIPrompt(aiPromptEl.value);
        }
    });

    // Auto-resize do textarea
    aiPromptEl.addEventListener("input", () => {
        aiPromptEl.style.height = "30px";
        aiPromptEl.style.height = `${Math.min(aiPromptEl.scrollHeight, 80)}px`;
    });
}

// Blockly resize (necessário após inject)
new ResizeObserver(() => Blockly.svgResize(workspace))
    .observe(document.getElementById("blockly-canvas"));

// ──────────────────────────────────────────────────────────────────────────────
// 11. Utilitários M21-M22 — base64 ⇄ ArrayBuffer / download / STEP
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Decodifica uma string base64 para um ArrayBuffer não gerenciado.
 * Compatível com todos os browsers modernos via atob().
 * @param {string} b64 - String base64 pura (sem prefixo data:)
 * @returns {ArrayBuffer}
 */
function _base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Decodifica base64 e força o download do arquivo no browser.
 * @param {string} b64      - Conteúdo em base64
 * @param {string} filename - Nome do arquivo (ex: 'modelo_gerado.step')
 * @param {string} mime     - MIME type (ex: 'application/octet-stream')
 */
function _downloadBase64File(b64, filename, mime) {
    if (!b64) {
        console.warn("[STEP Download] base64 vazio — nenhum modelo disponível.");
        return;
    }
    try {
        const buffer = _base64ToArrayBuffer(b64);
        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        // Liberar URL após 2s (tempo suficiente para o browser iniciar o download)
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    } catch (err) {
        console.error("[STEP Download] Falha na decodificação base64:", err);
        addChatMessage("agent", `⚠ Falha no download STEP: ${err.message}`);
    }
}

// Referência ao botão de download STEP
const btnDownloadStep = document.getElementById("btn-download-step");

if (btnDownloadStep) {
    btnDownloadStep.addEventListener("click", () => {
        _downloadBase64File(
            currentStepBase64,
            "modelo_gerado.step",
            "application/octet-stream"
        );
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// 10. PDF Upload — M19-M20 (VLM: Engenharia Reversa de Planta 2D → STL)
// ──────────────────────────────────────────────────────────────────────────────

const pdfFileInput = document.getElementById("pdf-file-input");
const btnPDFUpload = document.getElementById("btn-pdf-upload");

/** Fases de status exibidas no ai-log durante o processamento VLM */
const PDF_STATUS_PHASES = [
    "📄 Lendo planta 2D…",
    "🧠 Analisando cotas VLM…",
    "🔧 Gerando B-Rep…",
];

/**
 * Envia um arquivo PDF para o endpoint /generate_from_pdf (VLM Self-Healing Loop).
 * Exibe fases de status animadas no ai-log e carrega o STL retornado no viewer 3D.
 *
 * @param {File} file - Objeto File selecionado pelo usuário (deve ser .pdf)
 */
async function sendPDFToServer(file) {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
        addChatMessage("agent", "⚠ Selecione um arquivo .pdf válido.");
        return;
    }

    // ── Bloquear UI durante processamento ────────────────────────────────────
    btnAIGen.disabled = true;
    aiPromptEl.disabled = true;
    btnPDFUpload.disabled = true;
    btnAIGen.classList.add("loading");

    // Exibir mensagem do usuário no chat (nome do arquivo como contexto)
    addChatMessage("user", `📎 ${file.name}`);

    // Criar bubble de status animada
    const statusBubble = addChatMessage("status", PDF_STATUS_PHASES[0]);
    let phaseIdx = 0;
    const phaseTimer = setInterval(() => {
        phaseIdx = (phaseIdx + 1) % PDF_STATUS_PHASES.length;
        statusBubble.querySelector(".ai-msg__bubble").textContent =
            PDF_STATUS_PHASES[phaseIdx];
    }, 1800);

    // Spinner no viewer 3D
    spinner.classList.add("visible");
    setViewerStatus("VLM processando PDF…", "loading");

    try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${SERVER_URL}/generate_from_pdf`, {
            method: "POST",
            body: formData,   // Content-Type multipart/form-data (sem header manual)
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(errJson.detail ?? res.statusText);
        }

        // ── M21-M22: processar JSON rico ──────────────────────────────────────
        const json = await res.json();

        // a) Decodificar STL base64 → ArrayBuffer → viewer 3D
        try {
            const stlBuffer = _base64ToArrayBuffer(json.stl_base64);
            loadSTLBuffer(stlBuffer);
        } catch (decErr) {
            throw new Error(`Falha ao decodificar STL (PDF): ${decErr.message}`);
        }

        // b) Exibir código Python gerado no painel de código
        if (json.python_code) {
            codeOutput.value = json.python_code;
            setCodeStatus(`VLM gerou ${json.python_code.split("\n").length} linhas`, "ok");
        }

        // c) Armazenar STEP base64 e habilitar botão de download
        currentStepBase64 = json.step_base64 || null;
        if (btnDownloadStep) {
            btnDownloadStep.disabled = !currentStepBase64;
            if (currentStepBase64) {
                btnDownloadStep.title = `Baixar modelo STEP gerado em ${json.attempts} tentativa(s) (PDF/VLM)`;
            }
        }

        // Mensagem de sucesso no chat
        clearInterval(phaseTimer);
        statusBubble.querySelector(".ai-msg__bubble").textContent = "";
        const hasStep = currentStepBase64 ? " + STEP" : "";
        addChatMessage(
            "agent",
            `✓ Modelo VLM gerado em ${json.attempts} tentativa${json.attempts > 1 ? "s" : ""
            }! (PDF → B-Rep${hasStep})`
        );

    } catch (err) {
        clearInterval(phaseTimer);
        statusBubble.querySelector(".ai-msg__bubble").textContent = "";
        addChatMessage("agent", `⚠ Erro PDF/VLM: ${err.message.slice(0, 240)}`);
        setViewerStatus("Falha na engenharia reversa PDF", "error");
        console.error("[PDF/VLM]", err);

    } finally {
        // ── Restaurar UI ──────────────────────────────────────────────────────
        spinner.classList.remove("visible");
        btnAIGen.disabled = false;
        aiPromptEl.disabled = false;
        btnPDFUpload.disabled = false;
        btnAIGen.classList.remove("loading");
        // Limpar o input de arquivo para permitir reenvio do mesmo PDF
        if (pdfFileInput) pdfFileInput.value = "";
    }
}

// ── Event listeners PDF ──────────────────────────────────────────────────────

// Clicar no botão 📎 abre o file picker
if (btnPDFUpload && pdfFileInput) {
    btnPDFUpload.addEventListener("click", () => pdfFileInput.click());
}

// Quando o usuário seleciona um arquivo → enviar ao servidor
if (pdfFileInput) {
    pdfFileInput.addEventListener("change", () => {
        const file = pdfFileInput.files?.[0];
        if (file) sendPDFToServer(file);
    });
}

console.info(`[main.js] CAD Editor M24 · Produção iniciado. SERVER_URL=${SERVER_URL}`);
