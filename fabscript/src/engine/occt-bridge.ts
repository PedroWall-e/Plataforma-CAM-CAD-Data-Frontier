/**
 * occt-bridge.ts
 *
 * Converts the raw triangle mesh data coming from the OpenCASCADE WASM worker
 * into a Three.js BufferGeometry ready for rendering.
 */
import * as THREE from 'three';

/** The serializable mesh payload returned by the OCCT worker */
export interface OcctMeshData {
    vertices: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
}

/**
 * Converts raw OCCT mesh data into a Three.js BufferGeometry.
 * Expects Float32Arrays for vertices and normals and a Uint32Array for indices.
 */
export function occtMeshToGeometry(data: OcctMeshData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return geometry;
}
