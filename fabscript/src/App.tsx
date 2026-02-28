import { useState, useEffect } from 'react';
import CodeEditor from './components/CodeEditor';
import Viewer3D from './components/Viewer3D';
import MachineContextPanel from './components/MachineContextPanel';
import { compileCode, type CompileResult } from './engine/compiler';

const DEFAULT_CODE = `// Bem-vindo ao FabScript Fase 2!
// Defina seu Bloco (Stock) e Ferramentas (Tools)
const s = new Stock(100, 100, 20);
const t1 = new Tool('T1', 'Fresa de Topo 6mm', 'flat', 6);

// Desenhe a geometria base
const p = new Path2D();
p.moveTo(-25, -25);
p.lineTo(25, -25);
p.lineTo(25, 25);
p.lineTo(-25, 25);
p.lineTo(-25, -25);

// Exporte o contexto da máquina e geometrias
return { 
  stock: s, 
  tools: [t1], 
  paths: [p] 
};
`;

function App() {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [compileResult, setCompileResult] = useState<CompileResult>({ stock: null, tools: [], paths: [], offsetPaths: [], operations: [], camStatus: 'idle' });
  const [error, setError] = useState<string | null>(null);

  // Debounce the compiler execution
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const result = compileCode(code);
        setCompileResult(result);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [code]);

  return (
    <div className="flex h-screen w-full bg-neutral-900 text-white font-sans overflow-hidden">
      {/* Left Panel: Code Editor */}
      <div className="w-1/2 h-full flex flex-col border-r border-neutral-700">
        <div className="h-12 flex items-center px-4 bg-neutral-800 border-b border-neutral-700 font-semibold shadow-sm">
          <span>FabScript Editor</span>
        </div>

        <div className="flex-grow relative">
          <CodeEditor value={code} onChange={setCode} />
        </div>

        {/* Machine Context Info */}
        <MachineContextPanel stock={compileResult.stock} tools={compileResult.tools} />

        {/* Console / Error output */}
        <div className="h-28 shrink-0 bg-neutral-950 p-3 overflow-y-auto font-mono text-sm">
          {error ? (
            <div className="text-red-400">
              <span className="font-bold">Error:</span> {error}
            </div>
          ) : (
            <div className="text-green-400">
              [Compiler] Build successful. Rendering...
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: 3D Viewer */}
      <div className="w-1/2 h-full flex flex-col relative bg-neutral-800">
        <div className="absolute top-4 left-4 z-10 bg-neutral-900/80 px-3 py-1 rounded text-sm shadow">
          {compileResult.paths.length > 0 ? "Rendering Output" : "Idle"}
        </div>
        <Viewer3D
          geometries={compileResult.paths}
          stock={compileResult.stock}
          operations={compileResult.operations}
        />
      </div>
    </div>
  );
}

export default App;
