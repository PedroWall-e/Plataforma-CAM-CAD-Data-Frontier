"""
parametric_generator.py
========================
Fase 2 (M7-M8) — Interpretador build123d: CAD-as-Code

Peça paramétrica:
  1. Base retangular (Box) centrada na origem
  2. Cilindro central no topo da base (união booleana via add())
  3. Fillet nas arestas superiores lineares da base

REGRAS (AI_INSTRUCTIONS.md §4):
  - EXCLUSIVAMENTE build123d — CadQuery PROIBIDO.
  - Builder Mode: with BuildPart() como contexto mestre.
  - Zero dependências de GUI/visualização.

Uso:
    python src/App/modeling/parametric_generator.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from build123d import (
    Box,
    BuildPart,
    Cylinder,
    GeomType,
    Location,
    Locations,
    Mode,
    add,
    export_step,
    export_stl,
    fillet,
)

# ── Parâmetros (mm) ───────────────────────────────────────────────────────────
BASE_WIDTH:    float = 60.0
BASE_DEPTH:    float = 40.0
BASE_HEIGHT:   float = 10.0

CYL_RADIUS:    float = 10.0
CYL_HEIGHT:    float = 25.0

FILLET_RADIUS: float = 2.0

# ── Saída ─────────────────────────────────────────────────────────────────────
_ROOT      = Path(__file__).resolve().parents[3]
OUTPUT_DIR = _ROOT / "build"
STEP_FILE  = OUTPUT_DIR / "modelo_python.step"
STL_FILE   = OUTPUT_DIR / "modelo_python.stl"


# ─────────────────────────────────────────────────────────────────────────────
def build_part() -> object:
    """
    Constrói a peça usando Builder Mode (with BuildPart() as my_part:).

    Topologia (operações em ordem):
      1. Box centrado na origem     → Z ∈ [-5, +5]
      2. Cylinder no topo da base  → Z ∈ [+5, +30] (via Locations)
      3. fillet nas arestas retas do topo da base
    """
    print("  [1/3] Gerando topologia...")
    print(f"        Base     : {BASE_WIDTH} x {BASE_DEPTH} x {BASE_HEIGHT} mm")
    print(f"        Cilindro : R={CYL_RADIUS} mm  H={CYL_HEIGHT} mm")
    print(f"        Fillet   : R={FILLET_RADIUS} mm")

    with BuildPart() as my_part:

        # ── 1. Base retangular centrada na origem ─────────────────────────────
        # Z ∈ [-BASE_HEIGHT/2, +BASE_HEIGHT/2] = [-5, +5]
        Box(BASE_WIDTH, BASE_DEPTH, BASE_HEIGHT)

        # ── 2. Cilindro no topo da base ───────────────────────────────────────
        # Deslocamos para Z = BASE_HEIGHT/2 + CYL_HEIGHT/2 = 5 + 12.5 = 17.5
        # O cilindro build123d é centrado em Z=0 por padrão,
        # então transladado 17.5mm ele ocupa Z ∈ [+5, +30].
        cyl_center_z = BASE_HEIGHT / 2 + CYL_HEIGHT / 2
        with Locations(Location((0, 0, cyl_center_z))):
            Cylinder(radius=CYL_RADIUS, height=CYL_HEIGHT)

        # ── 3. Fillet nas arestas retas do topo da base ────────────────────────
        # Selecionamos arestas cujo centro Z ≈ +BASE_HEIGHT/2 e tipo = LINE.
        top_z = BASE_HEIGHT / 2
        tol   = 0.5   # tolerância posicional em mm

        top_edges = [
            e for e in my_part.edges()
            if e.geom_type == GeomType.LINE
            and abs(e.center().Z - top_z) < tol
        ]

        if top_edges:
            fillet(top_edges, radius=FILLET_RADIUS)
        else:
            print("        [AVISO] Nenhuma aresta superior encontrada — fillet ignorado.")

    return my_part.part


# ─────────────────────────────────────────────────────────────────────────────
def export_files(part: object) -> None:
    """Exporta para STEP (B-Rep exato) e STL (malha triangulada)."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("\n  [2/3] Exportando malhas...")

    export_step(part, str(STEP_FILE))
    print(f"        STEP → {STEP_FILE}")

    export_stl(part, str(STL_FILE), angular_tolerance=0.1)
    print(f"        STL  → {STL_FILE}")


# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 56)
    print("  build123d Parametric Generator — Fase M7-M8")
    print("=" * 56)

    try:
        part = build_part()
        export_files(part)
    except Exception as exc:  # noqa: BLE001
        print(f"\n[ERRO] {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1

    print("\n  [3/3] Concluído.")
    print("=" * 56)
    return 0


if __name__ == "__main__":
    sys.exit(main())
