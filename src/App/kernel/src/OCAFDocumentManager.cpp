/**
 * @file OCAFDocumentManager.cpp
 * @brief Implementação do gerenciador OCAF — headless, sem visualização.
 *
 * Módulos OCCT utilizados:
 *   TKCAF / TKLCAF / TKCDF   → framework OCAF, Labels, TNaming
 *   TKBinXCAF                → NewDocument() in-memory
 *   TKXml / TKXmlL           → ExportToXML() via SaveAs
 *   TKSTEP / TKSTEPBase      → ExportToSTEP() via STEPControl_Writer
 *   TKSTEPAttr / TKSTEP209   → atributos e entidades STEP
 *   TKXDESTEP                → bridge XDE ↔ STEP
 *   TKSTL                    → ExportToSTL() via StlAPI_Writer
 *   TKMesh                   → BRepMesh_IncrementalMesh (triangulação)
 */

#include "OCAFDocumentManager.h"

// ── OCCT: Framework OCAF ───────────────────────────────────────────────────
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TDF_Label.hxx>
#include <TDF_TagSource.hxx>
#include <TDF_Tool.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_ChildIterator.hxx>

// ── OCCT: Nomeação Topológica (anti-TNP) ───────────────────────────────────
#include <TNaming_Builder.hxx>
#include <TNaming_NamedShape.hxx>

// ── OCCT: Formatos de persistência ─────────────────────────────────────────
#include <BinXCAFDrivers.hxx>     // NewDocument("BinXCAF")
#include <XmlDrivers.hxx>         // ExportToXML
#include <PCDM_StoreStatus.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TCollection_AsciiString.hxx>

// ── OCCT: STEP  ────────────────────────────────────────────────────────────
#include <STEPControl_Writer.hxx>
#include <STEPControl_StepModelType.hxx>
#include <IFSelect_ReturnStatus.hxx>

// ── OCCT: STL + Triangulação ───────────────────────────────────────────────
#include <BRepMesh_IncrementalMesh.hxx>
#include <StlAPI_Writer.hxx>
#include <TopoDS_Compound.hxx>
#include <BRep_Builder.hxx>

// ── OCCT: Iteração sobre shapes no documento ───────────────────────────────
#include <TopoDS_Iterator.hxx>

// ── Stdlib ─────────────────────────────────────────────────────────────────
#include <stdexcept>
#include <vector>
#include <sstream>

