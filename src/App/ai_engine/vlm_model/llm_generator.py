"""
llm_generator.py — CADAgent: LLM → build123d script (Fase M13-M14)
════════════════════════════════════════════════════════════════════
REGRAS (AI_INSTRUCTIONS.md §6):
  - VLM/LLM via Google Gemini (google-generativeai).
  - System prompt carregado de rag_context/build123d_rules.txt (RAG).
  - Saída: APENAS código Python puro — sem markdown, sem prefácio.
  - HEADLESS: zero dependências de UI ou visualização.

Uso standalone:
    python src/App/ai_engine/vlm_model/llm_generator.py \
        --prompt "Crie um cubo de 20x20x20 com um furo cilíndrico central"
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

# ── Google Gemini SDK ──────────────────────────────────────────────────────────
try:
    import google.generativeai as genai
except ImportError as exc:
    raise ImportError(
        "Instale: pip install google-generativeai"
    ) from exc

# ── python-dotenv — carrega GOOGLE_API_KEY do .env ───────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env opcional; aceita variável de ambiente direta

# ── Caminho ao arquivo de regras RAG ─────────────────────────────────────────
_HERE         = Path(__file__).resolve().parent
_RULES_FILE   = _HERE.parent / "rag_context" / "build123d_rules.txt"


class CADAgent:
    """
    Agente LLM para geração de scripts build123d a partir de descrições textuais.

    Implementa few-shot learning via System Prompt (RAG context file) e garante
    que a saída seja código Python puro e executável pelo sandbox do servidor.

    Attributes:
        model_name: Identificador do modelo Gemini (default: gemini-2.0-flash).
        _system_prompt: Conteúdo de build123d_rules.txt injetado no role system.
        _model: Instância do GenerativeModel já configurada.
    """

    def __init__(
        self,
        api_key:    str | None = None,
        model_name: str        = "gemini-2.0-flash",
    ) -> None:
        """
        Inicializa o CADAgent.

        Args:
            api_key:    Chave da API Gemini. Se None, lê de GOOGLE_API_KEY.
            model_name: Modelo Gemini a usar.

        Raises:
            EnvironmentError: Se a chave de API não for encontrada.
            FileNotFoundError: Se build123d_rules.txt não existir.
        """
        # ── 1. Chave de API ───────────────────────────────────────────────────
        resolved_key = api_key or os.environ.get("GOOGLE_API_KEY", "")
        if not resolved_key:
            raise EnvironmentError(
                "GOOGLE_API_KEY não encontrada. "
                "Defina no arquivo .env ou passe api_key=... para CADAgent()."
            )
        genai.configure(api_key=resolved_key)

        # ── 2. Carregar System Prompt (RAG) ───────────────────────────────────
        if not _RULES_FILE.exists():
            raise FileNotFoundError(
                f"Arquivo de regras RAG não encontrado: {_RULES_FILE}\n"
                "Crie src/App/ai_engine/rag_context/build123d_rules.txt"
            )
        self._system_prompt: str = _RULES_FILE.read_text(encoding="utf-8")

        # ── 3. Configurar o modelo ────────────────────────────────────────────
        self.model_name = model_name
        self._model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=self._system_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,       # baixo: máximo determinismo
                top_p=0.95,
                max_output_tokens=4096,
                candidate_count=1,
            ),
        )

    # ─────────────────────────────────────────────────────────────────────────
    def generate_script_from_text(self, prompt: str) -> str:
        """
        Gera um script Python build123d (Builder Mode) a partir de uma
        descrição em linguagem natural.

        O System Prompt (build123d_rules.txt) já está injetado no modelo;
        este método apenas envia o prompt do usuário e retorna o código limpo.

        Args:
            prompt: Descrição da peça em linguagem natural (PT ou EN).
                    Ex: "Crie um cubo de 30mm com furo cilíndrico de 8mm central"

        Returns:
            String de código Python puro, sem marcadores markdown, pronta para
            ser executada pelo sandbox do servidor via exec() ou subprocess.

        Raises:
            ValueError: Se o modelo retornar resposta vazia.
            RuntimeError: Se a geração falhar por qualquer outra razão.
        """
        if not prompt.strip():
            raise ValueError("Prompt vazio. Descreva a peça desejada.")

        # Prompt final: instrução de saída reforçada para eliminar markdown
        final_prompt = (
            f"{prompt.strip()}\n\n"
            "IMPORTANTE: responda APENAS com código Python puro. "
            "Sem ```python, sem ``` delimitadores, sem texto explicativo. "
            "O código deve começar diretamente com 'from build123d import ...' "
            "e terminar dentro do bloco 'with BuildPart() as part:'."
        )

        try:
            response = self._model.generate_content(final_prompt)
        except Exception as exc:
            raise RuntimeError(f"Falha na chamada ao Gemini: {exc}") from exc

        # ── Extrair e limpar o código ─────────────────────────────────────────
        raw: str = response.text or ""
        code = self._clean_output(raw)

        if not code.strip():
            raise ValueError(
                "O modelo retornou uma resposta vazia. "
                "Tente reformular o prompt."
            )

        return code

    # ─────────────────────────────────────────────────────────────────────────
    def generate_script_from_image(
        self,
        image_bytes: bytes,
        mime_type:   str = "image/png",
        extra_prompt: str = "",
    ) -> str:
        """
        M19-M20 VLM — Engenharia Reversa de imagem/planta para build123d.

        Aceita bytes de uma imagem rasterizada (PNG/JPEG) — geralmente a
        primeira página de um PDF convertida pelo PyMuPDF — e usa o modelo
        multimodal Gemini Vision para:
          1. Ler cotas, tolerâncias e geometria do desenho técnico.
          2. Inferir a intenção de projeto subjacente.
          3. Emitir código Python puro build123d (Builder Mode).

        A imagem é tratada como "Prompt Visual" holístico — NUNCA como
        conjunto de vetores soltos (AI_INSTRUCTIONS.md §6: PROIBIDO OCR).

        Args:
            image_bytes:  Bytes da imagem rasterizada (PNG ou JPEG).
            mime_type:    MIME type da imagem ('image/png' ou 'image/jpeg').
            extra_prompt: Contexto adicional em texto (ex: escala, material).

        Returns:
            String de código Python puro build123d pronto para o sandbox.

        Raises:
            ValueError: Imagem vazia ou resposta vazia do modelo.
            RuntimeError: Falha na chamada à API Gemini.
        """
        if not image_bytes:
            raise ValueError("image_bytes está vazio. Forneça uma imagem válida.")

        # ── Prompt de visão estruturado ───────────────────────────────────────
        vision_prompt = (
            "Você está recebendo uma imagem de um DESENHO TÉCNICO ou PLANTA 2D.\n\n"
            "TAREFA:\n"
            "1. Analise holisticamente a imagem como um humano faria — não como vetores.\n"
            "2. Identifique a geometria principal: formas, dimensões (mm/cm/pol) e cotas.\n"
            "3. Infira a intenção de projeto: que sólido B-Rep esta planta descreve?\n"
            "4. Gere o código Python COMPLETO usando build123d (Builder Mode).\n\n"
            "REGRAS DE SAÍDA:\n"
            "- APENAS código Python puro. Sem ```python, sem texto explicativo.\n"
            "- Comece com 'from build123d import ...'.\n"
            "- Use 'with BuildPart() as part:' como contexto mestre.\n"
            "- Se uma cota for ilegível, use um valor razoável e comente.\n"
            "- Se houver múltiplas vistas (frontal, lateral, superior), integre-as.\n"
        )

        if extra_prompt:
            vision_prompt += f"\nCONTEXTO ADICIONAL: {extra_prompt.strip()}\n"

        vision_prompt += (
            "\nSAÍDA FINAL: código Python build123d completo e executável, "
            "iniciando com 'from build123d import ...'."
        )

        # ── Payload multimodal: [imagem, texto] ───────────────────────────────
        image_part = {
            "inline_data": {
                "mime_type": mime_type,
                "data":      image_bytes,   # bytes — Gemini SDK aceita diretamente
            }
        }

        try:
            response = self._model.generate_content([image_part, vision_prompt])
        except Exception as exc:
            raise RuntimeError(f"Falha VLM Gemini Vision: {exc}") from exc

        raw: str = response.text or ""
        code = self._clean_output(raw)

        if not code.strip():
            raise ValueError(
                "VLM retornou resposta vazia. "
                "A imagem pode não conter um desenho técnico legível."
            )

        return code

    # ─────────────────────────────────────────────────────────────────────────
    def fix_code_from_error(
        self,
        broken_code:     str,
        error_traceback: str,
        original_prompt: str = "",
    ) -> str:
        """
        Autocorrection loop — M15/M16: analisa o traceback Python e reescreve
        o código com build123d seguindo estritamente as regras do RAG context.

        Estratégia de prompt (chain-of-thought estruturado):
          1. Apresenta o código que falhou.
          2. Apresenta o traceback completo capturado pelo subprocess.
          3. Instrui o Gemini a identificar a causa raiz.
          4. Solicita APENAS o código corrigido — sem explicação textual.

        Args:
            broken_code:     Código Python que causou erro no sandbox.
            error_traceback: Saída stderr capturada do subprocess (traceback).
            original_prompt: Descrição original da peça (contexto de referência).

        Returns:
            String de código Python puro corrigido, pronto para re-execução.

        Raises:
            ValueError: Se o modelo retornar resposta vazia.
            RuntimeError: Se a chamada ao Gemini falhar.
        """
        repair_prompt = (
            "=== MODO AUTOCORREÇÃO (Self-Healing Loop) ===\n\n"
            "O código build123d abaixo falhou durante a execução no interpretador Python.\n"
            "Sua tarefa: analisar o TRACEBACK, identificar a causa raiz e reescrever o "
            "código COMPLETO e CORRIGIDO respeitando estritamente as REGRAS do system prompt.\n\n"
        )

        if original_prompt:
            repair_prompt += (
                f"OBJETIVO ORIGINAL DA PEÇA:\n{original_prompt.strip()}\n\n"
            )

        repair_prompt += (
            f"--- CÓDIGO COM FALHA ---\n"
            f"{broken_code.strip()}\n\n"
            f"--- TRACEBACK DO INTERPRETADOR ---\n"
            f"{error_traceback.strip()}\n\n"
            "--- INSTRUÇÕES DE CORREÇÃO ---\n"
            "1. Leia o traceback linha por linha e identifique o erro exato.\n"
            "2. Corrija APENAS o que está errado — não reestruture o que está correto.\n"
            "3. Mantenha a ontologia BuildPart/Builder Mode do build123d.\n"
            "4. Se o erro for de importação, ajuste apenas os nomes importados.\n"
            "5. Se o erro for de posicionamento ou geometria, corrija as coordenadas.\n\n"
            "SAÍDA: APENAS o código Python COMPLETO e CORRIGIDO. "
            "Sem ```python, sem texto explicativo, sem prefácio. "
            "Comece diretamente com 'from build123d import ...'."
        )

        # Temperatura ainda mais baixa para correção conservadora
        repair_model = genai.GenerativeModel(
            model_name=self.model_name,
            system_instruction=self._system_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,       # máxima conservatividade no repair
                top_p=0.90,
                max_output_tokens=4096,
                candidate_count=1,
            ),
        )

        try:
            response = repair_model.generate_content(repair_prompt)
        except Exception as exc:
            raise RuntimeError(f"Falha na chamada de repair ao Gemini: {exc}") from exc

        raw: str = response.text or ""
        fixed = self._clean_output(raw)

        if not fixed.strip():
            raise ValueError(
                "O modelo retornou resposta vazia durante autocorreção. "
                "Esgotando tentativas."
            )

        return fixed

    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _clean_output(raw: str) -> str:

        """
        Remove artefatos de formatação markdown da resposta do LLM.

        Estratégia:
          1. Remove blocos ```python ... ``` ou ``` ... ```.
          2. Remove linhas introdutórias não-Python ('Aqui está...').
          3. Garante que a string comece com uma declaração Python válida.
        """
        # Remover delimitadores de bloco de código
        raw = re.sub(r"```(?:python)?\s*", "", raw)
        raw = re.sub(r"```\s*", "", raw)

        lines = raw.splitlines()
        # Descartar linhas iniciais que não sejam código Python
        start_idx = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if (
                stripped.startswith("from ")
                or stripped.startswith("import ")
                or stripped.startswith("with ")
                or stripped.startswith("#")
                or stripped.startswith("def ")
                or stripped.startswith('"""')
                or stripped.startswith("'''")
            ):
                start_idx = i
                break

        return "\n".join(lines[start_idx:]).strip()


# ─────────────────────────────────────────────────────────────────────────────
# CLI standalone para teste rápido
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="CADAgent — gerador build123d via Gemini")
    parser.add_argument("--prompt", required=True, help="Descrição da peça")
    parser.add_argument("--model", default="gemini-2.0-flash", help="Modelo Gemini")
    args = parser.parse_args()

    agent = CADAgent(model_name=args.model)
    script = agent.generate_script_from_text(args.prompt)

    print("=" * 60)
    print("[OK] Script gerado pelo CADAgent:")
    print("=" * 60)
    print(script)
