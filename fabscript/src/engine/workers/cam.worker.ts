// CAM Web Worker
// This worker handles heavy geometry computation (polygon offsets and booleans)
// off the main thread so the UI stays responsive.

import ClipperLib from 'js-clipper';
import { CLIPPER_SCALE } from '../geometry';
import type { ClipperPoint } from '../geometry';

export type BooleanOp = 'DIFFERENCE' | 'UNION' | 'INTERSECTION';

export interface OffsetRequest {
    type: 'OFFSET';
    paths: ClipperPoint[][];
    delta: number; // in mm (will be scaled internally)
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

self.onmessage = (e: MessageEvent<OffsetRequest | BooleanRequest>) => {
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
