"""
main.py — Servidor FastAPI headless (v0.4.0 — M11-M22)
════════════════════════════════════════════════════════
Endpoints:
  POST /generate              → código Python build123d → STL (Blockly)
  POST /generate_from_text    → prompt texto → Gemini → JSON {python_code, stl_base64, step_base64, attempts}
  POST /generate_from_pdf     → PDF upload → PyMuPDF → VLM → JSON {python_code, stl_base64, step_base64, attempts}
  GET  /health                → status
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import base64

from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
import io

# ── CADAgent (AI engine) — import tardio para evitar falha se lib ausente ─────
def _load_agent():
    """Carrega CADAgent; retorna None se google-generativeai não instalado."""
    try:
        # Ajuste de path para importar de src/App/ai_engine/vlm_model/
        _ai_dir = Path(__file__).resolve().parents[1] / "ai_engine" / "vlm_model"
        if str(_ai_dir) not in sys.path:
            sys.path.insert(0, str(_ai_dir))
        from llm_generator import CADAgent  # type: ignore
        return CADAgent
    except Exception as exc:
        print(f"[AVISO] CADAgent não carregado: {exc}")
        return None

_CADAgent = _load_agent()

# ── Aplicação FastAPI ─────────────────────────────────────────────────────────
app = FastAPI(
    title="CAD Paramétrico — Gerador B-Rep Headless",
    description="POST /generate (código) | POST /generate_from_text (prompt IA)",
    version="0.2.0",
    docs_url="/docs",
    redoc_url=None,
)


# ── CORS: permite fetch do frontend local ─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://127.0.0.1",
        "null",           # file:// protocol (browser abrindo index.html local)
    ],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ── Schema do payload ─────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    code: str   # Código Python build123d gerado pelo transpilador Blockly


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sanitize_code(code: str) -> str:
    """
    Remove chamadas de export já presentes no código gerado pelo Blockly
    e quaisquer llamadas sys.exit/os.system/subprocess (sandboxing básico).
    O servidor injeta seu próprio export_stl ao final.
    """
    # Remover exports existentes (serão reinjetados com path controlado)
    code = re.sub(r"^\s*export_step\(.*\)\s*$", "", code, flags=re.MULTILINE)
    code = re.sub(r"^\s*export_stl\(.*\)\s*$",  "", code, flags=re.MULTILINE)
    # Bloquear comandos shell básicos
    for dangerous in ("os.system", "subprocess.", "sys.exit", "__import__"):
        if dangerous in code:
            raise HTTPException(
                status_code=400,
                detail=f"Código rejeitado: contém '{dangerous}'.",
            )
    return code


def _build_execution_script(
    user_code: str,
    stl_path:  str,
    step_path: str | None = None,
) -> str:
    """
    Envolve o código do usuário em um script executável que ao final
    exporta `part.part` para `stl_path` (STL) e, se `step_path` fornecido,
    também para `step_path` (STEP — modelo matemático paramétrico B-Rep).
    """
    # step_export lines need 8 leading spaces so that after textwrap.dedent
    # strips the 8-space common prefix they land at the correct 4-space indent
    # inside the try block of the generated script.
    step_export = (
        f'        from build123d import export_step as _export_step\n'
        f'        _export_step(part.part, r"{step_path}")\n'
    ) if step_path else ""

    footer = textwrap.dedent(f"""\
        # ── Injetado pelo servidor CAD (M21-M22) ──
        import sys as _sys
        try:
            from build123d import export_stl as _export_stl
            _export_stl(part.part, r"{stl_path}", angular_tolerance=0.1)
{step_export}        except NameError:
            _sys.exit(1)  # 'part' não definido no código do usuário
    """)
    return user_code + "\n" + footer


# ── Endpoint principal ────────────────────────────────────────────────────────

@app.post("/generate")
async def generate(req: GenerateRequest):
    """
    Recebe código Python build123d, executa em subprocesso isolado,
    retorna o arquivo STL gerado.
    """
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="Código vazio.")

    try:
        user_code = _sanitize_code(req.code)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Diretório temporário — limpo automaticamente ao final
    with tempfile.TemporaryDirectory(prefix="cad_gen_") as tmp_dir:
        stl_path   = os.path.join(tmp_dir, "output.stl")
        script_path = os.path.join(tmp_dir, "script.py")

        script = _build_execution_script(user_code, stl_path)

        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)

        # Executa o script no mesmo interpretador Python do servidor
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=30,     # máximo 30s para peças complexas
            cwd=tmp_dir,
        )

        if result.returncode != 0:
            detail = result.stderr.strip() or "Falha desconhecida na execução."
            raise HTTPException(
                status_code=422,
                detail=f"Erro de execução build123d:\n{detail}",
            )

        if not os.path.exists(stl_path):
            raise HTTPException(
                status_code=422,
                detail="Execução OK mas nenhum STL foi gerado. Verifique se o código define 'part'.",
            )

        # Ler o STL e retornar como resposta (antes de apagar o tmpdir)
        stl_bytes = Path(stl_path).read_bytes()

    # Retornar STL binário
    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="model.stl"'},
    )


# ── Schema para endpoint de texto ────────────────────────────────────────────
class TextRequest(BaseModel):
    prompt: str   # Descrição textual da peça em linguagem natural


# ── Constante de autocorreção ─────────────────────────────────────────────────
MAX_RETRIES: int = 3   # tentativas máximas (1 geração + até 2 correções)


# ── Helper: executar script no sandbox ────────────────────────────────────────
def _run_in_sandbox(
    code:    str,
    tmp_dir: str,
    *,
    export_step: bool = False,
) -> tuple[bool, bytes, bytes, str]:
    """
    Executa o código no sandbox subprocess e retorna:
      (success: bool, stl_bytes: bytes, step_bytes: bytes, stderr: str)

    Quando `export_step=True`, injeta também export_step() no script e lê o
    arquivo STEP resultante. Se o STEP não for gerado (biblioteca indisponível),
    step_bytes fica como b"" sem falhar o pipeline inteiro.
    """
    stl_path    = os.path.join(tmp_dir, "output.stl")
    step_path   = os.path.join(tmp_dir, "output.step") if export_step else None
    script_path = os.path.join(tmp_dir, "script.py")

    script = _build_execution_script(code, stl_path, step_path)
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script)

    result = subprocess.run(
        [sys.executable, script_path],
        capture_output=True, text=True, timeout=60, cwd=tmp_dir,
    )

    if result.returncode != 0:
        return False, b"", b"", result.stderr.strip()

    if not os.path.exists(stl_path):
        return False, b"", b"", "[SEM STL] Script executou mas não definiu 'part'."

    stl_bytes  = Path(stl_path).read_bytes()
    step_bytes = Path(step_path).read_bytes() if (step_path and os.path.exists(step_path)) else b""

    return True, stl_bytes, step_bytes, ""


# ── Helper: montar JSONResponse com código + base64 ───────────────────────────
def _build_ai_json_response(
    code:      str,
    stl_bytes: bytes,
    step_bytes: bytes,
    attempts:  int,
) -> JSONResponse:
    """
    Codifica STL e STEP em base64 e retorna um JSONResponse padronizado.

    Campos:
      python_code  — script build123d gerado pela IA (texto puro)
      stl_base64   — STL binário codificado em base64
      step_base64  — STEP matemático codificado em base64 ("" se não gerado)
      attempts     — número de tentativas do Self-Healing Loop
    """
    return JSONResponse(content={
        "python_code":  code,
        "stl_base64":   base64.b64encode(stl_bytes).decode("ascii"),
        "step_base64":  base64.b64encode(step_bytes).decode("ascii") if step_bytes else "",
        "attempts":     attempts,
    })


# ── Endpoint: texto → Gemini → código → Self-Healing → STL ─────────────────
@app.post("/generate_from_text")
async def generate_from_text(req: TextRequest):
    """
    M15-M16 Self-Healing Loop:
      1. Gemini gera código build123d.
      2. Sandbox executa o código.
      3. Se falhar → CADAgent.fix_code_from_error() → re-execução.
      4. Repete até MAX_RETRIES ou sucesso.
      5. Nunca derruba o servidor — todas as exceções são capturadas.
    """
    if _CADAgent is None:
        raise HTTPException(
            status_code=503,
            detail="Motor de IA não disponível. "
                   "Instale: pip install google-generativeai python-dotenv "
                   "e defina GOOGLE_API_KEY no .env",
        )

    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt vazio.")

    # ── 1. Instanciar agente (compartilhado por todas as tentativas) ───────────
    try:
        agent = _CADAgent()
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # ── 2. Gerar código inicial ────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"[CAD/AI] Prompt recebido: {req.prompt[:120]!r}")
    print(f"[CAD/AI] Tentativa 1/{MAX_RETRIES} — Gerando código via Gemini…")

    try:
        current_code = agent.generate_script_from_text(req.prompt)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha na geração inicial (Gemini): {exc}",
        ) from exc

    # ── 3. Self-Healing Loop ───────────────────────────────────────────────────
    last_traceback = ""
    last_code      = current_code

    with tempfile.TemporaryDirectory(prefix="cad_ai_") as tmp_dir:

        for attempt in range(1, MAX_RETRIES + 1):

            try:
                safe_code = _sanitize_code(current_code)
            except HTTPException as exc:
                print(f"[CAD/AI] Tentativa {attempt}: rejeitado pelo sanitizador — {exc.detail}")
                raise  # Não retentar — é problema de segurança

            print(f"[CAD/AI] Tentativa {attempt}/{MAX_RETRIES} — Executando sandbox…")

            try:
                ok, stl_bytes, step_bytes, stderr = _run_in_sandbox(
                    safe_code, tmp_dir, export_step=True
                )
            except subprocess.TimeoutExpired:
                stderr, ok, stl_bytes, step_bytes = "TimeoutExpired: execução excedeu 60s.", False, b"", b""

            if ok:
                # ✅ Sucesso!
                print(f"[CAD/AI] ✅ Tentativa {attempt} — STL {len(stl_bytes):,}B "
                      f"| STEP {len(step_bytes):,}B.")
                return _build_ai_json_response(current_code, stl_bytes, step_bytes, attempt)

            # ❌ Falhou
            last_traceback = stderr
            last_code      = current_code
            print(f"[CAD/AI] ❌ Tentativa {attempt} falhou.")
            print(f"[CAD/AI]    Traceback:\n{stderr[:600]}")

            if attempt < MAX_RETRIES:
                print(f"\n[CAD/AI] 🔄 Autocorreção (tentativa {attempt + 1}/{MAX_RETRIES})…")
                try:
                    current_code = agent.fix_code_from_error(
                        broken_code=current_code,
                        error_traceback=stderr,
                        original_prompt=req.prompt,
                    )
                    print(f"[CAD/AI] 🔄 Código corrigido ({len(current_code)} chars).")
                except Exception as fix_exc:
                    print(f"[CAD/AI] ⚠ fix_code_from_error falhou: {fix_exc}")
                    break

    # ── 4. Todas as tentativas esgotadas ──────────────────────────────────────
    print(f"[CAD/AI] ❌ Loop encerrado após {MAX_RETRIES} tentativas sem sucesso.")
    print(f"{'='*60}\n")
    raise HTTPException(
        status_code=422,
        detail=(
            f"Falha após {MAX_RETRIES} tentativas (incluindo autocorreção).\n\n"
            f"--- Último traceback ---\n{last_traceback}\n\n"
            f"--- Último código gerado ---\n{last_code}"
        ),
    )


# ── Endpoint: PDF → PyMuPDF → VLM → código → STL ─────────────────────────────────
@app.post("/generate_from_pdf")
async def generate_from_pdf(
    file: UploadFile = File(..., description="Arquivo PDF com planta ou desenho técnico"),
):
    """
    M19-M20 VLM — Engenharia Reversa de PDF:
      1. Lê a 1ª página do PDF via PyMuPDF (rasterização na memória).
      2. Envia imagem PNG ao CADAgent.generate_script_from_image().
      3. Executa o código no sandbox com Self-Healing Loop (MAX_RETRIES).
      4. Retorna STL binário.
    """
    if _CADAgent is None:
        raise HTTPException(
            status_code=503,
            detail="Motor de IA não disponível. Defina GOOGLE_API_KEY no .env.",
        )

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Envie um arquivo .pdf.")

    # ── 1. Ler PDF e rasterizar primeira página ─────────────────────────────────
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vazio.")

    print(f"\n{'='*60}")
    print(f"[CAD/PDF] Arquivo: {file.filename!r} ({len(pdf_bytes):,} bytes)")
    print(f"[CAD/PDF] Rasterizando página 1 via PyMuPDF…")

    try:
        import fitz  # PyMuPDF
        pdf_doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page     = pdf_doc[0]                           # primeira página
        # Matriz de escala 2x para boa resolução (aprox. 144 DPI)
        mat      = fitz.Matrix(2.0, 2.0)
        pixmap   = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes: bytes = pixmap.tobytes(output="png")
        pdf_doc.close()
        print(f"[CAD/PDF] Página rasterizada: {len(img_bytes):,} bytes PNG")
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Falha ao ler o PDF com PyMuPDF: {exc}",
        ) from exc

    # ── 2. VLM: gerar código a partir da imagem ───────────────────────────────
    print(f"[CAD/PDF] Enviando ao VLM Gemini Vision…")
    try:
        agent        = _CADAgent()
        current_code = agent.generate_script_from_image(
            image_bytes=img_bytes,
            mime_type="image/png",
        )
        print(f"[CAD/PDF] Código VLM gerado ({len(current_code)} chars).")
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha na geração VLM: {exc}",
        ) from exc

    # ── 3. Self-Healing Loop ───────────────────────────────────────────────────
    last_traceback = ""
    last_code      = current_code

    with tempfile.TemporaryDirectory(prefix="cad_pdf_") as tmp_dir:

        for attempt in range(1, MAX_RETRIES + 1):
            print(f"[CAD/PDF] Tentativa {attempt}/{MAX_RETRIES} — sandbox…")

            try:
                safe_code = _sanitize_code(current_code)
            except HTTPException:
                raise

            try:
                ok, stl_bytes, step_bytes, stderr = _run_in_sandbox(
                    safe_code, tmp_dir, export_step=True
                )
            except subprocess.TimeoutExpired:
                stderr, ok, stl_bytes, step_bytes = "TimeoutExpired (60s).", False, b"", b""

            if ok:
                print(f"[CAD/PDF] ✅ STL {len(stl_bytes):,}B | STEP {len(step_bytes):,}B "
                      f"— tentativa {attempt}.")
                print(f"{'='*60}\n")
                return _build_ai_json_response(current_code, stl_bytes, step_bytes, attempt)

            last_traceback = stderr
            last_code      = current_code
            print(f"[CAD/PDF] ❌ Tentativa {attempt} falhou.")
            print(f"[CAD/PDF]    {stderr[:400]}")

            if attempt < MAX_RETRIES:
                print(f"[CAD/PDF] 🔄 Autocorrecção (tentativa {attempt + 1})…")
                try:
                    current_code = agent.fix_code_from_error(
                        broken_code=current_code,
                        error_traceback=stderr,
                        original_prompt="Engenharia reversa de PDF.",
                    )
                except Exception as fix_exc:
                    print(f"[CAD/PDF] ⚠ fix falhou: {fix_exc}")
                    break

    print(f"[CAD/PDF] ❌ Loop PDF esgotado após {MAX_RETRIES} tentativas.")
    print(f"{'='*60}\n")
    raise HTTPException(
        status_code=422,
        detail=(
            f"Falha VLM após {MAX_RETRIES} tentativas.\n\n"
            f"--- Último traceback ---\n{last_traceback}\n\n"
            f"--- Último código ---\n{last_code}"
        ),
    )


@app.get("/health")
def health():
    return {
        "status":    "ok",
        "version":   "0.4.0",
        "ai_engine": _CADAgent is not None,
    }


# ── Entrypoint ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="info",
    )
