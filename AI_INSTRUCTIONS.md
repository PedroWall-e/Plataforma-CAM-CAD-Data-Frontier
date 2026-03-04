# DIRETRIZES GLOBAIS DO PROJETO: SISTEMA CAD PARAMÉTRICO HÍBRIDO E IA

## 0. Gerenciamento de Contexto e Economia de Tokens (ESTRITAMENTE OBRIGATÓRIO)
* **Regra de Ouro:** NUNCA vasculhe, leia, indexe ou proponha alterações em diretórios de dependências, binários compilados ou caches. Concentre-se APENAS no código-fonte da aplicação (`src/`, `tests/`, `docs/`).
* **Diretórios Proibidos para Leitura:**
  - `node_modules/` (Bibliotecas JS/Front-end)
  - `venv/`, `.venv/`, `env/` (Ambientes virtuais Python)
  - `__pycache__/`, `.pytest_cache/` (Arquivos de cache do Python)
  - `build/`, `dist/`, `out/` (Artefatos de compilação)
  - `.git/` (Controle de versão)
* **Extensões de Arquivos Proibidas para Leitura Textual Direta:**
  - NUNCA tente ler o conteúdo textual puro de arquivos de malha 3D ou documentos binários pesados (`*.step`, `*.iges`, `*.stl`, `*.pdf`). Eles esgotarão o limite de contexto imediatamente.
  - Arquivos compilados: `*.pyc`, `*.o`, `*.so`, `*.dll`, `*.exe`.
* Dependências devem ser inferidas via `package.json`, `requirements.txt` ou `CMakeLists.txt`. Não abra o código-fonte de pacotes de terceiros baixados.

## 1. Comportamento do Agente de IA
* **Seja Conciso:** Responda apenas com o código necessário e explicações breves.
* [cite_start]**Tipagem Estrita:** Todo código Python ou TypeScript DEVE conter tipagem estática rigorosa (Type Hints suportadas pelo Pylance) para evitar perda de contexto[cite: 110, 111]. [cite_start]Siga o padrão PEP 8 estritamente[cite: 110].

## 2. Regras de Arquitetura de Software
* [cite_start]**Separação App/Gui Obrigatória:** A lógica da aplicação primária (matemática/B-Rep) deve ser implacavelmente separada da lógica visual (GUI)[cite: 54].
* [cite_start]O diretório `App/` NUNCA deve processar interfaces ou widgets[cite: 59]. [cite_start]Toda a interface gráfica deve ficar na camada `Gui/`[cite: 60].
* [cite_start]O sistema deve suportar nativamente execução "headless" (sem instanciar a interface gráfica) para viabilizar processamentos em lote e iterações de Machine Learning no backend[cite: 65, 67].

## 3. Regras do Núcleo Geométrico (C++ / OCCT)
* [cite_start]**Kernel de Modelagem:** Utilize Open CASCADE Technology (OCCT)[cite: 8].
* [cite_start]**Persistência Paramétrica (OCAF):** Para manter a árvore de histórico paramétrico, utilize rigorosamente o paradigma do OCAF (Open CASCADE Application Framework)[cite: 11, 13, 14].
* [cite_start]**Proibido:** NUNCA anexe atributos cruciais (histórico, dependências) diretamente a topologias transitórias (faces, arestas)[cite: 14]. 
* [cite_start]**Obrigatório:** Atributos de forma devem ser anexados a "Labels" (Chaves de Referência persistentes) para evitar o problema da Nomeação Topológica (Topological Naming Problem)[cite: 14, 21].

## 4. Regras de Modelagem e Scripts (Python)
* [cite_start]**Biblioteca Oficial:** Utilize EXCLUSIVAMENTE a biblioteca `build123d` para geração topológica procedural[cite: 84, 107].
* [cite_start]**PROIBIDO O USO DE CADQUERY:** O uso da biblioteca CadQuery e de sua Fluent API (encadeamento de métodos abstratos e ocultação de estado) está estritamente BANIDO[cite: 86, 88]. [cite_start]Eles geram "alucinações de sintaxe léxica inferida" e perda de rastreio de memória[cite: 108, 109].
* **Paradigmas Permitidos no build123d:**
  1. [cite_start]*Builder Mode (Gestão Baseada em Estado):* Use gerenciadores de contexto explícitos e naturais do Python (ex: `with BuildPart():`, `with BuildSketch():`, `with BuildLine():`)[cite: 97].
  2. [cite_start]*Algebra Mode (Zero Magic State):* Para operações compostas, use operadores matemáticos nativos explícitos e limpos (ex: `obj += sub_obj`, `$Pos(X=5) * Rectangle(1, 1)`)[cite: 99, 100].

## 5. Regras do Front-end e Programação Visual (Blockly)
* [cite_start]**Interface Visual:** Utilize Google Blockly para a representação da matriz procedimental operada por nós arrastáveis[cite: 123, 125].
* [cite_start]**Proibido blocos nativos:** NÃO injete os nós genéricos e primitivos predefinidos originais do repositório Blockly cru[cite: 126]. [cite_start]Eles não possuem ontologia analítica B-Rep[cite: 126].
* [cite_start]**Obrigatório (Transpilador Customizado):** Crie blocos visuais customizados (em JSON/JS) com rigor semântico, onde o escopo e o design estético mapeiem nativamente e puramente as classes topológicas estritas do `build123d` (ex: Box, Cylinder, extrude, fillet)[cite: 136, 138, 140].
* [cite_start]O transpilador no backend (JavaScript AST) deve extrair os valores dos blocos e gerar recursivamente códigos textuais nativos em Python puro e válido[cite: 143, 144].

## 6. Regras do Módulo de IA (Engenharia Reversa de PDF para 3D)
* [cite_start]**PROIBIDO OCR VETORIAL TRADICIONAL:** Não crie heurísticas de extração de vetores soltos e linhas fragmentadas do código binário do PDF[cite: 177, 186, 187, 241]. [cite_start]A IA não deve tentar calcular junções (fechar buracos) entre coordenadas vetoriais desconexas ou lidar com ruídos de nuvem[cite: 212, 241].
* [cite_start]**Obrigatório (Vision-Language Models - VLM):** Trate o PDF como uma imagem rasterizada holística e legível humanamente[cite: 228, 229, 232].
* [cite_start]A imagem plana e global do PDF atuará como "Prompt Visual" analítico[cite: 233].
* [cite_start]A IA deve predizer e deduzir a intenção humana subjacente [cite: 248] [cite_start]e prever tokens de linguagem textuais autoregressivos redigindo as restrições paramétricas do `build123d`[cite: 235, 236].
* [cite_start]A saída final deve ser código procedimental analítico purista limitador (ex: `Rectangle(width=50, height=80)`, não vetores) resultando em modelos B-Rep de geometria estrita livres de malha (Mesh-Free)[cite: 238, 240, 243].