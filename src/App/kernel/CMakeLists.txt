# =============================================================================
# src/App/kernel/CMakeLists.txt  (v0.4.0)
# Núcleo geométrico OCCT — Biblioteca estática headless
#
# Módulos OCCT linkados (B-Rep + OCAF + STEP + STL — ZERO visualização):
#
#   ── B-Rep / Modelagem (M1-M2) ─────────────────────────────────────────────
#   TKernel   → tipos primitivos, handles OCCT
#   TKMath    → operações matemáticas
#   TKBRep    → estrutura topológica B-Rep
#   TKG3d     → geometria 3D (curvas, superfícies)
#   TKGeomBase→ primitivas geométricas base
#   TKGeomAlgo→ algoritmos geométricos
#   TKPrim    → primitivas B-Rep (Box, Sphere…)
#   TKTopAlgo → algoritmos topológicos
#   TKBO      → operações booleanas
#   TKMesh    → BRepMesh_IncrementalMesh (triangulação para STL)
#   TKShHealing → reparação topológica (necessário para STEP writer)
#
#   ── OCAF / Histórico Paramétrico (M3-M4) ──────────────────────────────────
#   TKCAF     → TDocStd_Application, TDocStd_Document, TDF_Label
#   TKLCAF    → TNaming_Builder, TNaming_NamedShape
#   TKCDF     → CDF persistence layer
#   TKXCAF    → XDE extended attributes
#   TKBinXCAF → serialização binária in-memory
#   TKBin     → drivers binários base
#   TKBinL    → atributos Label binários
#   TKXml     → XmlDrivers::DefineFormat — ExportToXML()
#   TKXmlL    → atributos Label XML
#
#   ── Exportadores (M5-M6) ──────────────────────────────────────────────────
#   TKSTEP      → STEPControl_Writer (orquestrador)
#   TKSTEPBase  → fundamentos do protocolo STEP
#   TKSTEPAttr  → atributos STEP
#   TKSTEP209   → entidades STEP AP209
#   TKXDESTEP   → bridge XDE ↔ STEP (XCAFDoc → STEP entities)
#   TKSTL       → StlAPI_Writer
#
# CMake 3.21+ necessário para $<TARGET_RUNTIME_DLLS:...>
# =============================================================================

