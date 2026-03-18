# Clipper2 — Instalação Manual

## Baixar

1. Acesse: https://github.com/AngusJohnson/Clipper2/releases
2. Baixe o release mais recente (ex: `Clipper2_1.4.0.zip`)
3. Extraia e copie os seguintes arquivos para **esta pasta** (`third_party/clipper2/`):

## Arquivos necessários

```
third_party/clipper2/
├── clipper.h              ← CPP/Clipper2Lib/include/clipper.h
├── clipper.core.h         ← CPP/Clipper2Lib/include/clipper.core.h
├── clipper.engine.h       ← CPP/Clipper2Lib/include/clipper.engine.h
├── clipper.offset.h       ← CPP/Clipper2Lib/include/clipper.offset.h
├── clipper.rectclip.h     ← CPP/Clipper2Lib/include/clipper.rectclip.h
└── clipper.cpp            ← CPP/Clipper2Lib/src/clipper.engine.cpp
                             (renomear para clipper.cpp)
```

> **Dica rápida:** No release, os headers ficam em `CPP/Clipper2Lib/include/` 
> e o único .cpp necessário é `clipper.engine.cpp` (renomear para `clipper.cpp`).

## Versão testada
Clipper2 v1.3.x ou superior
