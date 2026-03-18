# CavalierContours — Instalação Manual

## Baixar

1. Acesse: https://github.com/jbuckmccready/CavalierContours
2. Clone o repo ou baixe o ZIP
3. Copie a **pasta `include/cavc/`** inteira para **esta pasta**:

## Resultado esperado

```
third_party/cavalier_contours/
└── cavc/
    ├── polyline.hpp
    ├── polylinecombine.hpp
    ├── polylineoffset.hpp
    ├── staticspatialindex.hpp
    ├── vector2.hpp
    └── ... (demais .hpp)
```

## Notas

- CavalierContours é **header-only** — não há `.cpp` para compilar
- Apenas o diretório `cavc/` é necessário
- Versão testada: main branch (commit recente)
