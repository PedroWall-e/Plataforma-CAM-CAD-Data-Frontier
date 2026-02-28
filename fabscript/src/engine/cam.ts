import * as THREE from 'three';
import { toClipperPath, fromClipperPaths } from './geometry';
import type { ClipperPoint } from './geometry';
import type { BooleanOp } from './workers/cam.worker';

// We use Vite's built-in Web Worker support with the ?worker query
import CamWorker from './workers/cam.worker?worker';

/**
 * Computes a 2D polygon offset (Tool Compensation).
 * delta > 0 = expand (profile outside), delta < 0 = shrink (pocket inside)
 */
export function computeOffset(
    paths: THREE.Vector3[][],
    delta: number
): Promise<THREE.Vector3[][]> {
    return new Promise((resolve, reject) => {
        const worker = new CamWorker();
        const clipperPaths: ClipperPoint[][] = paths.map(toClipperPath);

        worker.onmessage = (e: MessageEvent) => {
            worker.terminate();
            if (e.data.error) {
                reject(new Error(e.data.error));
            } else {
                resolve(fromClipperPaths(e.data.paths));
            }
        };

        worker.onerror = (err: ErrorEvent) => {
            worker.terminate();
            reject(new Error(err.message));
        };

        worker.postMessage({ type: 'OFFSET', paths: clipperPaths, delta });
    });
}

/**
 * Computes a 2D boolean operation between two sets of polygons.
 */
export function computeBoolean(
    subjectPaths: THREE.Vector3[][],
    clipPaths: THREE.Vector3[][],
    op: BooleanOp = 'DIFFERENCE'
): Promise<THREE.Vector3[][]> {
    return new Promise((resolve, reject) => {
        const worker = new CamWorker();

        worker.onmessage = (e: MessageEvent) => {
            worker.terminate();
            if (e.data.error) {
                reject(new Error(e.data.error));
            } else {
                resolve(fromClipperPaths(e.data.paths));
            }
        };

        worker.onerror = (err: ErrorEvent) => {
            worker.terminate();
            reject(new Error(err.message));
        };

        worker.postMessage({
            type: 'BOOLEAN',
            subjectPaths: subjectPaths.map(toClipperPath),
            clipPaths: clipPaths.map(toClipperPath),
            op,
        });
    });
}
