# =============================================================================
# CMakeLists.txt — Raiz do projeto Plataforma CAM/CAD Data Frontier
#
# Estrutura de build:
#   src/App/kernel  → OCCTKernel (lib estática headless) + KernelTest (exe)
#
# Estratégias para localizar OCCT (escolha UMA):
#   a) vcpkg:
#        cmake -S . -B build \
#              -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
#   b) Instalação manual da OCCT:
#        cmake -S . -B build \
#              -DOpenCASCADE_DIR="C:/OpenCASCADE/cmake"
# =============================================================================

cmake_minimum_required(VERSION 3.16)
project(PlataformaCAMCAD VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Localizar OpenCASCADE (necessário para os sub-projetos) ─────────────────
# find_package é chamado aqui para que sub-diretórios herdem o resultado.
find_package(OpenCASCADE REQUIRED)

# ── Módulo do núcleo geométrico C++/OCCT (headless) ─────────────────────────
add_subdirectory(src/App/kernel)
