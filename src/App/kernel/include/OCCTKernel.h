/**
 * @file OCCTKernel.h
 * @brief Public API do núcleo geométrico OCCT (modo estritamente headless).
 *
 * REGRAS (AI_INSTRUCTIONS.md §2 e §3):
 *   - ZERO dependências de Qt, Coin3D ou qualquer toolkit de visualização.
 *   - Toda lógica B-Rep reside aqui; a camada Gui/ consome este header via
 *     binding/wrapper Python/C — nunca inclui headers OCCT diretamente.
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Instancia um sólido B-Rep (BRepPrimAPI_MakeBox 10x10x10 mm)
 *        inteiramente em memória e verifica sua validade topológica.
 *
 * Função de sanidade do ambiente de build: prova que os módulos TKernel,
 * TKBRep e TKPrim estão linkados corretamente sem abrir janela alguma.
 *
 * @return true  – shape criado e IsDone() == true (kernel OK).
 * @return false – falha de linkagem ou OCCT não encontrado.
 */
bool OCCT_CreateTestSolid();

#ifdef __cplusplus
}
#endif
