export type ToolType = 'flat' | 'ball' | 'drill';

export class Tool {
    id: string;
    name: string;
    type: ToolType;
    diameter: number;

    constructor(id: string, name: string, type: ToolType, diameter: number) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.diameter = diameter;
    }
}
