import { Path2D } from './Path2D';
import { Tool } from './Tool';
import type { MachiningOperation } from './Operation';

export class Stock {
    width: number;
    height: number;
    depth: number;
    operations: MachiningOperation[];

    constructor(width: number, height: number, depth: number) {
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.operations = [];
    }

    pocket(path: Path2D, opts: { depth: number; tool: Tool }): this {
        this.operations.push({
            type: 'pocket',
            path,
            depth: opts.depth,
            tool: opts.tool
        });
        return this;
    }

    profile(path: Path2D, opts: { depth: number; side?: 'inside' | 'outside'; tool: Tool }): this {
        this.operations.push({
            type: 'profile',
            path,
            depth: opts.depth,
            side: opts.side || 'outside',
            tool: opts.tool
        });
        return this;
    }

    drill(points: { x: number; y: number }[], opts: { depth: number; tool: Tool }): this {
        this.operations.push({
            type: 'drill',
            points,
            depth: opts.depth,
            tool: opts.tool
        });
        return this;
    }
}
