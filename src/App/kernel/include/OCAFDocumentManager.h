/**
 * @file OCAFDocumentManager.h
 * @brief Gerenciador da árvore paramétrica OCAF (Open CASCADE Application Framework).
 *
 * REGRAS (AI_INSTRUCTIONS.md §3):
 *   - Encapsula TDocStd_Application e TDocStd_Document.
 *   - Atributos de forma são anexados a TDF_Labels — NUNCA diretamente
 *     a topologias transitórias (faces, arestas).
 *   - ZERO dependências de Qt, Coin3D ou qualquer toolkit de visualização.
 *   - Persistência em XML (XmlOcaf), STEP (AP203/AP214) e STL (binário).
 *
 * Arquitetura de Labels:
 *   0        → Root TDF_Data
 *   0:1      → Documento (Label raiz retornado por getRootLabel())
 *   0:1:1    → Primeiro sólido primitivo (Box de referência)
 *   0:1:N    → Próximas features paramétricas
 */
#pragma once

// ── OCCT: Framework OCAF ──────────────────────────────────────────────────────
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TDF_Label.hxx>

// ── OCCT: Topologia B-Rep ─────────────────────────────────────────────────────
#include <TopoDS_Shape.hxx>

// ── Stdlib ────────────────────────────────────────────────────────────────────
#include <string>

/**
 * @class OCAFDocumentManager
 * @brief Encapsula o ciclo de vida do documento OCAF e fornece
 *        operações de escrita/leitura de formas B-Rep via Labels,
 *        além de exportadores industriais (XML, STEP, STL).
 *
 * Uso típico:
 * @code
 *   OCAFDocumentManager mgr;
 *   TDF_Label root  = mgr.getRootLabel();           // 0:1
 *   TDF_Label shape = mgr.newChildLabel(root);       // 0:1:1
 *   mgr.attachShape(shape, myBox);
 *   mgr.ExportToSTEP("modelo.step", err);
 *   mgr.ExportToSTL  ("modelo.stl",  err);
 *   mgr.ExportToXML  ("modelo.xml",  err);
 * @endcode
 */
class OCAFDocumentManager
{
public:
    /**
     * @brief Construtor — inicializa TDocStd_Application e cria um
     *        novo TDocStd_Document em memória (formato "BinXCAF").
     * @throws std::runtime_error se o documento não puder ser criado.
     */
    OCAFDocumentManager();

    /// Destrutor — libera o documento do framework.
    ~OCAFDocumentManager();

    OCAFDocumentManager(const OCAFDocumentManager&)            = delete;
    OCAFDocumentManager& operator=(const OCAFDocumentManager&) = delete;

    // ── Gestão de Labels ────────────────────────────────────────────────────

    /** @brief Retorna o Label raiz do documento (entry "0:1"). */
    TDF_Label getRootLabel() const;

    /**
     * @brief Cria novo Label filho via TDF_TagSource (tag única e persistente).
     * @param parent Label pai.
     * @return Novo TDF_Label filho.
     */
    TDF_Label newChildLabel(const TDF_Label& parent);

    // ── Gestão de Shapes (anti-TNP) ─────────────────────────────────────────

    /**
     * @brief Anexa @p shape ao @p label via TNaming_Builder::Generated().
     *        Mitiga o Topological Naming Problem: a shape é rastreada pelo
     *        Label, não pela referência topológica transitória.
     * @return true se gravado com sucesso; false se shape ou label nulos.
     */
    bool attachShape(const TDF_Label& label, const TopoDS_Shape& shape);

    /**
     * @brief Recupera a shape do @p label via TNaming_NamedShape.
     * @return Shape associada, ou TopoDS_Shape() nula se não existir.
     */
    TopoDS_Shape getShape(const TDF_Label& label) const;

    /** @brief true se TNaming_NamedShape existir e shape não for nula. */
    bool isShapeAttached(const TDF_Label& label) const;

    // ── Exportadores industriais ─────────────────────────────────────────────

    /**
     * @brief Exporta a árvore OCAF para XML (XmlOcaf).
     *        Legível por IA e ferramentas de diff.
     * @param filepath Caminho de saída (ex: "modelo_teste_ocaf.xml").
     * @param outError Mensagem de erro em caso de falha.
     * @return true se sucesso, false se falha.
     */
    bool ExportToXML(const std::string& filepath, std::string& outError);

    /**
     * @brief Exporta todos os shapes do documento para STEP AP203/AP214.
     *        Usa STEPControl_Writer — formato padrão de intercâmbio industrial.
     * @param filepath Caminho de saída (ex: "modelo_teste_ocaf.step").
     * @param outError Mensagem de erro em caso de falha.
     * @return true se sucesso, false se falha.
     */
    bool ExportToSTEP(const std::string& filepath, std::string& outError);

    /**
     * @brief Triangula e exporta todos os shapes para STL binário.
     *        Usa BRepMesh_IncrementalMesh + StlAPI_Writer.
     *        Resultado consumível diretamente pelo visualizador WebGL futuro.
     * @param filepath    Caminho de saída (ex: "modelo_teste_ocaf.stl").
     * @param outError    Mensagem de erro em caso de falha.
     * @param linearDefl  Deflexão linear da triangulação (padrão: 0.1 mm).
     * @param angularDefl Deflexão angular em radianos (padrão: 0.5 rad).
     * @return true se sucesso, false se falha.
     */
    bool ExportToSTL(const std::string& filepath,
                     std::string&       outError,
                     double             linearDefl  = 0.1,
                     double             angularDefl = 0.5);

    // ── Utilitários ──────────────────────────────────────────────────────────

    /** @brief Converte Label para string "0:1:1" para logging headless. */
    static std::string labelEntry(const TDF_Label& label);

private:
    Handle(TDocStd_Application) m_app;  ///< Singleton do framework OCAF
    Handle(TDocStd_Document)    m_doc;  ///< Documento in-memory ativo

    /** @brief Coleta todos os TopoDS_Shape válidos dos Labels da árvore. */
    void collectShapes_(std::vector<TopoDS_Shape>& out) const;
};
