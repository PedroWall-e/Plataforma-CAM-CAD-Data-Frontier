# =============================================================================
# src/App/kernel/CMakeLists.txt
# Núcleo geométrico OCCT — Biblioteca estática headless
#
# Módulos OCCT linkados (apenas B-Rep / Modelagem — ZERO visualização):
#   TKernel   → tipos primitivos e sistema de handles OCCT
#   TKMath    → operações matemáticas geométricas
#   TKBRep    → estrutura de dados B-Rep topológica
#   TKPrim    → primitivas geométricas (Box, Sphere, Cone…)
#   TKTopAlgo → algoritmos topológicos
#   TKBO      → operações booleanas B-Rep
# =============================================================================

cmake_minimum_required(VERSION 3.16)
project(OCCTKernel VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── 1. Localizar OpenCASCADE ──────────────────────────────────────────────────
# Estratégias suportadas (em ordem de prioridade):
#   a) vcpkg:  passe -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
#   b) Manual: passe -DOpenCASCADE_DIR=<OCCT_ROOT>/cmake
find_package(OpenCASCADE REQUIRED)

# ── 2. Biblioteca estática do kernel ─────────────────────────────────────────
add_library(OCCTKernel STATIC
    src/OCCTKernel.cpp
)

target_include_directories(OCCTKernel
    PUBLIC
        # Header público da nossa API
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        # Headers internos OCCT (não expõe transitivamente)
        ${OpenCASCADE_INCLUDE_DIR}
)

# Apenas módulos B-Rep / modelagem — SEM TKOpenGl, TKV3d, TKService, etc.
target_link_libraries(OCCTKernel
    PRIVATE
        TKernel
        TKMath
        TKBRep
        TKPrim
        TKTopAlgo
        TKBO
)

# ── 3. Executável de validação headless ──────────────────────────────────────
add_executable(KernelTest
    tests/test_kernel.cpp
)

target_include_directories(KernelTest
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(KernelTest
    PRIVATE
        OCCTKernel
)

# ── 4. Mensagem de confirmação em tempo de configuração ──────────────────────
message(STATUS "")
message(STATUS "=== OCCTKernel Configurado ===")
message(STATUS "  OCCT version   : ${OpenCASCADE_VERSION}")
message(STATUS "  OCCT includes  : ${OpenCASCADE_INCLUDE_DIR}")
message(STATUS "  Modo headless  : SIM (sem TKOpenGl/TKV3d/TKService)")
message(STATUS "  Alvo de teste  : KernelTest")
message(STATUS "")
