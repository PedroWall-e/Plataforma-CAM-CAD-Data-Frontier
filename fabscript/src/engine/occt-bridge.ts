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
export function occtMeshToGeometry(data: OcctMeshData): THREE.BufferGeometry | null {
    if (!data.vertices || data.vertices.length === 0) {
        console.warn('[OCCT Bridge] Mesh has 0 vertices — skipping render.');
        return null;
    }

    console.log(`[OCCT Bridge] Mesh received: ${data.vertices.length / 3} vertices, ${data.indices.length / 3} triangles`);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    // Compute proper per-vertex normals from the actual face geometry
    // (placeholder normals from worker are all (0,0,1) and cause invisible faces)
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    console.log('[OCCT Bridge] BoundingBox:', geometry.boundingBox);
    return geometry;
}
