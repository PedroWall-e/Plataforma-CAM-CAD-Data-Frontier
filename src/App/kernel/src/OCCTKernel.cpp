/**
 * @file OCCTKernel.cpp
 * @brief Implementação do núcleo geométrico OCCT — modo headless.
 *
 * Módulos OCCT utilizados:
 *   TKernel   – tipos primitivos OCCT
 *   TKMath    – operações matemáticas
 *   TKBRep    – estrutura topológica B-Rep
 *   TKPrim    – primitivas geométricas (MakeBox…)
 *   TKTopAlgo – algoritmos topológicos
 *   TKBO      – operações booleanas
 *   TKCAF     – TDocStd_Application / TDocStd_Document  [M3-M4]
 *   TKLCAF    – TNaming_Builder / TNaming_NamedShape      [M3-M4]
 *   TKCDF     – CDF persistence layer                     [M3-M4]
 *
 * NENHUM header de visualização (TKOpenGl, TKV3d, TKService) incluído.
 */

#include "OCCTKernel.h"
#include "OCAFDocumentManager.h"

// ── OCCT: Kernel primitivo ─────────────────────────────────────────────────
#include <Standard_Version.hxx>

// ── OCCT: Topologia B-Rep ──────────────────────────────────────────────────
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <BRep_Builder.hxx>

// ── OCCT: Primitiva B-Rep ─────────────────────────────────────────────────
#include <BRepPrimAPI_MakeBox.hxx>

// ── OCCT: Verificação topológica ─────────────────────────────────────────
#include <BRepCheck_Analyzer.hxx>

// ─────────────────────────────────────────────────────────────────────────────
// Fase M1-M2: validação B-Rep pura
// ─────────────────────────────────────────────────────────────────────────────
bool OCCT_CreateTestSolid()
{
    // ── 1. Box sólido B-Rep de 10 x 10 x 10 mm ────────────────────────────
    BRepPrimAPI_MakeBox boxMaker(10.0, 10.0, 10.0);
    boxMaker.Build();

    if (!boxMaker.IsDone()) {
        return false;
    }

    // ── 2. Verificar que a shape não é nula ───────────────────────────────
    const TopoDS_Shape& shape = boxMaker.Shape();
    if (shape.IsNull()) {
        return false;
    }

    // ── 3. Análise topológica (BRepCheck) ────────────────────────────────
    BRepCheck_Analyzer analyzer(shape, /*checkGeom=*/Standard_True);
    if (!analyzer.IsValid()) {
        return false;
    }

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase M3-M4: validação OCAF end-to-end (árvore paramétrica)
// ─────────────────────────────────────────────────────────────────────────────
bool OCCT_TestOCAFDocument()
{
    // ── 1. Instanciar o gerenciador OCAF ──────────────────────────────────
    //    Cria TDocStd_Application + TDocStd_Document "BinXCAF" em memória.
    OCAFDocumentManager mgr;

    // ── 2. Obter Label raiz "0:1" ─────────────────────────────────────────
    TDF_Label rootLabel = mgr.getRootLabel();
    if (rootLabel.IsNull()) {
        return false;
    }

    // ── 3. Criar sub-Label filho "0:1:1" ─────────────────────────────────
    //    TDF_TagSource::NewChild garante tag única e persistente.
    TDF_Label shapeLabel = mgr.newChildLabel(rootLabel);
    if (shapeLabel.IsNull()) {
        return false;
    }

    // ── 4. Gerar sólido B-Rep 10x10x10 mm ───────────────────────────────
    BRepPrimAPI_MakeBox boxMaker(10.0, 10.0, 10.0);
    boxMaker.Build();
    if (!boxMaker.IsDone() || boxMaker.Shape().IsNull()) {
        return false;
    }

    // ── 5. Anexar shape ao Label via TNaming_Builder ──────────────────────
    //    Registra como TNaming_GENERATED (feature primitiva original).
    //    AI_INSTRUCTIONS §3: "Atributos de forma DEVEM ser anexados a Labels."
    if (!mgr.attachShape(shapeLabel, boxMaker.Shape())) {
        return false;
    }

    // ── 6. Recuperar TNaming_NamedShape e validar ─────────────────────────
    //    Confirma que o atributo persiste no Label e a shape é não-nula.
    if (!mgr.isShapeAttached(shapeLabel)) {
        return false;
    }

    return true;
}
