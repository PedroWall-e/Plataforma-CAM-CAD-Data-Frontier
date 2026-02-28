import { Path2D } from './Path2D';
import { Tool } from './Tool';

export type OperationType = 'pocket' | 'profile' | 'drill';

export interface PocketOp {
    type: 'pocket';
    path: Path2D;
    depth: number;
    tool: Tool;
}

export interface ProfileOp {
    type: 'profile';
    path: Path2D;
    depth: number;
    side: 'inside' | 'outside';
    tool: Tool;
}

export interface DrillOp {
    type: 'drill';
    points: { x: number; y: number }[];
    depth: number;
    tool: Tool;
}

export type MachiningOperation = PocketOp | ProfileOp | DrillOp;