// ═══════════════════════════════════════════════════════════════════════════
// Construtor
// ═══════════════════════════════════════════════════════════════════════════
OCAFDocumentManager::OCAFDocumentManager()
{
    m_app = new TDocStd_Application();
    BinXCAFDrivers::DefineFormat(m_app);  // NewDocument("BinXCAF")
    XmlDrivers::DefineFormat(m_app);      // ExportToXML

    m_app->NewDocument("BinXCAF", m_doc);

    if (m_doc.IsNull()) {
        throw std::runtime_error(
            "[OCAFDocumentManager] Falha ao criar TDocStd_Document (BinXCAF)."
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Destrutor
// ═══════════════════════════════════════════════════════════════════════════
OCAFDocumentManager::~OCAFDocumentManager()
{
    if (!m_doc.IsNull() && !m_app.IsNull()) {
        m_app->Close(m_doc);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// getRootLabel — entry "0:1"
// ═══════════════════════════════════════════════════════════════════════════
TDF_Label OCAFDocumentManager::getRootLabel() const
{
    return m_doc->Main();
}

// ═══════════════════════════════════════════════════════════════════════════
// newChildLabel — tag única via TDF_TagSource
// ═══════════════════════════════════════════════════════════════════════════
TDF_Label OCAFDocumentManager::newChildLabel(const TDF_Label& parent)
{
    return TDF_TagSource::NewChild(parent);
}

// ═══════════════════════════════════════════════════════════════════════════
// attachShape — registra shape no Label via TNaming_Builder
// ═══════════════════════════════════════════════════════════════════════════
bool OCAFDocumentManager::attachShape(const TDF_Label&   label,
                                      const TopoDS_Shape& shape)
{
    if (label.IsNull() || shape.IsNull()) { return false; }

    // TNaming_Builder é a única forma correta de associar shape a Label (§3).
    // Generated() → feature primitiva original (sem histórico de modificação).
    TNaming_Builder builder(label);
    builder.Generated(shape);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// getShape — recupera shape do Label via TNaming_NamedShape
// ═══════════════════════════════════════════════════════════════════════════
TopoDS_Shape OCAFDocumentManager::getShape(const TDF_Label& label) const
{
    Handle(TNaming_NamedShape) ns;
    if (!label.FindAttribute(TNaming_NamedShape::GetID(), ns)) {
        return TopoDS_Shape();
    }
    return ns->Get();
}

// ═══════════════════════════════════════════════════════════════════════════
// isShapeAttached
// ═══════════════════════════════════════════════════════════════════════════
bool OCAFDocumentManager::isShapeAttached(const TDF_Label& label) const
{
    return !getShape(label).IsNull();
}

// ═══════════════════════════════════════════════════════════════════════════
// collectShapes_ — itera a árvore TDF e coleta todos os shapes válidos
// ═══════════════════════════════════════════════════════════════════════════
void OCAFDocumentManager::collectShapes_(std::vector<TopoDS_Shape>& out) const
{
    TDF_ChildIterator it(getRootLabel(), /*allLevels=*/Standard_True);
    for (; it.More(); it.Next()) {
        TopoDS_Shape s = getShape(it.Value());
        if (!s.IsNull()) {
            out.push_back(s);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ExportToXML — persiste árvore TDF em XML legível por IA
// ═══════════════════════════════════════════════════════════════════════════
bool OCAFDocumentManager::ExportToXML(const std::string& filepath,
                                      std::string&       outError)
{
    if (m_doc.IsNull() || m_app.IsNull()) {
        outError = "Documento OCAF não inicializado.";
        return false;
    }

    TCollection_ExtendedString xmlPath(filepath.c_str(), Standard_True);
    PCDM_StoreStatus status = m_app->SaveAs(m_doc, xmlPath);

    if (status != PCDM_SS_OK) {
        switch (status) {
            case PCDM_SS_DriverFailure:
                outError = "Driver XML falhou (PCDM_SS_DriverFailure)."; break;
            case PCDM_SS_WriteFailure:
                outError = "Falha de escrita (PCDM_SS_WriteFailure)."; break;
            default:
                outError = "Falha genérica SaveAs (PCDM_SS_Failure)."; break;
        }
        return false;
    }
    outError.clear();
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ExportToSTEP — exporta shapes para STEP AP203/AP214
// ═══════════════════════════════════════════════════════════════════════════
bool OCAFDocumentManager::ExportToSTEP(const std::string& filepath,
                                       std::string&       outError)
{
    // ── 1. Coletar shapes da árvore OCAF ─────────────────────────────────
    std::vector<TopoDS_Shape> shapes;
    collectShapes_(shapes);

    if (shapes.empty()) {
        outError = "Nenhuma shape encontrada na árvore OCAF para exportar.";
        return false;
    }

    // ── 2. Configurar STEPControl_Writer ─────────────────────────────────
    //    AsIs → preserva o tipo de shape exato (Solid, Shell, etc.)
    //    ManifoldSolidBrep é o mapeamento natural de TopoDS_Solid → STEP.
    STEPControl_Writer writer;
    writer.Model(/*newone=*/Standard_True); // documento STEP limpo

    for (const TopoDS_Shape& shape : shapes) {
        IFSelect_ReturnStatus ret =
            writer.Transfer(shape, STEPControl_AsIs);

        if (ret != IFSelect_RetDone) {
            std::ostringstream oss;
            oss << "STEPControl_Writer::Transfer falhou (ret=" << ret << ").";
            outError = oss.str();
            return false;
        }
    }

    // ── 3. Gravar arquivo .step ──────────────────────────────────────────
    IFSelect_ReturnStatus writeRet = writer.Write(filepath.c_str());
    if (writeRet != IFSelect_RetDone) {
        std::ostringstream oss;
        oss << "STEPControl_Writer::Write falhou (ret=" << writeRet
            << "). Verifique permissões no diretório.";
        outError = oss.str();
        return false;
    }

    outError.clear();
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ExportToSTL — triangula shapes e exporta para STL binário
// ═══════════════════════════════════════════════════════════════════════════
bool OCAFDocumentManager::ExportToSTL(const std::string& filepath,
                                      std::string&       outError,
                                      double             linearDefl,
                                      double             angularDefl)
{
    // ── 1. Coletar shapes da árvore OCAF ─────────────────────────────────
    std::vector<TopoDS_Shape> shapes;
    collectShapes_(shapes);

    if (shapes.empty()) {
        outError = "Nenhuma shape encontrada na árvore OCAF para exportar.";
        return false;
    }

    // ── 2. Compor todas as shapes em um único Compound ───────────────────
    //    StlAPI_Writer aceita um único TopoDS_Shape; Compound agrega todas.
    BRep_Builder builder;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    for (const TopoDS_Shape& s : shapes) {
        builder.Add(compound, s);
    }

    // ── 3. Triangulação incremental (BRepMesh_IncrementalMesh) ───────────
    //    Gera a malha poligonal armazenada na própria shape (não persistida).
    //    linearDefl  = tamanho máximo de aresta do triângulo em mm.
    //    angularDefl = ângulo máximo entre normais de triângulos adjacentes.
    BRepMesh_IncrementalMesh mesher(compound, linearDefl,
                                    /*isRelative=*/Standard_False,
                                    angularDefl,
                                    /*isParallel=*/Standard_True);
    mesher.Perform();

    if (!mesher.IsDone()) {
        outError = "BRepMesh_IncrementalMesh::Perform() falhou.";
        return false;
    }

    // ── 4. Gravar arquivo .stl (binário) ────────────────────────────────
    StlAPI_Writer stlWriter;
    stlWriter.ASCIIMode() = Standard_False; // binário (menor, mais rápido)

    if (!stlWriter.Write(compound, filepath.c_str())) {
        outError = "StlAPI_Writer::Write falhou. Verifique permissões no diretório.";
        return false;
    }

    outError.clear();
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// labelEntry — "0:1:1"
// ═══════════════════════════════════════════════════════════════════════════
std::string OCAFDocumentManager::labelEntry(const TDF_Label& label)
{
    if (label.IsNull()) { return "<null>"; }
    TCollection_AsciiString entry;
    TDF_Tool::Entry(label, entry);
    return std::string(entry.ToCString());
}