cmake_minimum_required(VERSION 3.21)
project(OCCTKernel VERSION 0.4.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── 1. Localizar OpenCASCADE ──────────────────────────────────────────────────
find_package(OpenCASCADE REQUIRED)

# ── 2. Biblioteca estática do kernel ─────────────────────────────────────────
add_library(OCCTKernel STATIC
    src/OCCTKernel.cpp           # M1-M2: B-Rep puro
    src/OCAFDocumentManager.cpp  # M3-M6: OCAF + XML + STEP + STL
)

target_include_directories(OCCTKernel
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${OpenCASCADE_INCLUDE_DIR}
)

target_link_libraries(OCCTKernel
    PRIVATE
        # ── B-Rep / Modelagem ────────────────────────────────────────────────
        TKernel
        TKMath
        TKG2d
        TKG3d
        TKGeomBase
        TKGeomAlgo
        TKBRep
        TKPrim
        TKTopAlgo
        TKBO
        TKMesh        # BRepMesh_IncrementalMesh (triangulação → STL)
        TKShHealing   # ShapeFix (usado pelo DE writer)
        # ── OCAF / Histórico Paramétrico ─────────────────────────────────────
        TKCAF
        TKLCAF
        TKCDF
        TKXCAF
        TKBinXCAF
        TKBin
        TKBinL
        TKXml         # ExportToXML()
        TKXmlL
        # ── Data Exchange OCCT 7.6+ (TKDE — nomenclatura unificada) ──────────
        # TKSTEP/TKSTEPBase/TKSTEPAttr/TKSTEP209/TKXDESTEP → TKDE + TKDESTEP
        # TKSTL                                             → TKDESTL
        TKDE          # orquestrador Data Exchange
        TKDESTEP      # ExportToSTEP() — AP203/AP214
        TKDESTL       # ExportToSTL()
)


# ── 3. Executável de validação headless ──────────────────────────────────────
add_executable(KernelTest
    tests/test_kernel.cpp
)

target_include_directories(KernelTest
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${OpenCASCADE_INCLUDE_DIR}
)

target_link_libraries(KernelTest
    PRIVATE
        OCCTKernel
)

# ── 4. Cópia automática de DLLs no Windows (POST_BUILD) ──────────────────────
#
# Três estratégias (primeira que encontrar DLLs "vence"):
#   [A] Conda  — $ENV{CONDA_PREFIX}/Library/bin/TK*.dll  ← estratégia primária
#   [B] vcpkg  — $<TARGET_RUNTIME_DLLS:KernelTest>       ← fallback automático
#   [C] Manual — OpenCASCADE_BINARY_DIR/*.dll             ← fallback glob
#
if(WIN32)

    # ── [A] Conda (estratégia primária) ──────────────────────────────────────
    # O Conda instala as DLLs do OCCT em %CONDA_PREFIX%\Library\bin.
    # Fazemos glob de TK*.dll para selecionar APENAS as DLLs do OpenCASCADE,
    # sem arrastar DLLs de outras bibliotecas do ambiente (freetype, zlib, etc.)
    # que o Windows já consegue resolver via PATH do Conda.
    set(CONDA_BIN "$ENV{CONDA_PREFIX}/Library/bin")

    if(EXISTS "${CONDA_BIN}")
        file(GLOB CONDA_OCCT_DLLS "${CONDA_BIN}/TK*.dll")

        if(CONDA_OCCT_DLLS)
            message(STATUS "  DLL source     : Conda → ${CONDA_BIN}")
            message(STATUS "  DLLs OCCT      : ${CONDA_OCCT_DLLS}")

            add_custom_command(TARGET KernelTest POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E echo
                    "-- [DLL/Conda] Copiando ${CONDA_BIN}/TK*.dll → $<TARGET_FILE_DIR:KernelTest>"
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    ${CONDA_OCCT_DLLS}
                    $<TARGET_FILE_DIR:KernelTest>
                COMMENT "POST_BUILD: copiando TK*.dll do Conda"
            )
        else()
            message(WARNING
                "  [DLL] CONDA_PREFIX encontrado (${CONDA_BIN}) mas nenhum TK*.dll localizado."
                " Verifique: conda install -c conda-forge opencascade")
        endif()

    else()
        # ── [B] vcpkg — TARGET_RUNTIME_DLLS (CMake ≥ 3.21) ──────────────────
        # Resolve automaticamente TODAS as DLLs de targets SHARED importados
        # transitivamente linkados a KernelTest. Exige COMMAND_EXPAND_LISTS.
        message(STATUS "  DLL source     : TARGET_RUNTIME_DLLS (vcpkg / sem Conda)")

        add_custom_command(TARGET KernelTest POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E echo
                "-- [DLL/vcpkg] Copiando DLLs runtime → $<TARGET_FILE_DIR:KernelTest>"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_RUNTIME_DLLS:KernelTest>
                $<TARGET_FILE_DIR:KernelTest>
            COMMAND_EXPAND_LISTS
            COMMENT "POST_BUILD: copiando DLLs OCCT (TARGET_RUNTIME_DLLS)"
        )

        # ── [C] Fallback manual — OpenCASCADE_BINARY_DIR ─────────────────────
        if(DEFINED OpenCASCADE_BINARY_DIR AND EXISTS "${OpenCASCADE_BINARY_DIR}")
            file(GLOB OCCT_DLLS "${OpenCASCADE_BINARY_DIR}/TK*.dll")
            if(OCCT_DLLS)
                add_custom_command(TARGET KernelTest POST_BUILD
                    COMMAND ${CMAKE_COMMAND} -E copy_if_different
                        ${OCCT_DLLS} $<TARGET_FILE_DIR:KernelTest>
                    COMMENT "POST_BUILD: copiando DLLs (OpenCASCADE_BINARY_DIR fallback)"
                )
                message(STATUS "  DLL fallback   : ${OpenCASCADE_BINARY_DIR}")
            endif()
        endif()

    endif() # EXISTS CONDA_BIN

endif() # WIN32

# ── 5. Status ─────────────────────────────────────────────────────────────────
message(STATUS "")
message(STATUS "=== OCCTKernel Configurado (v0.4.0) ===")
message(STATUS "  OCCT version   : ${OpenCASCADE_VERSION}")
message(STATUS "  OCCT includes  : ${OpenCASCADE_INCLUDE_DIR}")
message(STATUS "  Modo headless  : SIM (sem TKOpenGl/TKV3d/TKService)")
message(STATUS "  Exportadores   : XML + STEP (AP203/AP214) + STL")
message(STATUS "  DLL auto-copy  : ${WIN32}")
message(STATUS "  Alvo de teste  : KernelTest")
message(STATUS "")
