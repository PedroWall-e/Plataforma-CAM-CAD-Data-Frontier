/**
 * transpiler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Transpilador AST → Python build123d (Builder Mode)
 *
 * ARQUITETURA:
 *   - Estende Blockly.Generator para criar um gerador Python customizado.
 *   - Cada bloco CAD tem um handler que retorna uma string Python válida.
 *   - O gerador caminha recursivamente o AST dos blocos (scrub_, statementToCode).
 *   - A saída final é código Python purista e executável sem modificações.
 *
 * FLUXO:
 *   Workspace Blockly → AST blocks tree → CadPythonGenerator → string Python
 *
 * REGRAS (AI_INSTRUCTIONS.md §5):
 *   - Zero blocos nativos do Blockly processados.
 *   - Código gerado é 100% compatível com build123d (sem CadQuery).
 */

/* global Blockly */

// ─────────────────────────────────────────────────────────────────────────────
// Cabeçalho padrão injetado antes de todo código gerado
// ─────────────────────────────────────────────────────────────────────────────
const PYTHON_HEADER = `"""
Código gerado automaticamente pelo CAD Blockly Transpiler.
build123d — Builder Mode (AI_INSTRUCTIONS.md §4)
PROIBIDO: CadQuery, UI, visualização.
"""
from build123d import (
    BuildPart, Box, Cylinder, Locations, Location,
    GeomType, Mode, fillet, export_step, export_stl,
)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Instância do gerador customizado
// ─────────────────────────────────────────────────────────────────────────────
const CadPythonGenerator = new Blockly.Generator("CadPython");

// Caracteres seguros para nomes de variáveis (não relevante aqui — sem variáveis)
CadPythonGenerator.RESERVED_WORDS_ = "";

/**
 * scrub_ — chamado internamente pelo Blockly após gerar cada bloco.
 * Responsável por colar o código do bloco atual com o do próximo vizinho.
 */
CadPythonGenerator.scrub_ = function (block, code, thisOnly) {
    const nextBlock = block.nextConnection?.targetBlock();
    if (nextBlock && !thisOnly) {
        return code + CadPythonGenerator.blockToCode(nextBlock);
    }
    return code;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_buildpart
// Gera: with BuildPart() as part:\n    <corpo>
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_buildpart"] = function (block) {
    // statementToCode gera o código de todos os blocos conectados em BODY,
    // aplicando indentação padrão de 4 espaços.
    const body = CadPythonGenerator.statementToCode(block, "BODY");
    const indentedBody = body || "    pass\n";

    return `with BuildPart() as part:\n${indentedBody}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_box
// Gera: Box(length=L, width=W, height=H)
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_box"] = function (block) {
    const length = block.getFieldValue("LENGTH");
    const width = block.getFieldValue("WIDTH");
    const height = block.getFieldValue("HEIGHT");
    return `    Box(length=${length}, width=${width}, height=${height})\n`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_cylinder
// Gera: Cylinder(radius=R, height=H)
// Para posicionar no topo de uma Box, emite também a translação via Locations.
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_cylinder"] = function (block) {
    const radius = block.getFieldValue("RADIUS");
    const height = block.getFieldValue("HEIGHT");

    // Buscar a Box anterior para calcular o offset Z automaticamente
    let zOffset = 0;
    const prevBlock = block.previousConnection?.targetBlock();
    if (prevBlock && prevBlock.type === "cad_box") {
        const baseHeight = parseFloat(prevBlock.getFieldValue("HEIGHT"));
        zOffset = baseHeight / 2 + height / 2;
    }

    if (zOffset > 0) {
        return (
            `    with Locations(Location((0, 0, ${zOffset}))):\n` +
            `        Cylinder(radius=${radius}, height=${height})\n`
        );
    }
    return `    Cylinder(radius=${radius}, height=${height})\n`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_fillet
// Gera: fillet(part.edges().filter_by(GeomType.LINE), radius=R)
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_fillet"] = function (block) {
    const radius = block.getFieldValue("RADIUS");
    const edgeSel = block.getFieldValue("EDGE_SEL");

    /** @type {Record<string, string>} */
    const selectorMap = {
        ALL: `part.edges().filter_by(GeomType.LINE)`,
        TOP: `[e for e in part.edges() if e.geom_type == GeomType.LINE and e.center().Z > 0]`,
        BOT: `[e for e in part.edges() if e.geom_type == GeomType.LINE and e.center().Z < 0]`,
    };

    const sel = selectorMap[edgeSel] ?? selectorMap.ALL;
    return `    fillet(${sel}, radius=${radius})\n`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_export_step
// Gera: export_step(part.part, "filepath")
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_export_step"] = function (block) {
    const filepath = block.getFieldValue("FILEPATH").replace(/\\/g, "/");
    return `export_step(part.part, "${filepath}")\n`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler: cad_export_stl
// Gera: export_stl(part.part, "filepath", angular_tolerance=T)
// ─────────────────────────────────────────────────────────────────────────────
CadPythonGenerator.forBlock["cad_export_stl"] = function (block) {
    const filepath = block.getFieldValue("FILEPATH").replace(/\\/g, "/");
    const tolerance = block.getFieldValue("TOLERANCE");
    return `export_stl(part.part, "${filepath}", angular_tolerance=${tolerance})\n`;
};

// ─────────────────────────────────────────────────────────────────────────────
// API pública: gerar código Python a partir de uma workspace Blockly
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Blockly.WorkspaceSvg} workspace
 * @returns {string} Código Python válido build123d
 */
function generatePythonFromWorkspace(workspace) {
    const topBlocks = workspace.getTopBlocks(/* ordered= */ true);

    if (topBlocks.length === 0) {
        return '# Nenhum bloco na workspace.\n# Arraste um bloco "with BuildPart()" para começar.\n';
    }

    let code = PYTHON_HEADER + "\n";

    for (const block of topBlocks) {
        const blockCode = CadPythonGenerator.blockToCode(block);
        if (blockCode) {
            code += blockCode + "\n";
        }
    }

    return code;
}
