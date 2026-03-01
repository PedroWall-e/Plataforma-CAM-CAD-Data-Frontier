// CAM Web Worker (FabScript 2.0)
// Handles:
//   1. 2D polygon offsets and booleans via js-clipper (Phase 3 - unchanged)
//   2. 3D solid boolean modeling via OpenCASCADE.js WASM (Phase 2 addition)
//
// All heavy computation runs here, off the main thread.

import ClipperLib from 'js-clipper';
import { CLIPPER_SCALE } from '../geometry';
import type { ClipperPoint } from '../geometry';

// ─── Phase 3: 2D Path types (unchanged) ─────────────────────────────────────
export type BooleanOp = 'DIFFERENCE' | 'UNION' | 'INTERSECTION';

export interface OffsetRequest {
    type: 'OFFSET';
    paths: ClipperPoint[][];
    delta: number;
}

export interface BooleanRequest {
    type: 'BOOLEAN';
    subjectPaths: ClipperPoint[][];
    clipPaths: ClipperPoint[][];
    op: BooleanOp;
}

export interface WorkerResponse {
    paths: ClipperPoint[][];
    error?: string;
}

// ─── Phase 2: B-Rep Solid types ─────────────────────────────────────────────
export interface SolidPocketOp {
    type: 'pocket';
    points: { x: number; y: number }[];
    depth: number;
    tool: { name: string };
}

export interface SolidDrillOp {
    type: 'drill';
    points: { x: number; y: number }[];
    depth: number;
    radius: number;
    tool: { name: string };
}

export type SolidOp = SolidPocketOp | SolidDrillOp;

export interface SolidModelRequest {
    type: 'SOLID_MODEL';
    stock: { width: number; height: number; depth: number };
    ops: SolidOp[];
}

export interface SolidModelResponse {
    vertices: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    error?: string;
}

// ─── Message Handler ─────────────────────────────────────────────────────────
// NOTE: SOLID_MODEL is handled by /public/occt-worker.js (a classic Worker)
// to avoid Vite/Rollup trying to bundle opencascade.js WASM.
self.onmessage = async (e: MessageEvent<OffsetRequest | BooleanRequest>) => {
    const msg = e.data;

    try {
        if (msg.type === 'OFFSET') {
            const co = new ClipperLib.ClipperOffset(2, 0.25);
            co.AddPaths(msg.paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
            const solution: ClipperPoint[][] = [];
            co.Execute(solution, msg.delta * CLIPPER_SCALE);
            self.postMessage({ paths: solution } as WorkerResponse);

        } else if (msg.type === 'BOOLEAN') {
            const c = new ClipperLib.Clipper();
            c.AddPaths(msg.subjectPaths, ClipperLib.PolyType.ptSubject, true);
            c.AddPaths(msg.clipPaths, ClipperLib.PolyType.ptClip, true);
            const clipType = msg.op === 'DIFFERENCE'
                ? ClipperLib.ClipType.ctDifference
                : msg.op === 'UNION'
                    ? ClipperLib.ClipType.ctUnion
                    : ClipperLib.ClipType.ctIntersection;
            const solution: ClipperPoint[][] = [];
            c.Execute(clipType, solution, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
            self.postMessage({ paths: solution } as WorkerResponse);
        }

    } catch (err: any) {
        self.postMessage({ paths: [], error: err.message } as WorkerResponse);
    }
};

