import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Terminal,
    Box,
    Cpu,
    Code2,
    Layers,
    CheckCircle2,
    Github,
    PlayCircle,
    Activity,
    Sun,
    Moon
} from 'lucide-react';

// Símbolo Original Data Frontier
const DFLogo = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 15 L85 75 L15 75 Z" />
        <path d="M50 35 L70 70 L30 70 Z" />
        <path d="M50 55 L60 67 L40 67 Z" />
    </svg>
);

// Logo FabScript
const FabScriptLogo = ({ className, dark }: { className?: string; dark: boolean }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="20" y="20" width="60" height="60" rx="14" stroke="#3347FF" strokeWidth="8" />
        <path d="M35 65 L35 35 L65 35" stroke="#B2624F" strokeWidth="8" />
        <circle cx="65" cy="65" r="6" fill={dark ? '#FFE3D6' : '#2B2B2B'} />
    </svg>
);

export default function LandingPage() {
    const [dark, setDark] = useState(true);
    const navigate = useNavigate();

    const c = {
        bg: dark ? '#1A1A1A' : '#FFFFFF',
        bg2: dark ? '#151515' : '#F9FAFB',
        bg3: dark ? '#2B2B2B' : '#FFFFFF',
        border: dark ? '#404040' : '#E5E7EB',
        text: dark ? '#F3F4F6' : '#2B2B2B',
        textSub: dark ? '#9CA3AF' : '#6B7280',
        navBg: dark ? 'rgba(43,43,43,0.95)' : 'rgba(255,255,255,0.95)',
        card: dark ? '#2B2B2B' : '#FFFFFF',
    };

    const phases = [
        { title: "Fase 1: Fundação CAD & Interface", desc: "Interface Split-screen (Monaco + Three.js). API Path2D básica e renderização em tempo real. O 'Motor de Código' inicial.", status: "done" },
        { title: "Fase 2: Contexto de Máquina", desc: "Introdução do Stock (Material Bruto) e Tools (Ferramentas). O CAD passa a ter restrições físicas renderizadas.", status: "done" },
        { title: "Fase 3: Motor de CAM Base", desc: "Implementação matemática em Web Workers: Tool Compensation (Offset) e Motor Booleano 2D.", status: "current" },
        { title: "Fase 4: Usinagem Feature-Based", desc: "A 'Fase de Ouro' (Usinagem 2.5D). Integração dos comandos pocket(), profile() e drill().", status: "upcoming" },
        { title: "Fase 5: Exportação G-Code & Serial", desc: "Pós-processador para converter trajetórias em G-code. Integração com Web Serial API.", status: "upcoming" }
    ];

    const features = [
        { icon: <Layers className="w-6 h-6 text-[#3347FF]" />, title: "Usinagem Baseada em Operações", desc: "Não desenha polígonos genéricos. Programa subtrações de material usando ferramentas reais." },
        { icon: <CheckCircle2 className="w-6 h-6" style={{ color: dark ? '#FFE3D6' : '#2B2B2B' }} />, title: "100% Fabricável", desc: "Como a peça é modelada pelas restrições geométricas das ferramentas, o modelo 3D é garantidamente usinável." },
        { icon: <Cpu className="w-6 h-6 text-[#B2624F]" />, title: "G-Code Instantâneo", desc: "Elimine a etapa complexa do CAM tradicional. A trajetória já é calculada na modelagem, gerando CNC de imediato." }
    ];

    return (
        <div style={{ background: c.bg, color: c.text }} className="min-h-screen font-sans">
            {/* Navbar */}
            <nav style={{ background: c.navBg, borderColor: c.border }} className="fixed w-full z-50 backdrop-blur-md border-b shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20">
                        <div className="flex items-center gap-4">
                            <FabScriptLogo className="w-10 h-10" dark={dark} />
                            <div className="flex flex-col justify-center">
                                <span className="text-xl font-bold tracking-wide leading-tight">FabScript</span>
                                <div className="flex items-center gap-1.5 opacity-70 mt-0.5" style={{ color: dark ? '#FFE3D6' : '#6B7280' }}>
                                    <span className="text-[10px] uppercase tracking-wider font-light">by</span>
                                    <DFLogo className="w-3.5 h-3.5 text-[#3347FF]" />
                                    <span className="text-[10px] font-bold tracking-widest lowercase">data frontier</span>
                                </div>
                            </div>
                        </div>
                        <div className="hidden md:flex items-center gap-6">
                            <a href="#features" style={{ color: c.textSub }} className="hover:text-[#3347FF] transition-colors text-sm font-medium">Recursos</a>
                            <a href="#stack" style={{ color: c.textSub }} className="hover:text-[#3347FF] transition-colors text-sm font-medium">Tecnologia</a>
                            <a href="#roadmap" style={{ color: c.textSub }} className="hover:text-[#3347FF] transition-colors text-sm font-medium">Roadmap</a>
                            <button onClick={() => setDark(!dark)} style={{ background: c.bg3, borderColor: c.border }} className="p-2 rounded-md border transition-colors">
                                {dark ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-gray-600" />}
                            </button>
                            <button
                                onClick={() => navigate('/editor')}
                                className="bg-[#3347FF] hover:bg-[#2838cc] text-white transition-all px-5 py-2.5 rounded-md text-sm font-bold flex items-center gap-2 shadow-[0_4px_14px_rgba(51,71,255,0.35)]"
                            >
                                <Terminal className="w-4 h-4" /> Aceder ao Editor
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero */}
            <div className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"
                    style={{
                        backgroundImage: `linear-gradient(to right, ${dark ? '#FFE3D6' : '#e5e7eb'} 1px, transparent 1px), linear-gradient(to bottom, ${dark ? '#FFE3D6' : '#e5e7eb'} 1px, transparent 1px)`,
                        backgroundSize: '4rem 4rem'
                    }}
                />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-4xl mx-auto">
                        <div
                            style={{ background: dark ? '#2B2B2B' : '#FFE3D6', borderColor: dark ? '#404040' : '#FFE3D6', color: dark ? '#FFE3D6' : '#B2624F' }}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium mb-8"
                        >
                            <Activity className="w-4 h-4 text-[#B2624F]" /> v2.0 Data Frontier Engine
                        </div>
                        <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-8">
                            A revolução do <span className="text-[#3347FF]">CAD/CAM</span><br />via código.
                        </h1>
                        <p style={{ color: c.textSub }} className="text-xl mb-10 leading-relaxed max-w-3xl mx-auto">
                            Modele as suas peças programando subtrações de material e gere <strong style={{ color: dark ? '#FFE3D6' : '#3347FF' }}>G-Code automaticamente</strong> no navegador.
                        </p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button
                                onClick={() => navigate('/editor')}
                                className="bg-[#3347FF] hover:bg-[#2838cc] text-white px-8 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all hover:scale-105 shadow-[0_8px_25px_rgba(51,71,255,0.4)]"
                            >
                                <PlayCircle className="w-5 h-5" /> Começar a Codar
                            </button>
                            <button
                                style={{ background: dark ? '#2B2B2B' : '#FFFFFF', borderColor: dark ? '#404040' : '#D1D5DB', color: dark ? '#F3F4F6' : '#2B2B2B' }}
                                className="px-8 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all border shadow-sm hover:scale-105"
                            >
                                <Github className="w-5 h-5" /> Ver no GitHub
                            </button>
                        </div>
                    </div>

                    {/* Editor Mockup */}
                    <div style={{ borderColor: c.border, background: dark ? '#151515' : '#FFFFFF' }} className="mt-20 rounded-xl overflow-hidden border shadow-2xl flex flex-col md:flex-row">
                        {/* Code Side */}
                        <div style={{ borderColor: c.border, background: dark ? '#151515' : '#FAFAFA' }} className="w-full md:w-1/2 border-b md:border-b-0 md:border-r p-6 font-mono text-sm leading-relaxed">
                            <div style={{ borderColor: c.border }} className="flex gap-2 mb-6 border-b pb-4">
                                <div className="w-3 h-3 rounded-full bg-[#B2624F]"></div>
                                <div className="w-3 h-3 rounded-full bg-[#FFE3D6]"></div>
                                <div className="w-3 h-3 rounded-full bg-[#3347FF]"></div>
                            </div>
                            <pre style={{ color: dark ? '#D1D5DB' : '#2B2B2B' }} className="overflow-x-auto text-xs sm:text-sm">
                                <code>
                                    <span className="text-[#B2624F]">import</span>{' { Stock, End Mill, Path2D } '}<span className="text-[#B2624F]">from</span> <span style={{ color: dark ? '#FFE3D6' : '#15803d' }}>'@fabscript/core'</span>;{'\n\n'}
                                    <span style={{ color: c.textSub }} className="italic">{'// 1. Definir material bruto e ferramenta'}</span>{'\n'}
                                    <span className="text-[#3347FF]">const</span> block = <span className="text-[#3347FF]">new</span> <span style={{ color: dark ? '#FFE3D6' : '#0369a1' }}>Stock</span>{'({ width: 100, length: 100, height: 20 });'}{'\n'}
                                    <span className="text-[#3347FF]">const</span> tool = <span className="text-[#3347FF]">new</span> <span style={{ color: dark ? '#FFE3D6' : '#0369a1' }}>EndMill</span>{'({ diameter: 6 });'}{'\n\n'}
                                    <span style={{ color: c.textSub }} className="italic">{'// 2. Desenhar contorno'}</span>{'\n'}
                                    <span className="text-[#3347FF]">const</span> square = <span className="text-[#3347FF]">new</span> <span style={{ color: dark ? '#FFE3D6' : '#0369a1' }}>Path2D</span>().<span className="text-[#B2624F]">rect</span>(10, 10, 80, 80);{'\n\n'}
                                    <span style={{ color: c.textSub }} className="italic">{'// 3. Operação de Usinagem'}</span>{'\n'}
                                    block.<span style={{ color: dark ? '#FFE3D6' : '#B2624F' }}>pocket</span>(square, {'{ depth: 5, tool }'});{'\n'}
                                    <span className="text-[#B2624F]">export default</span> block;
                                </code>
                            </pre>
                        </div>
                        {/* 3D Preview Side */}
                        <div style={{ background: dark ? '#2B2B2B' : '#F9FAFB' }} className="w-full md:w-1/2 p-4 relative min-h-[300px] flex items-center justify-center overflow-hidden">
                            <div
                                style={{ borderColor: dark ? '#404040' : '#E5E7EB', background: dark ? '#1A1A1A' : '#FFFFFF', color: dark ? '#D1D5DB' : '#6B7280' }}
                                className="absolute top-4 right-4 text-xs px-3 py-1.5 rounded flex items-center gap-2 border shadow-sm"
                            >
                                <span className="w-2 h-2 rounded-full bg-[#3347FF] animate-pulse"></span> Preview 3D
                            </div>
                            <div className="absolute inset-0 opacity-10" style={{
                                backgroundImage: `linear-gradient(to right, ${dark ? '#FFE3D6' : '#3347FF'} 1px, transparent 1px), linear-gradient(to bottom, ${dark ? '#FFE3D6' : '#3347FF'} 1px, transparent 1px)`,
                                backgroundSize: '2rem 2rem',
                                transform: 'rotateX(60deg) scale(2)',
                                transformOrigin: 'bottom'
                            }} />
                            <div className="relative w-48 h-48" style={{ transform: 'rotateX(30deg) rotateZ(45deg)' }}>
                                <div style={{ background: dark ? 'rgba(64,64,64,0.9)' : 'rgba(255,255,255,0.95)', borderColor: dark ? '#1A1A1A' : '#D1D5DB' }} className="absolute inset-0 border-2 shadow-2xl flex items-center justify-center">
                                    <div style={{ background: dark ? '#2B2B2B' : '#F3F4F6', borderColor: dark ? '#1A1A1A' : '#E5E7EB' }} className="absolute inset-6 border-2 shadow-inner"></div>
                                    <div className="absolute inset-4 border-[3px] border-[#3347FF] opacity-80"></div>
                                </div>
                                <div
                                    style={{ background: dark ? '#1A1A1A' : '#D1D5DB', transform: 'rotateX(90deg) skewX(45deg)', transformOrigin: 'top' }}
                                    className="absolute top-full left-0 w-full h-5 border-b border-l"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Features */}
            <div id="features" style={{ background: c.bg2, borderColor: c.border }} className="py-24 border-t">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">Porquê construir com FabScript?</h2>
                        <p style={{ color: c.textSub }} className="max-w-2xl mx-auto text-lg">O elo perdido entre o design programático e a fabricação de precisão.</p>
                    </div>
                    <div className="grid md:grid-cols-3 gap-8">
                        {features.map((f, i) => (
                            <div key={i} style={{ background: c.card, borderColor: c.border }} className="border p-8 rounded-2xl hover:border-[#3347FF]/60 hover:shadow-lg transition-all group">
                                <div style={{ background: dark ? '#1A1A1A' : '#F3F4F6', borderColor: c.border }} className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 border group-hover:bg-[#3347FF]/10 transition-colors">
                                    {f.icon}
                                </div>
                                <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                                <p style={{ color: c.textSub }} className="leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stack */}
            <div id="stack" style={{ background: dark ? '#1A1A1A' : '#FFFFFF' }} className="py-24">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col md:flex-row items-center gap-16">
                        <div className="w-full md:w-1/2">
                            <h2 className="text-3xl font-bold mb-6">Stack Tecnológica Robusta</h2>
                            <p style={{ color: c.textSub }} className="mb-8 leading-relaxed text-lg">Construído para alta performance no navegador, permitindo execuções matemáticas complexas sem bloquear a interface.</p>
                            <div className="space-y-6">
                                {[
                                    { tech: "TypeScript", desc: "Tipagem forte para o motor geométrico.", color: "text-[#3347FF]" },
                                    { tech: "React / Vite", desc: "UI reativa e build ultra-rápido offline-first.", color: "text-[#B2624F]" },
                                    { tech: "Monaco Editor", desc: "O motor do VSCode para auto-complete no browser.", color: dark ? "text-white" : "text-[#2B2B2B]" },
                                    { tech: "Three.js", desc: "Renderização WebGL leve e rápida de material e rotas.", color: "text-[#3347FF]" },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-4">
                                        <Code2 className={`w-6 h-6 mt-1 shrink-0 ${item.color}`} />
                                        <div>
                                            <strong className="text-lg">{item.tech}</strong>
                                            <span style={{ color: c.textSub }} className="block mt-1">{item.desc}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="w-full md:w-1/2">
                            <div className="grid grid-cols-2 gap-4 relative">
                                <div className="absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 blur-[80px] rounded-full" style={{ background: dark ? 'rgba(51,71,255,0.1)' : 'rgba(255,227,214,0.6)' }} />
                                {[
                                    { icon: <Terminal className="w-12 h-12 text-[#3347FF]" />, label: "Monaco" },
                                    { icon: <Box className="w-12 h-12" style={{ color: dark ? '#FFE3D6' : '#B2624F' }} />, label: "Three.js", mt: true },
                                    { icon: <Cpu className="w-12 h-12 text-[#B2624F]" />, label: "Web Workers", nmtm: true },
                                    { icon: <Layers className="w-12 h-12" style={{ color: dark ? '#D1D5DB' : '#3347FF' }} />, label: "React + Vite" },
                                ].map((item, i) => (
                                    <div key={i} style={{ background: c.card, borderColor: c.border }} className={`border p-8 rounded-xl flex flex-col items-center justify-center gap-3 aspect-square shadow-lg z-10 hover:border-[#3347FF]/50 transition-all ${item.mt ? 'mt-12' : ''} ${item.nmtm ? '-mt-12' : ''}`}>
                                        {item.icon}
                                        <span className="font-bold">{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Roadmap */}
            <div id="roadmap" style={{ background: c.bg2, borderColor: c.border }} className="py-24 border-t">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">Cronograma de Desenvolvimento</h2>
                        <p style={{ color: c.textSub }}>Roadmap incremental onde cada fase cria a base matemática para a próxima.</p>
                    </div>
                    <div className="space-y-6 relative">
                        <div className="absolute left-6 top-0 bottom-0 w-px" style={{ background: c.border }}></div>
                        {phases.map((phase, i) => (
                            <div key={i} className="flex items-start gap-6 pl-4">
                                <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 mt-1 ml-[-2px] relative z-10 ${phase.status === 'done' ? 'bg-green-500 border-green-500' : phase.status === 'current' ? 'bg-[#3347FF] border-[#3347FF] shadow-[0_0_10px_rgba(51,71,255,0.5)]' : 'border-gray-500'}`} style={{ background: phase.status === 'upcoming' ? c.bg : undefined }}>
                                    {phase.status === 'current' && <span className="absolute inset-0 rounded-full bg-[#3347FF] animate-ping opacity-40"></span>}
                                </div>
                                <div style={{ background: c.card, borderColor: c.border }} className="flex-1 border p-5 rounded-xl hover:border-[#3347FF]/50 transition-all">
                                    <span style={{ background: phase.status === 'done' ? (dark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)') : phase.status === 'current' ? 'rgba(51,71,255,0.15)' : (dark ? '#1A1A1A' : '#F3F4F6'), color: phase.status === 'done' ? '#10B981' : phase.status === 'current' ? '#3347FF' : c.textSub }} className="text-xs font-bold px-3 py-1 rounded-full inline-block mb-2">
                                        {phase.status === 'done' ? '✓ Concluído' : phase.status === 'current' ? '⚡ Em Desenvolvimento' : 'Planeado'}
                                    </span>
                                    <h3 className="text-lg font-bold mb-1">{phase.title}</h3>
                                    <p style={{ color: c.textSub }} className="text-sm leading-relaxed">{phase.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* CTA */}
            <div style={{ background: dark ? '#1A1A1A' : '#FFFFFF', borderColor: c.border }} className="py-24 border-t relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#3347FF]/10 blur-[100px] rounded-full pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#B2624F]/10 blur-[100px] rounded-full pointer-events-none" />
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                    <h2 className="text-3xl sm:text-4xl font-bold mb-6">Pronto para escrever a sua primeira peça?</h2>
                    <p style={{ color: c.textSub }} className="text-xl mb-10">Junte-se a nós. <span style={{ color: dark ? '#FFE3D6' : '#3347FF' }} className="font-semibold">Nossa força trabalhando para você.</span></p>
                    <button
                        onClick={() => navigate('/editor')}
                        className="bg-[#3347FF] hover:bg-[#2838cc] text-white px-8 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-[0_8px_25px_rgba(51,71,255,0.4)] hover:-translate-y-1 mx-auto"
                    >
                        <Terminal className="w-5 h-5" /> Abrir Web Editor
                    </button>
                </div>
            </div>

            {/* Footer */}
            <footer style={{ background: dark ? '#151515' : '#FFFFFF', borderColor: c.border }} className="border-t py-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-3">
                        <DFLogo className="w-6 h-6 text-[#3347FF]" />
                        <span className="text-lg font-bold tracking-wide">
                            <span style={{ color: c.textSub }} className="font-light">data</span> frontier
                        </span>
                    </div>
                    <p style={{ color: c.textSub }} className="text-sm">© {new Date().getFullYear()} Data Frontier. Tecnologia única como você.</p>
                    <div className="flex gap-4">
                        <a href="#" style={{ color: c.textSub }} className="hover:text-[#3347FF] transition-colors"><Github className="w-6 h-6" /></a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
