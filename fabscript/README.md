# FabScript — CAD/CAM Code-Driven 🛠️💻

> **"Tecnologia única como você."** — Desenvolvido pela **Data Frontier**.

FabScript é uma plataforma avançada de CAD/CAM onde o design de peças não é feito com arrastar e soltar, mas através de **código (TypeScript)**. O grande diferencial: os modelos são construídos com base nas restrições físicas das ferramentas de corte, garantindo que o que você vê na tela seja 100% fabricável em uma CNC.

---

## 🔥 Funcionalidades Principais

*   **Editor Monaco Integrado**: Experiência de desenvolvimento profissional com realce de sintaxe e detecção de erros em tempo real.
*   **Visualizador 3D em Tempo Real**: Veja a peça, o material bruto e as operações de usinagem instantaneamente utilizando Three.js.
*   **Motor de CAM Inteligente**: Cálculo automático de compensação de ferramenta (Offset 2D) e operações booleanas complexas via Web Workers.
*   **Feature-Based Machining**: Utilize comandos de alto nível como `pocket()`, `profile()` e `drill()` para remover material.
*   **Exportação G-Code**: Gere arquivos `.nc` compatíveis com Grbl/Mach3 com um único clique.

---

## 📚 Tutorial Completo

### 1. O Paradigma Code-Driven
No FabScript, você define seu ambiente de trabalho (Máquina) e então programa as ações sobre o material. O fluxo padrão é:
1. **Definir o Stock**: O bloco de material bruto.
2. **Definir as Tools**: As fresas e brocas disponíveis.
3. **Desenhar Geometrias**: Usar `Path2D` para criar contornos.
4. **Aplicar Operações**: Usinar o stock usando os paths e ferramentas.

### 2. Referência da Linguagem (API)

#### `new Stock(width, height, depth)`
Cria o bloco de material.
*   Ex: `const s = new Stock(100, 100, 20);`

#### `new Tool(id, name, type, diameter)`
Define uma ferramenta.
*   Ex: `const t1 = new Tool('T1', 'Fresa de Topo 6mm', 'flat', 6);`

#### `new Path2D()`
Cria um caminho geométrico.
*   `.moveTo(x, y)`: Move para um ponto sem desenhar.
*   `.lineTo(x, y)`: Desenha uma linha até o ponto.
*   `.arc(cx, cy, radius, startAngle, endAngle)`: Desenha um arco.
*   `.close()`: Fecha o polígono voltando ao início (Essencial para Pockets).

#### Operações de Usinagem (Métodos do Stock)
*   `s.pocket(path, { depth, tool })`: Escava o interior do polígono.
*   `s.profile(path, { depth, side, tool })`: Recorta ao longo do contorno (externo ou interno).
*   `s.drill(points, { depth, tool })`: Fura nos pontos especificados (ex: `[{x:0, y:0}]`).

---

## 💎 Peças de Exemplo

### Exemplo 1: Placa de Montagem com Furos
Uma placa simples de 100x100mm com 4 furos nos cantos e uma cavidade circular central.
```javascript
const s = new Stock(100, 100, 10);
const fresa = new Tool('T1', 'Fresa 6mm', 'flat', 6);
const broca = new Tool('T2', 'Broca 4mm', 'drill', 4);

// Cavidade Circular
const centro = new Path2D();
centro.arc(0, 0, 20, 0, Math.PI * 2);
centro.close();

s.pocket(centro, { depth: 5, tool: fresa });

// Furos nos cantos
s.drill([
  {x: 40, y: 40}, {x: -40, y: 40},
  {x: 40, y: -40}, {x: -40, y: -40}
], { depth: 10, tool: broca });

return { stock: s, tools: [fresa, broca], paths: [centro] };
```

### Exemplo 2: Recorte de Engrenagem (Perfil Externo)
```javascript
const s = new Stock(60, 60, 5);
const t = new Tool('T1', 'Fresa 3mm', 'flat', 3);

const gear = new Path2D();
// ... lógica de desenho do path ...
gear.moveTo(20, 0);
for(let i=0; i<8; i++) {
  const angle = (i/8) * Math.PI * 2;
  gear.lineTo(Math.cos(angle)*25, Math.sin(angle)*25);
  gear.lineTo(Math.cos(angle+0.1)*20, Math.sin(angle+0.1)*20);
}
gear.close();

s.profile(gear, { depth: 5, side: 'outside', tool: t });

return { stock: s, tools: [t], paths: [gear] };
```

---

## 🛠️ Tecnologias Utilizadas

*   **Frontend**: React + TypeScript + Vite.
*   **3D Engine**: Three.js + React Three Fiber.
*   **Editor**: Monaco Editor (VS Code Engine).
*   **Geometria**: Clipper Library (JS-Clipper) para Booleanas e Offsets.
*   **Processamento**: Web Workers para computação assíncrona.
*   **Icons**: Lucide React.
*   **Design**: Vanilla CSS com estética Dark Premium / Glassmorphism.

---

## 🚀 Como Rodar Localmente

1. **Instalar dependências**:
   ```bash
   npm install
   ```
2. **Rodar em modo desenvolvimento**:
   ```bash
   npm run dev
   ```
3. **Build para produção**:
   ```bash
   npm run build
   ```

---

## 📜 Licença
Projeto desenvolvido para a Plataforma **FabScript** sob a curadoria da **Data Frontier**. Uso exclusivo para demonstração técnica e prototipagem CAD/CAM.

---
**Data Frontier** — *Tecnologia única como você.*
