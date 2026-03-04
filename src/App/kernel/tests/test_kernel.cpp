/**
 * @file test_kernel.cpp
 * @brief Executável de validação headless do núcleo OCCT.
 *
 * Roda 100% sem interface gráfica. Saída via stdout apenas.
 * Código de saída:  0 (EXIT_SUCCESS) → kernel OK
 *                   1 (EXIT_FAILURE)  → falha de linkagem / OCCT ausente
 *
 * Uso:
 *   cmake --build build --config Release
 *   ./build/src/App/kernel/Release/KernelTest.exe
 */

#include <iostream>
#include <cstdlib>

#include "OCCTKernel.h"

int main()
{
    std::cout << "=== OCCT Headless Kernel — Teste de Validação ===" << std::endl;

    const bool ok = OCCT_CreateTestSolid();

    if (ok) {
        std::cout << "[OK] OCCT BRep solid criado e verificado com sucesso."
                  << std::endl;
        std::cout << "     Kernel headless operacional." << std::endl;
        return EXIT_SUCCESS;
    } else {
        std::cerr << "[FALHA] Não foi possível criar o sólido B-Rep."         << std::endl;
        std::cerr << "        Verifique a instalação do OCCT e o CMakeLists." << std::endl;
        return EXIT_FAILURE;
    }
}
