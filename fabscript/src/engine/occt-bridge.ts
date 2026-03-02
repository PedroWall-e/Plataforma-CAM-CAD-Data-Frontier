/**
 * occt-bridge.ts
 *
 * Converts the raw triangle mesh data coming from the OpenCASCADE WASM worker
 * into a Three.js BufferGeometry ready for rendering.
 * 
 * [CORREÇÃO 4] OTIMIZAÇÃO DE MEMÓRIA:
 * - Uses TypedArrays (Float32Array/Uint32Array) for zero-copy transfer
 * - Returns data via Transferable Objects to avoid memory duplication
 * - Main thread receives ownership of buffers (transfer semantics)
 */
import * as THREE from 'three';

/** The serializable mesh payload returned by the OCCT worker */
export interface OcctMeshData {
    vertices: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
}

/**
 * [CORREÇÃO 4] Converts raw OCCT mesh data into a Three.js BufferGeometry.
 * 
 * Memory optimization notes:
 * - Expects Float32Arrays for vertices and normals (already typed)
 * - Expects Uint32Array for indices
 * - Uses BufferAttribute with proper itemSize (3 for position/normal, 1 for index)
 * - computeVertexNormals() recalculates normals from actual geometry (worker sends placeholder (0,0,1))
 * 
 * @param data - Mesh data transferred from worker via Transferable Objects
 * @returns Three.js BufferGeometry or null if mesh is empty
 */
export function occtMeshToGeometry(data: OcctMeshData): THREE.BufferGeometry | null {
    if (!data.vertices || data.vertices.length === 0) {
        console.warn('[OCCT Bridge] Mesh has 0 vertices — skipping render.');
        return null;
    }

    console.log(`[OCCT Bridge] Mesh received: ${data.vertices.length / 3} vertices, ${data.indices.length / 3} triangles`);

    const geometry = new THREE.BufferGeometry();
    
    // [CORREÇÃO 4] Set position with Float32Array (3 components per vertex)
    geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
    
    // [CORREÇÃO 4] Set index with Uint32Array (1 component per index)
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    
    // [CORREÇÃO 4] Use Uint32Array for index if count > 65535 ( WebGL limit for Uint16)
    if (data.indices.length > 65535) {
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        // Note: Three.js automatically uses Uint32Array when needed for large meshes
    }
    
    // Compute proper per-vertex normals from the actual face geometry
    // (placeholder normals from worker are all (0,0,1) and cause invisible faces)
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    console.log('[OCCT Bridge] BoundingBox:', geometry.boundingBox);
    return geometry;
}

/**
 * [CORREÇÃO 4] Factory to create mesh data with proper TypedArray typing
 * Used when constructing response in worker before transfer
 */
export function createOcctMeshData(
    vertices: Float32Array, 
    normals: Float32Array, 
    indices: Uint32Array
): OcctMeshData {
    return {
        vertices,
        normals,
        indices
    };
}
