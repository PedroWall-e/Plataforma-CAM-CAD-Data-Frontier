"""
main.py — Servidor FastAPI headless (Fase M11-M12)
════════════════════════════════════════════════════
REGRAS (AI_INSTRUCTIONS.md §2):
  - Lógica de aplicação estritamente separada da Gui.
  - Zero dependências de Qt, visualização ou UI.
  - Executa código Python build123d via subprocess seguro.

Endpoint:
  POST /generate
    Body: { "code": "<python build123d code string>" }
    Returns: STL binário (application/octet-stream)

Uso:
  pip install fastapi uvicorn python-multipart
  uvicorn src.App.server.main:app --reload --port 8000
  ou:
  python src/App/server/main.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ── Aplicação FastAPI ─────────────────────────────────────────────────────────
app = FastAPI(
    title="CAD Paramétrico — Gerador B-Rep Headless",
    description="Recebe código build123d, executa headless, retorna STL.",
    version="0.1.0",
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


def _build_execution_script(user_code: str, stl_path: str) -> str:
    """
    Envolve o código do usuário em um script executável que ao final
    exporta `part.part` para `stl_path`.
    """
    footer = textwrap.dedent(f"""
        # ── Injetado pelo servidor CAD ──
        import sys as _sys
        try:
            from build123d import export_stl as _export_stl
            _export_stl(part.part, r"{stl_path}", angular_tolerance=0.1)
        except NameError:
            _sys.exit(1)  # 'part' não definido no código do usuário
    """)
    return user_code + footer


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
    from fastapi.responses import Response
    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="model.stl"'},
    )


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


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
