# 🚀 Roadmap: Sucessor Espiritual do Autodesk 123D Design

A nossa fundação técnica (Tauri + Rust + OpenCASCADE + Three.js) provou ser rápida, forte e segura. Agora vamos guiar este motor para reviver a visão do **Autodesk 123D Design**: modelagem 3D sólida, sem complicações, paramétrica mas disfarçada de direta (Direct Modeling), com foco em "maker" e Impressão 3D.

Aqui está a lista de features e bibliotecas essenciais a implementar:

---

## Fase 1: Fundação Interativa (Manipulation, Snap & Undo)

O coração do 123D não eram as ferramentas, mas como o usuário movia as peças pela cena e corrigia erros sem frustração.

1. **Transformações Persistentes (Drag & Drop)**
   - Conectar o evento `dragging-changed` do `TransformControls` ao comando `transform_shape` no backend Rust para gravar permanentemente a nova matriz no kernel B-Rep.
2. **Snapping Magnético 🧲 com `three-mesh-bvh`**
   - Integração da biblioteca **`three-mesh-bvh`** (Frontend / TypeScript) para criar uma Hierarquia de Volume Delimitador.
   - Isso permite ao Raycaster nativo testar intersecções em milissegundos, garantindo que o "imã" de peças (colar faces com faces) rode fluido a 60 FPS mesmo em malhas complexas.
3. **Cópia / Instanciação**
   - Alt+Drag (ou botão de clone) para duplicar o objeto selecionado.
4. **Undo / Redo Global Simplificado com `Zustand` + `zundo`**
   - Gestão de estado no frontend através do **Zustand** combinado com o middleware **zundo** para ter Undo/Redo instantâneo (Ctrl+Z).
   - O estado guarda as transformações (Matrizes e IDs). Ao dar Undo, o React apenas reencaminha a matriz anterior para o Rust/OCCT, evitando a complexidade brutal de gerir ponteiros de histórico no C++.

---

## Fases 2 e 3: Booleanas, Detalhamento e Árvore Construtiva

Primitivas isoladas transformam-se em máquinas graças ao motor OpenCASCADE (`BRepAlgoAPI` e `BRepFilletAPI`), mas precisamos deixá-las paramétricas.

1. **Unir e Subtrair**
   - Fusões (`BRepAlgoAPI_Fuse`) e furos (`BRepAlgoAPI_Cut`) perfeitos sem necessidade de libs geométricas extras.
2. **Detalhamento Fino**
   - Sistema de fillet (raios) via `BRepFilletAPI_MakeFillet` e chamfer (`BRepFilletAPI_MakeChamfer`). Seleção via Edge IDs retornado no mesh.
   - Shell (Casca) utilizando `BRepOffsetAPI_MakeThickSolid`.
3. **Árvore Construtiva Paramétrica com `petgraph`**
   - Implementar o histórico paramétrico no Backend Rust usando a biblioteca **`petgraph`** (Direted Acyclic Graph).
   - O CAD funcionará como um grafo de dependências super leve (substituindo o pesado OCAF do OCCT). Exemplo: Se o Raio do Nó B (Cilindro) muda, o Rust percorre o grafo e recalcula o Nó C (Operação Cut) on-the-fly.

---

## Fase 4: O Próximo Nível (Sketching Avançado 2D)

A transição de "juntar cubos" para "projetar peças técnicas" exige esboços 2D potentes. Esta fase integrará ferramentas nativas especializadas para lidar com perfis 2D antes de convertê-los em geometria OCCT.

1. **Planos de Trabalho (Workplanes)**
   - Grelhas de desenho (Grids) posicionáveis em qualquer face plana.
2. **Desenho 2D Mágico (Sketching com `Clipper2` e `CavalierContours`)**
   - Operações booleanas 2D rápidas e robustas em polígonos usando **Clipper2**.
   - Offsets adaptativos e fillets perfeitos para rascunhos mecânicos (com arcos exatos) utilizando o **CavalierContours**.
3. **Importação e Exportação DXF com `ezdxf`**
   - Utilização do **ezdxf** para importar perfis mecânicos com precisão para extrusão, e exportar fatias 2D para laser/CNC.
4. **Extrude (Push / Pull) e Revolve**
   - Converter os contornos fechados da fase de sketch em sólidos prismáticos / torneados no OCCT, com fusão ou corte automático dependendo da direção do Push/Pull.

---

## Fase 5: Entrega e Interface de Estúdio

Polimentos de "Frontend" para dar aparência de software pago e focar na viabilidade para impressão 3D (Makers).

1. **Materiais, Vidro e Metais**
   - Paleta de "Visual Styles" e texturas PBR aplicadas em meshs instanciadas no Three.js.
2. **Manipuladores e UI Flutuante Contextual com `Floating UI`**
   - Substituição de painéis fixos por uma UI moderna ancorada aos modelos 3D usando a biblioteca **Floating UI** (antigo Popper.js).
   - A roda/menu contextual HTML segue perfeitamente a conversão 3D→2D da câmara, mesmo no meio de pan e orbit.
3. **Exportação 3D Print Ready (Nativa OCCT)**
   - Fuga de bibliotecas duvidosas de JS e uso direto das classes padrão da indústria que já temos no kernel C++:
     - **STEP**: via `STEPControl_Writer` para compatibilidade profissional.
     - **STL**: via `StlAPI_Writer` (ou extrator `.stl` via Rust crates para evitar bloquear a UI principal).
4. **Galeria de Peças (Part Library)**
   - M3 Bolts, Rolamentos e NEMA mounts prontos a adicionar com um clique.
