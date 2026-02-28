import * as THREE from 'three';
import type { MachiningOperation } from './api/Operation';

interface GCodeContext {
    safeZ: number;       // Z height to move rapidly without hitting material
    feedrate: number;    // Cutting speed in mm/min
    plungeRate: number;  // Z plunging speed in mm/min
    spindleRPM: number;  // Spindle speed
}

const DEFAULT_CONTEXT: GCodeContext = {
    safeZ: 5.0,
    feedrate: 800,
    plungeRate: 300,
    spindleRPM: 12000
};

/**
 * Formats a number to 3 decimal places
 */
const fmt = (n: number) => n.toFixed(3);

/**
 * Generates Grbl-compatible G-Code from a list of machining operations and offset paths.
 */
export function generateGCode(operations: MachiningOperation[], offsetPaths: THREE.Vector3[][]): string {
    const lines: string[] = [];
    const ctx = DEFAULT_CONTEXT;

    // --- HEADER ---
    lines.push('(FABSCRIPT G-CODE EXPORT)');
    lines.push('G21 (Units = millimeters)');
    lines.push('G90 (Absolute positioning)');
    lines.push(`M3 S${ctx.spindleRPM} (Spindle ON, clockwise)`);
    lines.push('G4 P2 (Wait 2 seconds for spindle)');
    lines.push(`G0 Z${fmt(ctx.safeZ)} (Move to safe Z height)`);
    lines.push('');

    // To keep it robust for Phase 5 MVP, we associate offset paths broadly.
    // In a full implementation, `offsetPaths` would be grouped by Operation exactly.
    // Here we assume offsetPaths are flattened for profiles/pockets.

    // --- OPERATIONS ---
    operations.forEach((op, opIdx) => {
        lines.push(`(Operation ${opIdx + 1}: ${op.type.toUpperCase()})`);

        if (op.type === 'drill') {
            op.points.forEach((pt, ptIdx) => {
                lines.push(`(Drill point ${ptIdx + 1})`);
                // Move to point at safe Z
                lines.push(`G0 X${fmt(pt.x)} Y${fmt(pt.y)}`);
                // Plunge
                lines.push(`G1 Z${fmt(-op.depth)} F${ctx.plungeRate}`);
                // Retract
                lines.push(`G0 Z${fmt(ctx.safeZ)}`);
            });
        }
        else if (op.type === 'pocket' || op.type === 'profile') {
            // Ideally we process the polygon offset specific to this path.
            // For the MVP, we assume `offsetPaths` covers all paths generically.
            // Let's grab the corresponding offset path (rough assumption for MVP).
            // If we don't have a matching offset path (e.g. open profile), fallback to the original path.
            const pathsToMNC = offsetPaths.length > 0 ? offsetPaths : [op.path.points];

            pathsToMNC.forEach((pts, subIdx) => {
                if (pts.length === 0) return;

                lines.push(`(Path ${subIdx + 1})`);
                const firstPt = pts[0];

                // Move to start point
                lines.push(`G0 X${fmt(firstPt.x)} Y${fmt(firstPt.y)}`);
                // Plunge
                lines.push(`G1 Z${fmt(-op.depth)} F${ctx.plungeRate}`);
                // Cut along path
                for (let i = 1; i < pts.length; i++) {
                    lines.push(`G1 X${fmt(pts[i].x)} Y${fmt(pts[i].y)} F${ctx.feedrate}`);
                }
                // Retract
                lines.push(`G0 Z${fmt(ctx.safeZ)}`);
            });
        }
        lines.push('');
    });

    // --- FOOTER ---
    lines.push('(END PROGRAM)');
    lines.push(`G0 Z${fmt(ctx.safeZ + 10)} (Safe retract)`);
    lines.push('M5 (Spindle OFF)');
    lines.push('G0 X0 Y0 (Return to origin)');
    lines.push('M30 (Program End)');

    return lines.join('\n');
}
