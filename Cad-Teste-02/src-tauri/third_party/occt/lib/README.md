# Coloque aqui os ficheiros .lib/.dll do OpenCASCADE
# Exemplo de estrutura esperada (Windows x64):
#
#   third_party/occt/lib/
#     TKernel.lib
#     TKMath.lib
#     TKBRep.lib
#     TKG3d.lib
#     TKGeomBase.lib
#     TKGeomAlgo.lib
#     TKTopAlgo.lib
#     TKPrimAlgo.lib   ← BRepPrimAPI_MakeBox
#     TKMesh.lib       ← BRepMesh_IncrementalMesh
#     TKShHealing.lib
#     ... (outros)
#
# Opção A — vcpkg:
#   xcopy /E $env:VCPKG_ROOT\installed\x64-windows\lib\TK*.lib .\
#
# Opção B — OCCT manual:
#   <OCCT_INSTALL>/win64/vc14/lib/*.lib  →  aqui
