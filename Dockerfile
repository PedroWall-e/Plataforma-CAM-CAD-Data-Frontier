# ══════════════════════════════════════════════════════════════════════════════
# Dockerfile — CAD Paramétrico Backend (M23-M24)
# ══════════════════════════════════════════════════════════════════════════════
# Imagem base leve Python 3.10
FROM python:3.10-slim

# ── Metadados ─────────────────────────────────────────────────────────────────
LABEL maintainer="CAD Paramétrico Team"
LABEL description="Backend headless: FastAPI + build123d + Gemini VLM"
LABEL version="0.4.0"

# ── Variáveis de ambiente ─────────────────────────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

# ── Dependências do sistema ───────────────────────────────────────────────────
# build123d/OCC requer libglib e libGL; PyMuPDF requer libmupdf-dev deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libgomp1 \
        && rm -rf /var/lib/apt/lists/*

# ── Diretório de trabalho ─────────────────────────────────────────────────────
WORKDIR /app

# ── Dependências Python (cache layer separada) ────────────────────────────────
COPY src/App/server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── Código-fonte da aplicação ─────────────────────────────────────────────────
# Copia src/App/ completo (server + ai_engine)
COPY src/App/ ./src/App/

# ── Usuário não-root (segurança) ──────────────────────────────────────────────
RUN adduser --disabled-password --gecos "" caduser \
    && chown -R caduser:caduser /app
USER caduser

# ── Porta exposta ─────────────────────────────────────────────────────────────
EXPOSE 8000

# ── Healthcheck ───────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" \
    || exit 1

# ── Comando de inicialização ──────────────────────────────────────────────────
CMD ["uvicorn", "src.App.server.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
