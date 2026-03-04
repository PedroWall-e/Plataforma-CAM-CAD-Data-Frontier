/**
 * @file test_kernel.cpp
 * @brief Executável de validação headless — OCCT + OCAF + XML + STEP + STL.
 *
 * Fases:
 *   Fase 1  → B-Rep puro (regressão):  BRepPrimAPI_MakeBox + BRepCheck
 *   Fase 2  → OCAF:  TDocStd_Document → Label [0:1:1] → TNaming_NamedShape
 *   Fase 3a → XML:   ExportToXML  → modelo_teste_ocaf.xml
 *   Fase 3b → STEP:  ExportToSTEP → modelo_teste_ocaf.step
 *   Fase 3c → STL:   ExportToSTL  → modelo_teste_ocaf.stl
 *
 * Roda 100% sem GUI. Código de saída: 0 = OK, 1 = falha.
 *
 * Uso:
 *   cmake --build build --config Release
 *   .\build\src\App\kernel\Release\KernelTest.exe
 */

#include <iostream>
#include <cstdlib>
#include <string>

#include "OCCTKernel.h"
#include "OCAFDocumentManager.h"
#include <BRepPrimAPI_MakeBox.hxx>

// ── helper local ─────────────────────────────────────────────────────────────
static void printSection(const std::string& title)
{
    std::cout << "\n[ " << title << " ]\n";
    std::cout << std::string(51, '-') << "\n";
}

static bool checkExport(bool ok, const std::string& name,
                         const std::string& file, const std::string& err,
                         bool& allOk)
{
    if (ok) {
        std::cout << "[OK] " << name << " exportado com sucesso para " << file << "\n";
    } else {
        std::cerr << "[FALHA] " << name << ": " << err << "\n";
        allOk = false;
    }
    return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
int main()
{
    std::cout << "===================================================\n";
    std::cout << "  OCCT Headless Kernel — Teste de Validação\n";
    std::cout << "===================================================\n";

    bool allOk = true;

    // =========================================================================
    // Fase 1 — B-Rep puro (regressão M1-M2)
    // =========================================================================
    printSection("FASE 1 — BRep Sólido Puro");

    if (OCCT_CreateTestSolid()) {
        std::cout << "[OK] BRepPrimAPI_MakeBox 10x10x10 criado.\n";
        std::cout << "[OK] BRepCheck_Analyzer: topologia válida.\n";
    } else {
        std::cerr << "[FALHA] Não foi possível criar/validar o sólido B-Rep.\n";
        allOk = false;
    }

    // =========================================================================
    // Fase 2 + 3 — OCAF + exportadores (mgr compartilhado no mesmo escopo)
    // =========================================================================
    try {
        // ── Fase 2: OCAF ───────────────────────────────────────────────────
        printSection("FASE 2 — Árvore Paramétrica OCAF");

        OCAFDocumentManager mgr;
        std::cout << "[OK] TDocStd_Application + Document (BinXCAF) criados.\n";

        // Label raiz 0:1
        TDF_Label rootLabel = mgr.getRootLabel();
        std::cout << "[OK] Label raiz: [" << OCAFDocumentManager::labelEntry(rootLabel) << "]\n";

        // Sub-label 0:1:1 + Box 10×10×10
        TDF_Label shapeLabel = mgr.newChildLabel(rootLabel);
        std::cout << "[OK] Sub-Label:  [" << OCAFDocumentManager::labelEntry(shapeLabel) << "]\n";

        BRepPrimAPI_MakeBox boxMaker(10.0, 10.0, 10.0);
        boxMaker.Build();

        if (mgr.attachShape(shapeLabel, boxMaker.Shape()) &&
            mgr.isShapeAttached(shapeLabel))
        {
            std::cout << "[OK] Box 10x10x10 mm registrada no Label via TNaming_Builder.\n";
            std::cout << "[OK] TNaming_NamedShape recuperado — Topological Naming mitigado.\n";
            std::cout << "[OK] Shape na árvore paramétrica OCAF.\n";
        } else {
            std::cerr << "[FALHA] Não foi possível registrar TNaming_NamedShape.\n";
            allOk = false;
        }

        // ── Fase 3a: XML ───────────────────────────────────────────────────
        printSection("FASE 3a — ExportToXML (XmlOcaf)");
        {
            std::string err;
            checkExport(mgr.ExportToXML("modelo_teste_ocaf.xml", err),
                        "XML", "modelo_teste_ocaf.xml", err, allOk);
        }

        // ── Fase 3b: STEP ──────────────────────────────────────────────────
        printSection("FASE 3b — ExportToSTEP (AP203/AP214)");
        {
            std::string err;
            checkExport(mgr.ExportToSTEP("modelo_teste_ocaf.step", err),
                        "STEP", "modelo_teste_ocaf.step", err, allOk);
        }

        // ── Fase 3c: STL ───────────────────────────────────────────────────
        printSection("FASE 3c — ExportToSTL (binário, δ=0.1mm)");
        {
            std::string err;
            checkExport(mgr.ExportToSTL("modelo_teste_ocaf.stl", err),
                        "STL", "modelo_teste_ocaf.stl", err, allOk);
        }

    } catch (const std::exception& ex) {
        std::cerr << "[EXCECAO] " << ex.what() << "\n";
        allOk = false;
    }

    // =========================================================================
    // Resultado final
    // =========================================================================
    std::cout << "\n===================================================\n";
    if (allOk) {
        std::cout << "[OK] OCAF configurado e arquivos XML, STEP e STL exportados com sucesso!\n";
        std::cout << "     Kernel headless + árvore paramétrica operacionais.\n";
    } else {
        std::cerr << "  RESULTADO: FALHA — verifique a saída acima.\n";
    }
    std::cout << "===================================================\n";

    return allOk ? EXIT_SUCCESS : EXIT_FAILURE;
}
