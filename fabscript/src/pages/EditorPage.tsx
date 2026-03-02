import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FolderClosed,
    ChevronRight,
    ChevronDown,
    Wrench,
    Play,
    Download,
    Code2,
    Layers,
    Share2,
    Save,
    PenTool,
    Cpu,
    CircleDot,
    FileCode2,
    Maximize2,
    Terminal,
    ArrowLeft
} from 'lucide-react';
import CodeEditor, { type EditorError } from '../components/CodeEditor';
import Viewer3D from '../components/Viewer3D';
import MachineContextPanel from '../components/MachineContextPanel';
import { compileCode, type CompileResult } from '../engine/compiler';
import { computeOffset, computeSolidModel } from '../engine/cam';
import { generateGCode } from '../engine/gcode';
import * as THREE from 'three';
import { occtMeshToGeometry } from '../engine/occt-bridge';

// Símbolo Original Data Frontier
const DFLogo = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 15 L85 75 L15 75 Z" />
        <path d="M50 35 L70 70 L30 70 Z" />
        <path d="M50 55 L60 67 L40 67 Z" />
    </svg>
);

const FabScriptLogo = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="20" y="20" width="60" height="60" rx="14" stroke="#3347FF" strokeWidth="8" />
        <path d="M35 65 L35 35 L65 35" stroke="#B2624F" strokeWidth="8" />
        <circle cx="65" cy="65" r="6" fill="#FFE3D6" />
    </svg>
);

interface TreeItemProps {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    children?: React.ReactNode;
    defaultOpen?: boolean;
    isActive?: boolean;
    color?: string;
}

const TreeItem = ({ icon: Icon, label, children, defaultOpen = false, isActive = false, color = 'text-[#FFE3D6]' }: TreeItemProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const hasChildren = !!children;

    return (
        <div className="select-none">
            <div
                className={`flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#1A1A1A] cursor-pointer rounded-md text-sm transition-colors ${isActive ? 'bg-[#3347FF]/10 text-[#3347FF] font-medium' : 'text-gray-300'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="w-4 h-4 flex items-center justify-center">
                    {hasChildren && (isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />)}
                </div>
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#3347FF]' : color}`} />
                <span className="truncate">{label}</span>
            </div>
            {hasChildren && isOpen && (
                <div className="ml-5 pl-2 border-l border-[#404040] mt-1 flex flex-col gap-0.5">
                    {children}
                </div>
            )}
        </div>
    );
};

const DEFAULT_CODE = `// Bem-vindo ao FabScript Fase 4 (Usinagem Feature-Based)!
// 1. Defina seu Bloco (Stock) e Ferramentas (Tools)
const s = new Stock(100, 100, 20);
const t1 = new Tool('T1', 'Fresa de Topo 6mm', 'flat', 6);

// 2. Desenhe a geometria (Caminho 2D)
const p = new Path2D();
p.moveTo(-25, -25);
p.lineTo(25, -25);
p.lineTo(25, 25);
p.lineTo(-25, 25);
p.close();

// 3. Aplique as Operações de Usinagem
s.pocket(p, { depth: 5, tool: t1 });
s.drill([{x: 10, y: 10}, {x: -10, y: 10}, {x: 0, y: -10}], { depth: 20, tool: t1 });

// Exporte o contexto da máquina
return { 
  stock: s, 
  tools: [t1], 
  paths: [p] 
};
`;

