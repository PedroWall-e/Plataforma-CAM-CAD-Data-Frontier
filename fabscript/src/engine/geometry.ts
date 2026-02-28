import * as THREE from 'three';

// Clipper uses integer coordinates for precision, so we scale up
export const CLIPPER_SCALE = 1000;

export interface ClipperPoint {
    X: number;
    Y: number;
}

/** Convert THREE.Vector3[] to Clipper IntPoint path (scaled integers) */
export function toClipperPath(points: THREE.Vector3[]): ClipperPoint[] {
    return points.map(p => ({
        X: Math.round(p.x * CLIPPER_SCALE),
        Y: Math.round(p.y * CLIPPER_SCALE),
    }));
}

/** Convert a Clipper IntPoint path back to THREE.Vector3[] */
export function fromClipperPath(path: ClipperPoint[]): THREE.Vector3[] {
    return path.map(p => new THREE.Vector3(p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE, 0));
}

/** Convert multiple clipper paths back to THREE.Vector3[][] */
export function fromClipperPaths(paths: ClipperPoint[][]): THREE.Vector3[][] {
    return paths.map(fromClipperPath);
}
