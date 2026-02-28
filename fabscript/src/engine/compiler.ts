import { Path2D } from './api/Path2D';
import { Stock } from './api/Stock';
import { Tool } from './api/Tool';
import type { MachiningOperation } from './api/Operation';
import * as THREE from 'three';

export interface CompileResult {
    stock: Stock | null;
    tools: Tool[];
    paths: THREE.Vector3[][];
    offsetPaths: THREE.Vector3[][];  // Tool-compensated paths from CAM engine
    operations: MachiningOperation[]; // High-level feature operations
    camStatus: 'idle' | 'computing' | 'done' | 'error';
}

const EMPTY_RESULT: CompileResult = {
    stock: null,
    tools: [],
    paths: [],
    offsetPaths: [],
    operations: [],
    camStatus: 'idle',
};

/**
 * Compiles user code using new Function and returns the structured result.
 * offsetPaths are computed asynchronously by the EditorPage after this returns.
 */
export function compileCode(code: string): CompileResult {
    try {
        const runUserCode = new Function('Path2D', 'Stock', 'Tool', 'Math', `
      ${code}
    `);

        const result = runUserCode(Path2D, Stock, Tool, Math);

        if (!result) return EMPTY_RESULT;

        // Phase 1 compatibility: returning a single Path2D
        if (result instanceof Path2D) {
            return { ...EMPTY_RESULT, paths: [result.points] };
        }

        // Phase 1 compatibility: returning an array of Path2D
        if (Array.isArray(result) && result.length > 0 && result[0] instanceof Path2D) {
            return { ...EMPTY_RESULT, paths: result.map((p: any) => p.points) };
        }

        // Phase 2+: returning { stock, tools, paths }
        if (typeof result === 'object') {
            const stock = result.stock instanceof Stock ? result.stock : null;
            const tools = Array.isArray(result.tools)
                ? result.tools.filter((t: any) => t instanceof Tool)
                : [];

            let paths: THREE.Vector3[][] = [];
            if (Array.isArray(result.paths)) {
                paths = result.paths
                    .filter((p: any) => p instanceof Path2D)
                    .map((p: any) => p.points);
            }

            // Extract operations if a stock with operations is returned
            const operations = stock ? [...stock.operations] : [];

            return { stock, tools, paths, offsetPaths: [], operations, camStatus: 'idle' };
        }

        return EMPTY_RESULT;
    } catch (err) {
        throw err;
    }
}

