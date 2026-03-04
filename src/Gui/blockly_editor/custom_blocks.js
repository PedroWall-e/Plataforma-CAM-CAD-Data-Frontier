/**
 * custom_blocks.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Definições de blocos CAD customizados para o Blockly.
 *
 * REGRAS (AI_INSTRUCTIONS.md §5):
 *   - NÃO inclui blocos genéricos do Blockly (loops, math, text nativos).
 *   - Cada bloco mapeia PURAMENTE uma classe/primitiva do build123d.
 *   - Ontologia B-Rep: cad_buildpart → cad_box / cad_cylinder / cad_fillet
 *   - Exportadores: cad_export_step, cad_export_stl
 *
 * Paleta de cores por categoria semântica:
 *   Azul  (#233)  → Estrutura (BuildPart)
 *   Roxo  (#270)  → Primitivas (Box, Cylinder)
 *   Verde (#160)  → Operações  (Fillet)
 *   Âmbar (#30)   → Exportação (STEP, STL)
 */

/* global Blockly */

// ─────────────────────────────────────────────────────────────────────────────
// Definições JSON dos blocos (notação nativa do Blockly)
// ─────────────────────────────────────────────────────────────────────────────
const CAD_BLOCK_DEFINITIONS = [

    // ── cad_buildpart ────────────────────────────────────────────────────────
    // Representação visual de: with BuildPart() as part:
    //   [blocos internos]
    {
        type: "cad_buildpart",
        message0: "🔷 with BuildPart() as part: %1 %2",
        args0: [
            { type: "input_dummy" },
            { type: "input_statement", name: "BODY", check: "cad_primitive" }
        ],
        colour: 233,
        tooltip: "Contexto BuildPart. Recebe primitivas e operações internas.",
        helpUrl: "https://build123d.readthedocs.io/en/latest/builder_mode.html",
        previousStatement: null,
        nextStatement: null,
    },

    // ── cad_box ──────────────────────────────────────────────────────────────
    // build123d: Box(length, width, height)
    {
        type: "cad_box",
        message0: "📦 Box  L %1  W %2  H %3 mm",
        args0: [
            { type: "field_number", name: "LENGTH", value: 60, min: 0.1, precision: 0.1 },
            { type: "field_number", name: "WIDTH", value: 40, min: 0.1, precision: 0.1 },
            { type: "field_number", name: "HEIGHT", value: 10, min: 0.1, precision: 0.1 }
        ],
        colour: 270,
        tooltip: "Sólido B-Rep retangular. Mapeado para Box(length, width, height) do build123d.",
        helpUrl: "https://build123d.readthedocs.io/en/latest/objects_3d.html#box",
        previousStatement: "cad_primitive",
        nextStatement: "cad_primitive",
    },

    // ── cad_cylinder ─────────────────────────────────────────────────────────
    // build123d: Cylinder(radius, height)
    {
        type: "cad_cylinder",
        message0: "🔵 Cylinder  R %1  H %2 mm",
        args0: [
            { type: "field_number", name: "RADIUS", value: 10, min: 0.1, precision: 0.1 },
            { type: "field_number", name: "HEIGHT", value: 25, min: 0.1, precision: 0.1 }
        ],
        colour: 270,
        tooltip: "Cilindro B-Rep. Mapeado para Cylinder(radius, height) do build123d.",
        helpUrl: "https://build123d.readthedocs.io/en/latest/objects_3d.html#cylinder",
        previousStatement: "cad_primitive",
        nextStatement: "cad_primitive",
    },

    // ── cad_fillet ───────────────────────────────────────────────────────────
    // build123d: fillet(part.edges(), radius)
    {
        type: "cad_fillet",
        message0: "✨ Fillet  R %1 mm  nas arestas %2",
        args0: [
            { type: "field_number", name: "RADIUS", value: 2, min: 0.01, precision: 0.01 },
            {
                type: "field_dropdown",
                name: "EDGE_SEL",
                options: [
                    ["todas", "ALL"],
                    ["superiores Z+", "TOP"],
                    ["inferiores Z-", "BOT"],
                ]
            }
        ],
        colour: 160,
        tooltip: "Arredondamento de arestas. Mapeado para fillet() do build123d.",
        previousStatement: "cad_primitive",
        nextStatement: "cad_primitive",
    },

    // ── cad_export_step ──────────────────────────────────────────────────────
    // build123d: export_step(part, filepath)
    {
        type: "cad_export_step",
        message0: "💾 export_step → %1",
        args0: [
            { type: "field_input", name: "FILEPATH", text: "build/modelo.step" }
        ],
        colour: 30,
        tooltip: "Exporta o sólido para STEP AP203/AP214 (intercâmbio industrial).",
        previousStatement: null,
        nextStatement: null,
    },

    // ── cad_export_stl ───────────────────────────────────────────────────────
    // build123d: export_stl(part, filepath, angular_tolerance)
    {
        type: "cad_export_stl",
        message0: "🌐 export_stl → %1  δ %2 rad",
        args0: [
            { type: "field_input", name: "FILEPATH", text: "build/modelo.stl" },
            { type: "field_number", name: "TOLERANCE", value: 0.1, min: 0.001, precision: 0.001 }
        ],
        colour: 30,
        tooltip: "Triangula e exporta para STL binário (WebGL / impressão 3D).",
        previousStatement: null,
        nextStatement: null,
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Registrar os blocos no framework Blockly
// ─────────────────────────────────────────────────────────────────────────────
Blockly.common.defineBlocks(
    Blockly.common.createBlockDefinitionsFromJsonArray(CAD_BLOCK_DEFINITIONS)
);

console.info("[CAD Blocks] %d blocos registrados:", CAD_BLOCK_DEFINITIONS.length,
    CAD_BLOCK_DEFINITIONS.map(b => b.type));
