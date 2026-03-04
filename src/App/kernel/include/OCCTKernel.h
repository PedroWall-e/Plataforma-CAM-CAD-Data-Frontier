/**
 * @file OCCTKernel.h
 * @brief Public API do núcleo geométrico OCCT (modo estritamente headless).
 *
 * REGRAS (AI_INSTRUCTIONS.md §2 e §3):
 *   - ZERO dependências de Qt, Coin3D ou qualquer toolkit de visualização.
 *   - Toda lógica B-Rep reside aqui; a camada Gui/ consome este header via
 *     binding/wrapper Python/C — nunca inclui headers OCCT diretamente.
 *   - Atributos de forma devem ser anexados a TDF_Labels (OCAF), NUNCA
 *     diretamente a topologias transitórias (faces, arestas).
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief [Fase M1-M2] Instancia um sólido B-Rep (BRepPrimAPI_MakeBox 10x10x10)
 *        em memória e verifica validade topológica via BRepCheck_Analyzer.
 *
 * @return true  – shape criado, IsDone() == true e BRepCheck válido.
 * @return false – falha de linkagem ou OCCT ausente.
 */
bool OCCT_CreateTestSolid();

/**
 * @brief [Fase M3-M4] Valida a árvore paramétrica OCAF (Open CASCADE
 *        Application Framework) end-to-end em modo headless:
 *
 *   1. Cria TDocStd_Application + TDocStd_Document (BinXCAF, in-memory).
 *   2. Obtém o Label raiz (entry "0:1") via TDocStd_Document::Main().
 *   3. Cria um sub-Label filho (entry "0:1:1") via TDF_TagSource::NewChild().
 *   4. Gera um Box B-Rep 10x10x10 mm via BRepPrimAPI_MakeBox.
 *   5. Anexa a shape ao Label "0:1:1" usando TNaming_Builder::Generated()
 *      (TNaming_PRIMITIVE — feature original sem histórico de modificação).
 *   6. Recupera o atributo TNaming_NamedShape do Label e valida que a
 *      shape não é nula — confirma persistência paramétrica.
 *
 * @return true  – documento OCAF criado, shape registrada e recuperada OK.
 * @return false – qualquer etapa acima falhou.
 */
bool OCCT_TestOCAFDocument();

#ifdef __cplusplus
}
#endif
