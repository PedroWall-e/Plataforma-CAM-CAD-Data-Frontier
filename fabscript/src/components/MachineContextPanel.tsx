import React from 'react';
import { Stock } from '../engine/api/Stock';
import { Tool } from '../engine/api/Tool';

interface MachineContextPanelProps {
    stock: Stock | null;
    tools: Tool[];
}

const MachineContextPanel: React.FC<MachineContextPanelProps> = ({ stock, tools }) => {
    return (
        <div className="bg-neutral-900 border-t border-neutral-700 p-4 shrink-0 text-sm overflow-y-auto">
            <div className="flex justify-between items-start">
                {/* Stock Info */}
                <div className="flex-1 pr-4">
                    <h3 className="text-neutral-400 font-semibold mb-2 uppercase text-xs tracking-wider">Material Bruto (Stock)</h3>
                    {stock ? (
                        <div className="bg-neutral-800 rounded p-2 border border-neutral-700">
                            <div className="flex justify-between mb-1">
                                <span className="text-neutral-500">Dimensions:</span>
                                <span className="font-mono text-cyan-400">{stock.width} x {stock.height} x {stock.depth}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-neutral-600 italic">No stock defined. Use new Stock(w, h, d)</div>
                    )}
                </div>

                {/* Tools Info */}
                <div className="flex-1 pl-4 border-l border-neutral-700/50">
                    <h3 className="text-neutral-400 font-semibold mb-2 uppercase text-xs tracking-wider">Ferramentas (Tools)</h3>
                    {tools.length > 0 ? (
                        <div className="space-y-2">
                            {tools.map((col, idx) => (
                                <div key={idx} className="bg-neutral-800 rounded p-2 border border-neutral-700 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-neutral-700 px-1.5 py-0.5 rounded text-xs font-mono">{col.id}</span>
                                        <span className="text-neutral-300 font-medium">{col.name}</span>
                                    </div>
                                    <div className="flex gap-3 text-neutral-400">
                                        <span>Type: <span className="text-neutral-300">{col.type}</span></span>
                                        <span>Ø: <span className="text-cyan-400">{col.diameter}mm</span></span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-neutral-600 italic">No tools defined. Use new Tool(id, name, type, diam)</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MachineContextPanel;
