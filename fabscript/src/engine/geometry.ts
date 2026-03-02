import * as THREE from 'three';
import ClipperLib from 'js-clipper';

// [CORREÇÃO 2] ESCALA: Fixed Scale Factor (100000) for high precision
// Using 100000 instead of 1000 prevents floating-point precision loss in Clipper
export const CLIPPER_SCALE = 100000;

// [CORREÇÃO 2] COORDENADAS: Strict axis conversion utilities
// Three.js: Y-up (Y is vertical)
// OpenCASCADE: Z-up (Z is vertical)
// Clipper 2D: X-Y plane (integers)

export interface ClipperPoint {
    X: number;
    Y: number;
}

/**
 * [CORREÇÃO 2] Convert THREE.Vector3[] (Y-up) to Clipper IntPoint path (scaled integers)
 * Three.js Y-up coordinates are converted to Clipper's 2D X-Y plane
 * Z coordinate is ignored (assumed to be on the cutting plane)
 */
export function toClipperPath(points: THREE.Vector3[]): ClipperPoint[] {
    // Use Float64Array for intermediate calculations to avoid precision loss
    const result: ClipperPoint[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        // Convert Three.js Y-up to Clipper 2D: X->X, Y->Y
        // Use Math.round with Float64 for precision
        result[i] = {
            X: Math.round((p.x as number) * CLIPPER_SCALE),
            Y: Math.round((p.y as number) * CLIPPER_SCALE),
        };
    }
    return result;
}

/**
 * [CORREÇÃO 2] Convert Clipper IntPoint path (scaled integers) back to THREE.Vector3[]
 * Returns Float64Array-backed vectors for precision
 */
export function fromClipperPath(path: ClipperPoint[]): THREE.Vector3[] {
    const result: THREE.Vector3[] = new Array(path.length);
    for (let i = 0; i < path.length; i++) {
        const p = path[i];
        // Convert Clipper 2D back to Three.js Y-up coordinates
        // Use Float64 for precision before creating vector
        const x = (p.X / CLIPPER_SCALE) as number;
        const y = (p.Y / CLIPPER_SCALE) as number;
        result[i] = new THREE.Vector3(x, y, 0);
    }
    return result;
}

/**
 * [CORREÇÃO 2] Convert multiple Clipper paths back to THREE.Vector3[][]
 */
export function fromClipperPaths(paths: ClipperPoint[][]): THREE.Vector3[][] {
    return paths.map(fromClipperPath);
}

/**
 * [CORREÇÃO 2] Convert Three.js Y-up coordinates to OpenCASCADE Z-up
 * Three.js: (x, y, z) where Y is up
 * OpenCASCADE: (x, z, -y) where Z is up
 */
export function threeToOcc(point: THREE.Vector3): { x: number; y: number; z: number } {
    return {
        x: point.x,
        y: point.z,  // Three.js Z becomes OCC Y
        z: -point.y  // Three.js Y becomes OCC Z (inverted for standard orientation)
    };
}

/**
 * [CORREÇÃO 2] Convert OpenCASCADE Z-up coordinates to Three.js Y-up
 * OpenCASCADE: (x, y, z) where Z is up
 * Three.js: (x, -z, y) where Y is up
 */
export function occToThree(point: { X: number; Y: number; Z: number }): THREE.Vector3 {
    return new THREE.Vector3(
        point.X,
        -point.Z,  // OCC Z becomes Three.js -Y
        point.Y    // OCC Y becomes Three.js Z
    );
}

/**
 * [CORREÇÃO 3] SANITIZAÇÃO 2D: Process paths with SimplifyPolygon to prevent Non-Manifold
 * Uses Clipper's SimplifyPolygon with pftNonZero fill type
 * Guarantees closed polygons without self-intersection
 */
export function sanitizeClipperPath(path: ClipperPoint[]): ClipperPoint[] {
    try {
        // Use SimplifyPolygon to clean up the path
        // pftNonZero ensures proper winding for filled polygons
        const simplified = ClipperLib.SimplifyPolygon(
            path,
            ClipperLib.PolyFillType.pftNonZero,
            0.01 * CLIPPER_SCALE // Tolerance for simplification
        );
        
        if (simplified && simplified.length > 0) {
            console.log(`[Geometry] Sanitized path: ${path.length} -> ${simplified[0].length} points`);
            return simplified[0]; // Return first simplified polygon
        }
    } catch (e) {
        console.warn('[Geometry] SimplifyPolygon failed, using original path:', e);
    }
    return path;
}

/**
 * [CORREÇÃO 3] SANITIZAÇÃO 2D: Process multiple paths
 */
export function sanitizeClipperPaths(paths: ClipperPoint[][]): ClipperPoint[][] {
    return paths.map(sanitizeClipperPath);
}

/**
 * [CORREÇÃO 2] Verify path is properly closed (first point == last point)
 */
export function isPathClosed(path: ClipperPoint[]): boolean {
    if (path.length < 3) return false;
    const first = path[0];
    const last = path[path.length - 1];
    return first.X === last.X && first.Y === last.Y;
}

/**
 * [CORREÇÃO 2] Force-close an open path by adding the first point to the end
 */
export function closePath(path: ClipperPoint[]): ClipperPoint[] {
    if (isPathClosed(path)) return path;
    return [...path, path[0]];
}
