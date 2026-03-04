/**
 * @file OCCTKernel.cpp
 * @brief Implementação do núcleo geométrico OCCT — modo headless.
 *
 * Módulos OCCT utilizados (somente B-Rep / Kernel):
 *   TKernel  – tipos primitivos OCCT (Standard_Real, etc.)
 *   TKMath   – operações matemáticas
 *   TKBRep   – estrutura topológica B-Rep
 *   TKPrim   – primitivas geométricas (MakeBox, MakeSphere, …)
 *   TKTopAlgo – algoritmos topológicos
 *   TKBO      – operações booleanas
 *
 * NENHUM header de visualização (TKOpenGl, TKV3d, TKService, etc.)
 * é incluído aqui — garantindo operação 100% headless.
 */

#include "OCCTKernel.h"

// ── OCCT: Kernel primitivo ─────────────────────────────────────────────────
#include <Standard_Version.hxx>

// ── OCCT: Topologia B-Rep ──────────────────────────────────────────────────
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <BRep_Builder.hxx>

// ── OCCT: Primitiva B-Rep (Box sólido puro) ────────────────────────────────
#include <BRepPrimAPI_MakeBox.hxx>

// ── OCCT: Verificação de forma (BRepCheck) ────────────────────────────────
#include <BRepCheck_Analyzer.hxx>

bool OCCT_CreateTestSolid()
{
    // ── 1. Instanciar um Box sólido B-Rep de 10 x 10 x 10 mm ───────────────
    //    BRepPrimAPI_MakeBox produz um TopoDS_Solid válido composto por
    //    6 faces planares, 12 arestas e 8 vértices — sem malha, sem display.
    BRepPrimAPI_MakeBox boxMaker(10.0, 10.0, 10.0);
    boxMaker.Build();

    if (!boxMaker.IsDone()) {
        return false;
    }

    // ── 2. Recuperar a shape e verificar que não é nula ────────────────────
    const TopoDS_Shape& shape = boxMaker.Shape();
    if (shape.IsNull()) {
        return false;
    }

    // ── 3. Análise topológica (BRepCheck) ──────────────────────────────────
    //    Garante que a topologia B-Rep é internamente consistente.
    BRepCheck_Analyzer analyzer(shape, /*checkGeop=*/Standard_True);
    if (!analyzer.IsValid()) {
        return false;
    }

    return true;
}
