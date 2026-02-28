import * as THREE from 'three';

export class Path2D {
    points: THREE.Vector3[];

    constructor() {
        this.points = [];
    }

    moveTo(x: number, y: number) {
        if (this.points.length === 0) {
            this.points.push(new THREE.Vector3(x, y, 0));
        } else {
            // In a real CAM system, a moveTo mid-path usually implies lifting the tool
            // or starting a new subpath. For Phase 1 we just connect it (or consider it 1 continuous path).
            this.points.push(new THREE.Vector3(x, y, 0));
        }
    }

    lineTo(x: number, y: number) {
        this.points.push(new THREE.Vector3(x, y, 0));
    }

    arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, segments: number = 32) {
        const angleStep = (endAngle - startAngle) / segments;
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + i * angleStep;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            this.points.push(new THREE.Vector3(x, y, 0));
        }
    }

    close() {
        if (this.points.length > 2) {
            const firstPoint = this.points[0];
            const lastPoint = this.points[this.points.length - 1];
            if (!firstPoint.equals(lastPoint)) {
                this.points.push(firstPoint.clone());
            }
        }
        return this;
    }
}
