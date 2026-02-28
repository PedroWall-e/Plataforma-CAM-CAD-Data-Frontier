import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { Stock } from '../engine/api/Stock';
import type { MachiningOperation } from '../engine/api/Operation';

interface Viewer3DProps {
    geometries: THREE.Vector3[][];
    stock: Stock | null;
    offsetPaths?: THREE.Vector3[][];
    operations?: MachiningOperation[];
}

const Viewer3D: React.FC<Viewer3DProps> = ({ geometries, stock, offsetPaths = [], operations = [] }) => {
    return (
        <Canvas
            camera={{ position: [0, -40, 40], up: [0, 0, 1] }}
            className="w-full h-full"
        >
            <color attach="background" args={['#1e1e1e']} />

            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 10]} intensity={1} />
            <Environment preset="city" />

            {/* Origin Axis Helper */}
            <axesHelper args={[10]} />

            {/* Ground Grid */}
            <Grid
                position={[0, 0, -0.01]}
                args={[100, 100]}
                cellSize={1}
                cellThickness={1}
                cellColor="#444"
                sectionSize={10}
                sectionThickness={1.5}
                sectionColor="#666"
                fadeDistance={100}
                fadeStrength={1}
            />

            {/* Render Stock */}
            {stock && (
                <mesh position={[stock.width / 2, stock.height / 2, -stock.depth / 2]}>
                    <boxGeometry args={[stock.width, stock.height, stock.depth]} />
                    <meshStandardMaterial
                        color="#2a3f54"
                        transparent={true}
                        opacity={0.3}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                    <lineSegments>
                        <edgesGeometry args={[new THREE.BoxGeometry(stock.width, stock.height, stock.depth)]} />
                        <lineBasicMaterial color="#4fc3f7" transparent opacity={0.5} />
                    </lineSegments>
                </mesh>
            )}

            {/* Render user geometry paths (cyan) */}
            {geometries.map((pts, idx) => {
                if (pts.length < 2) return null;
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                const material = new THREE.LineBasicMaterial({ color: '#00ffcc', linewidth: 2 });
                return <primitive key={`geo-${idx}`} object={new THREE.Line(geometry, material)} />;
            })}

            {/* Render tool-compensated offset paths (orange) */}
            {offsetPaths.map((pts, idx) => {
                if (pts.length < 2) return null;
                const geometry = new THREE.BufferGeometry().setFromPoints(pts);
                const material = new THREE.LineBasicMaterial({ color: '#FF6B2B', linewidth: 1.5 });
                return <primitive key={`offset-${idx}`} object={new THREE.Line(geometry, material)} />;
            })}

            {/* Render 3D Machining Operations */}
            {operations.map((op, idx) => {
                if (op.type === 'pocket' && op.path.points.length > 2) {
                    // Create an extruded shape for the pocket (visualized as a red solid volume representing removed material)
                    const shape = new THREE.Shape(op.path.points.map(p => new THREE.Vector2(p.x, p.y)));
                    const extrudeSettings = { depth: op.depth, bevelEnabled: false };
                    return (
                        <mesh key={`op-${idx}`} position={[0, 0, -op.depth]}>
                            <extrudeGeometry args={[shape, extrudeSettings]} />
                            <meshStandardMaterial color="#ef4444" transparent opacity={0.6} side={THREE.DoubleSide} />
                        </mesh>
                    );
                }

                if (op.type === 'drill') {
                    // Visualize drills as small red cylinders
                    return (
                        <group key={`op-${idx}`}>
                            {op.points.map((pt, pIdx) => (
                                <mesh key={`drill-${pIdx}`} position={[pt.x, pt.y, -op.depth / 2]} rotation={[Math.PI / 2, 0, 0]}>
                                    <cylinderGeometry args={[op.tool.diameter / 2, op.tool.diameter / 2, op.depth, 16]} />
                                    <meshStandardMaterial color="#b91c1c" transparent opacity={0.8} />
                                </mesh>
                            ))}
                        </group>
                    );
                }

                if (op.type === 'profile' && op.path.points.length > 1) {
                    // Just visualize profile as a thick red line bounding box for now
                    const geometry = new THREE.BufferGeometry().setFromPoints(op.path.points);
                    const material = new THREE.LineBasicMaterial({ color: '#ef4444', linewidth: 3 });
                    return <primitive key={`op-${idx}`} object={new THREE.Line(geometry, material)} position={[0, 0, -op.depth]} />;
                }

                return null;
            })}

            <OrbitControls makeDefault />
        </Canvas>
    );
};

export default Viewer3D;