export default function EditorPage() {
    const navigate = useNavigate();
    const [code, setCode] = useState(DEFAULT_CODE);
    const [compileResult, setCompileResult] = useState<CompileResult>({
        stock: null, tools: [], paths: [], offsetPaths: [], operations: [], camStatus: 'idle'
    });
    const [solidMesh, setSolidMesh] = useState<THREE.BufferGeometry | null>(null);
    const [error, setError] = useState<EditorError | null>(null);
    const [activeTab, setActiveTab] = useState<'terminal' | 'problems'>('terminal');
    const [logs, setLogs] = useState<string[]>([
        '> FabScript Engine (Powered by Data Frontier)',
        '"Tecnologia única como você."',
        '> Pronto para compilar...',
    ]);

    // Step 1: Compile the user code (synchronous, fast)
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                const result = compileCode(code);
                setCompileResult(result);
                setError(null);
                setLogs((prev: string[]) => [...prev, `> Compilando geometria... Sucesso`, `> ${result.paths.length} caminho(s) gerado(s).`]);
            } catch (err: any) {
                // Extract line number from the error stack when available
                let line: number | undefined;
                const stackMatch = String(err.stack).match(/<anonymous>:(\d+):\d+/);
                if (stackMatch) line = parseInt(stackMatch[1], 10);
                setError({ message: err.message, line });
                setLogs((prev: string[]) => [...prev, `> [ERRO]: ${err.message}`]);
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [code]);

    // Step 2: Run CAM offset computation in Web Worker whenever paths or tools change
    useEffect(() => {
        if (compileResult.paths.length === 0 || compileResult.tools.length === 0) return;

        const radius = compileResult.tools[0].diameter / 2;
        setCompileResult((prev: CompileResult) => ({ ...prev, camStatus: 'computing' }));
        setLogs((prev: string[]) => [...prev, `> CAM: Calculando offset de ferramenta (r=${radius}mm)...`]);

        computeOffset(compileResult.paths, -radius)
            .then(offsetPaths => {
                setCompileResult((prev: CompileResult) => ({ ...prev, offsetPaths, camStatus: 'done' }));
                setLogs((prev: string[]) => [...prev, `> CAM: ${offsetPaths.length} caminho(s) compensado(s). Modelo 100% fabricável.`]);
            })
            .catch((err: Error) => {
                setCompileResult((prev: CompileResult) => ({ ...prev, camStatus: 'error' }));
                setLogs((prev: string[]) => [...prev, `> CAM [ERRO]: ${err.message}`]);
            });
    }, [compileResult.paths, compileResult.tools]);

    // Step 3: Run B-Rep solid computation via OpenCASCADE
    useEffect(() => {
        // 1. Só executa se houver stock e operações
        if (!compileResult.stock || compileResult.operations.length === 0) {
            setSolidMesh(null);
            return;
        }

        let isCancelled = false;
        setLogs((prev) => [...prev, `> B-Rep: Iniciando motor OpenCASCADE...`]);
        setCompileResult((prev) => ({ ...prev, camStatus: 'computing' }));

        // 2. [CORREÇÃO VITAL] Utilize a função computeSolidModel do cam.ts
        // Ela trata a conversão de Tool -> Radius e Path2D -> Points
        computeSolidModel(compileResult.stock, compileResult.operations)
            .then(meshData => {
                if (isCancelled) return;
                
                // 3. Converte a malha recebida do Worker para geometria do Three.js
                const geometry = occtMeshToGeometry(meshData);
                setSolidMesh(geometry);
                setCompileResult((prev) => ({ ...prev, camStatus: 'done' }));
                setLogs((prev) => [...prev, `> B-Rep: Sólido gerado com sucesso.`]);
            })
            .catch(err => {
                if (isCancelled) return;
                setCompileResult((prev) => ({ ...prev, camStatus: 'error' }));
                setLogs((prev) => [...prev, `> B-Rep [ERRO]: ${err.message}`]);
                setSolidMesh(null);
            });

        return () => {
            isCancelled = true;
            // O computeSolidModel já lida internamente com o worker.terminate()
        };
    }, [compileResult.stock, compileResult.operations]);

    // Handle G-Code generation and download
    const handleDownloadGCode = () => {
        if (compileResult.operations.length === 0) {
            setLogs((prev: string[]) => [...prev, '> ERRO: Nenhuma operação para exportar.']);
            return;
        }

        try {
            const gcode = generateGCode(compileResult.operations, compileResult.offsetPaths);
            const blob = new Blob([gcode], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'fabscript_fabrication.nc';
            a.click();
            URL.revokeObjectURL(url);

            setLogs((prev: string[]) => [...prev, `> G-Code gerado e baixado com sucesso (${gcode.split('\n').length} linhas).`]);
        } catch (err: any) {
            setLogs((prev: string[]) => [...prev, `> ERRO ao gerar G-Code: ${err.message}`]);
        }
    };

    return (
        <div className="h-screen w-full bg-[#1A1A1A] text-gray-200 flex flex-col font-sans overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

            {/* Top Header */}
            <header className="h-16 border-b border-[#404040] bg-[#2B2B2B] flex items-center justify-between px-4 shrink-0 shadow-md z-10">
                <div className="flex items-center gap-4">
                    {/* Back to home */}
                    <button onClick={() => navigate('/')} className="p-2 rounded-md hover:bg-[#1A1A1A] text-gray-400 hover:text-white transition-colors mr-1">
                        <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-3 pr-6 border-r border-[#404040]">
                        <FabScriptLogo className="w-9 h-9" />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg font-bold text-white tracking-wide leading-tight">FabScript</span>
                            <div className="flex items-center gap-1.5 text-[#FFE3D6] opacity-70 mt-0.5">
                                <span className="text-[9px] uppercase tracking-wider font-light">by</span>
                                <DFLogo className="w-3 h-3" />
                                <span className="text-[9px] font-bold tracking-widest lowercase">data frontier</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span className="hover:text-white cursor-pointer transition-colors">Projetos</span>
                        <span>/</span>
                        <span className="text-[#FFE3D6] font-medium">Suporte_Motor_v2.fabscript</span>
                        {error && <span className="w-2 h-2 rounded-full bg-[#B2624F] ml-2 shadow-[0_0_5px_#B2624F]" title={error.message} />}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#1A1A1A] rounded-md transition-colors">
                        <Save className="w-4 h-4" /> Guardar
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#1A1A1A] rounded-md transition-colors">
                        <Share2 className="w-4 h-4" /> Partilhar
                    </button>
                    <div className="w-px h-5 bg-[#404040] mx-1" />
                    <button className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold bg-[#3347FF] hover:bg-[#2838cc] text-white rounded-md transition-colors shadow-[0_0_12px_rgba(51,71,255,0.4)]">
                        <Play className="w-4 h-4" /> Compilar
                    </button>
                    <button
                        onClick={handleDownloadGCode}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold border rounded-md transition-all ${compileResult.operations.length > 0 && compileResult.camStatus !== 'computing' && compileResult.camStatus !== 'error'
                            ? 'bg-transparent border-[#B2624F] hover:bg-[#B2624F] text-[#FFE3D6] hover:text-white cursor-pointer'
                            : 'bg-transparent border-gray-600 text-gray-500 cursor-not-allowed'
                            }`}
                        disabled={compileResult.operations.length === 0 || compileResult.camStatus === 'computing' || compileResult.camStatus === 'error'}
                    >
                        <Download className="w-4 h-4" /> G-Code
                    </button>
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex-1 flex overflow-hidden">

                {/* Left Sidebar */}
                <aside className="w-60 border-r border-[#404040] bg-[#2B2B2B] flex flex-col shrink-0">
                    <div className="p-3 border-b border-[#404040]">
                        <h2 className="text-xs font-bold text-[#FFE3D6] uppercase tracking-wider opacity-70">Explorador</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                        <TreeItem icon={FolderClosed} label="Meus Projetos" color="text-[#FFE3D6]" defaultOpen>
                            <TreeItem icon={FileCode2} label="Placa_Base_CNC.ts" color="text-gray-400" />
                            <TreeItem icon={FileCode2} label="Engrenagem_Planetaria.ts" color="text-gray-400" />
                            <TreeItem icon={FileCode2} label="Suporte_Motor_v2.ts" isActive color="text-gray-400" />
                        </TreeItem>

                        <div className="my-3 border-t border-[#404040]" />

                        <div className="px-2 mb-1">
                            <span className="text-xs font-bold text-[#FFE3D6] uppercase tracking-wider opacity-60">Suporte_Motor_v2</span>
                        </div>

                        <TreeItem icon={Layers} label="Setup (Máquina)" defaultOpen color="text-gray-400">
                            <TreeItem icon={Layers} label="Material Bruto (Stock)" color="text-[#B2624F]">
                                <div className="pl-6 py-1 text-xs text-gray-500">
                                    {compileResult.stock ? `${compileResult.stock.width}x${compileResult.stock.height}x${compileResult.stock.depth}mm` : 'Não definido'}
                                </div>
                            </TreeItem>
                            <TreeItem icon={Wrench} label="Ferramentas" color="text-gray-400" defaultOpen>
                                {compileResult.tools.length > 0
                                    ? compileResult.tools.map((t: any, i: number) => (
                                        <div key={i} className="pl-6 py-1 text-xs text-gray-400 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#3347FF]" />
                                            {t.name} Ø{t.diameter}mm
                                        </div>
                                    ))
                                    : <div className="pl-6 py-1 text-xs text-gray-600 italic">Nenhuma ferramenta</div>
                                }
                            </TreeItem>
                        </TreeItem>

                        <TreeItem icon={PenTool} label="Geometria 2D" defaultOpen color="text-gray-400">
                            {compileResult.paths.map((_: any, i: number) => (
                                <TreeItem key={i} icon={CircleDot} label={`Caminho_${i + 1}`} color="text-[#FFE3D6]" />
                            ))}
                            {compileResult.paths.length === 0 && (
                                <div className="pl-6 py-1 text-xs text-gray-600 italic">Nenhum caminho</div>
                            )}
                        </TreeItem>

                        <TreeItem icon={Cpu} label="Operações (CAM)" defaultOpen color="text-gray-400">
                            {compileResult.operations.map((op: any, i: number) => (
                                <div key={i} className="pl-6 py-1 text-xs text-gray-400 flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${op.type === 'pocket' ? 'bg-[#ef4444]' : op.type === 'drill' ? 'bg-[#b91c1c]' : 'bg-[#FF6B2B]'}`} />
                                    <span className="opacity-50 w-4">{String(i + 1).padStart(2, '0')}</span>
                                    <span className="font-bold text-[#FFE3D6] uppercase tracking-wider text-[10px]">{op.type}</span>
                                    <span className="opacity-70 truncate">- {op.depth}mm ({op.tool.name})</span>
                                </div>
                            ))}
                            {compileResult.operations.length === 0 && (
                                <div className="pl-6 py-1.5 text-xs text-gray-500 italic">Nenhuma operação</div>
                            )}
                        </TreeItem>
                    </div>
                </aside>

                {/* Center Panel (Monaco Editor) */}
                <div className="flex-1 bg-[#151515] flex flex-col min-w-0 border-r border-[#404040]">
                    {/* Tab bar */}
                    <div className="h-10 bg-[#2B2B2B] border-b border-[#404040] flex items-end px-2 shrink-0">
                        <div className="flex items-center gap-2 text-sm text-[#FFE3D6] bg-[#151515] px-4 py-2 border-t-2 border-[#3347FF] rounded-t-sm">
                            <Code2 className="w-4 h-4" />
                            <span>Suporte_Motor_v2.ts</span>
                        </div>
                    </div>

                    {/* Monaco Editor */}
                    <div className="flex-1 overflow-hidden">
                        <CodeEditor value={code} onChange={setCode} error={error} />
                    </div>

                    {/* Machine Context Panel */}
                    <MachineContextPanel stock={compileResult.stock} tools={compileResult.tools} />

                    {/* Console / Terminal */}
                    <div className="h-44 border-t border-[#404040] bg-[#1A1A1A] flex flex-col shrink-0">
                        <div className="flex text-xs font-medium text-gray-400 border-b border-[#404040] bg-[#2B2B2B] shrink-0">
                            <button
                                onClick={() => setActiveTab('problems')}
                                className={`px-4 py-2 hover:text-white cursor-pointer border-b-2 transition-colors ${activeTab === 'problems' ? 'border-[#3347FF] text-[#FFE3D6] bg-[#1A1A1A]' : 'border-transparent'}`}
                            >
                                Problemas {error && <span className="ml-1 bg-red-500/20 text-red-400 rounded px-1">1</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('terminal')}
                                className={`px-4 py-2 hover:text-white cursor-pointer border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'terminal' ? 'border-[#3347FF] text-[#FFE3D6] bg-[#1A1A1A]' : 'border-transparent'}`}
                            >
                                <Terminal className="w-3 h-3" /> Terminal
                            </button>
                        </div>
                        <div className="p-3 font-mono text-xs text-gray-400 overflow-y-auto space-y-1.5 flex-1">
                            {activeTab === 'terminal' ? (
                                logs.map((log, i) => (
                                    <div key={i} className={`${log.startsWith('> FabScript') ? 'text-[#3347FF] font-bold' : log.startsWith('"') ? 'text-gray-500 italic' : log.includes('[ERRO]') ? 'text-red-400' : log.includes('Sucesso') ? 'text-[#FFE3D6]' : ''}`}>
                                        {log}
                                    </div>
                                ))
                            ) : (
                                error
                                    ? <div className="text-red-400"><span className="font-bold">● Erro{error.line ? ` (linha ${error.line})` : ''}:</span> {error.message}</div>
                                    : <div className="text-green-400">Sem problemas detectados.</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Panel (3D Viewer) */}
                <div className="w-[38%] min-w-[300px] bg-[#2B2B2B] flex flex-col relative shrink-0">
                    {/* Toolbar */}
                    <div className="absolute top-4 right-4 z-10 flex gap-2">
                        <div className="bg-[#1A1A1A]/80 backdrop-blur border border-[#404040] p-1 rounded-md flex gap-1 shadow-lg">
                            <button className="p-1.5 hover:bg-[#2B2B2B] rounded text-gray-400 hover:text-[#FFE3D6] transition-colors" title="Visão Isométrica">
                                <Layers className="w-4 h-4" />
                            </button>
                            <button className="p-1.5 hover:bg-[#2B2B2B] rounded text-gray-400 hover:text-[#FFE3D6] transition-colors" title="Visão de Topo">
                                <CircleDot className="w-4 h-4" />
                            </button>
                            <button className="p-1.5 hover:bg-[#2B2B2B] rounded text-gray-400 hover:text-[#FFE3D6] transition-colors" title="Expandir">
                                <Maximize2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* 3D Canvas */}
                    <div className="flex-1 relative overflow-hidden">
                        <Viewer3D
                            geometries={compileResult.paths}
                            stock={compileResult.stock}
                            offsetPaths={compileResult.offsetPaths}
                            operations={compileResult.operations}
                            solidMesh={solidMesh}
                        />
                    </div>

                    {/* Status Bar do Visualizador */}
                    <div className="bg-[#1A1A1A]/90 border-t border-[#404040] p-2 px-4 flex justify-between items-center text-xs text-gray-400 backdrop-blur shrink-0">
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-[#3347FF] shadow-[0_0_5px_#3347FF]" />
                                WebGL Render
                            </span>
                            <span>Paths: {compileResult.paths.length}</span>
                        </div>
                        <div className="font-mono text-[#FFE3D6]">
                            {compileResult.stock ? `${compileResult.stock.width} × ${compileResult.stock.height} × ${compileResult.stock.depth}mm` : 'Sem stock'}
                        </div>
                        {compileResult.camStatus === 'computing' && (
                            <div className="text-xs text-[#FF6B2B] animate-pulse font-mono">CAM / B-Rep ⚙ calculando...</div>
                        )}
                        {compileResult.camStatus === 'done' && (
                            <div className="text-xs text-green-400 font-mono">✓ CAM & B-Rep prontos</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
