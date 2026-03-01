// CAM Web Worker (FabScript 2.0)
// Handles:
//   1. 2D polygon offsets and booleans via js-clipper (Phase 3 - unchanged)
//   2. 3D solid boolean modeling via OpenCASCADE.js WASM (Phase 2 addition)
//
// All heavy computation runs here, off the main thread.

import ClipperLib from 'js-clipper';
import { CLIPPER_SCALE } from '../geometry';
import type { ClipperPoint } from '../geometry';

// ─── Phase 3: 2D Path types (unchanged) ─────────────────────────────────────
export type BooleanOp = 'DIFFERENCE' | 'UNION' | 'INTERSECTION';

export interface OffsetRequest {
    type: 'OFFSET';
    paths: ClipperPoint[][];
    delta: number;
}

export interface BooleanRequest {
    type: 'BOOLEAN';
    subjectPaths: ClipperPoint[][];
    clipPaths: ClipperPoint[][];
    op: BooleanOp;
}

export interface WorkerResponse {
    paths: ClipperPoint[][];
    error?: string;
}

// ─── Phase 2: B-Rep Solid types ─────────────────────────────────────────────
export interface SolidPocketOp {
    type: 'pocket';
    points: { x: number; y: number }[];
    depth: number;
}

export interface SolidDrillOp {
    type: 'drill';
    points: { x: number; y: number }[];
    depth: number;
    radius: number;
}

export type SolidOp = SolidPocketOp | SolidDrillOp;

export interface SolidModelRequest {
    type: 'SOLID_MODEL';
    stock: { width: number; height: number; depth: number };
    ops: SolidOp[];
}

export interface SolidModelResponse {
    vertices: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    error?: string;
}

// ─── OpenCASCADE lazy singleton ──────────────────────────────────────────────
let ocInstance: any = null;

// @ts-ignore
import initOpenCascade from 'opencascade.js/dist/opencascade.wasm.js';
// @ts-ignore
import wasmUrl from 'opencascade.js/dist/opencascade.wasm.wasm?url';

async function getOC(): Promise<any> {
    if (ocInstance) return ocInstance;

    // Explicitly initialize with the static ?url to bypass Vite's ESM-WASM parser
    ocInstance = await initOpenCascade({
        locateFile: () => wasmUrl,
    });
    return ocInstance;
}

// ─── B-Rep solid builder ─────────────────────────────────────────────────────
/**
 * Uses OpenCASCADE to:
 *  1. Build a stock box.
 *  2. Subtract the pocket/drill volumes from it.
 *  3. Run incremental meshing.
 *  4. Return the triangulated mesh data as TypedArrays.
 */
async function buildSolid(
    request: SolidModelRequest
): Promise<SolidModelResponse> {
    const oc = await getOC();
    const { width, height, depth } = request.stock;

    // ── Build the stock box ──────────────────────────────────────────────────
    const stockBox = new oc.BRepPrimAPI_MakeBox_2(
        new oc.gp_Pnt_3(0, 0, -depth),
        width,
        height,
        depth
    );
    let solid: any = stockBox.Shape();

    // ── Apply each operation ─────────────────────────────────────────────────
    for (const op of request.ops) {
        if (op.type === 'pocket' && op.points.length > 2) {
            // Build a closed wire from the 2D path
            const wire = new oc.BRepBuilderAPI_MakeWire_1();
            for (let i = 0; i < op.points.length; i++) {
                const p1 = op.points[i];
                const p2 = op.points[(i + 1) % op.points.length];
                const edge = new oc.BRepBuilderAPI_MakeEdge_3(
                    new oc.gp_Pnt_3(p1.x, p1.y, 0),
                    new oc.gp_Pnt_3(p2.x, p2.y, 0)
                );
                wire.Add_1(edge.Edge());
            }
            const face = new oc.BRepBuilderAPI_MakeFace_15(wire.Wire(), false);
            const dir = new oc.gp_Dir_4(0, 0, -1);
            const pocket = new oc.BRepPrimAPI_MakePrism_1(
                face.Face(),
                new oc.gp_Vec_4(dir, op.depth),
                false,
                true
            );
            const boolOp = new oc.BRepAlgoAPI_Cut_3(solid, pocket.Shape(), new oc.Message_ProgressRange_1());
            boolOp.Build(new oc.Message_ProgressRange_1());
            if (boolOp.IsDone()) solid = boolOp.Shape();

        } else if (op.type === 'drill') {
            for (const pt of op.points) {
                const cylAxis = new oc.gp_Ax2_3(
                    new oc.gp_Pnt_3(pt.x, pt.y, 0),
                    new oc.gp_Dir_4(0, 0, -1)
                );
                const cyl = new oc.BRepPrimAPI_MakeCylinder_2(cylAxis, op.radius, op.depth);
                const boolOp = new oc.BRepAlgoAPI_Cut_3(solid, cyl.Shape(), new oc.Message_ProgressRange_1());
                boolOp.Build(new oc.Message_ProgressRange_1());
                if (boolOp.IsDone()) solid = boolOp.Shape();
            }
        }
    }

    // ── Tessellate ───────────────────────────────────────────────────────────
    const linDeflection = 0.1;
    const mesh = new oc.BRepMesh_IncrementalMesh_2(solid, linDeflection, false, 0.5, false);
    mesh.Perform();

    // ── Extract triangles ─────────────────────────────────────────────────────
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const explorer = new oc.TopExp_Explorer_2(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let vertexOffset = 0;

    while (explorer.More()) {
        const face = oc.TopoDS.Face_1(explorer.Current());
        const location = new oc.TopLoc_Location_1();
        const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

        if (!triangulation.IsNull()) {
            const triMesh = triangulation.get();
            const nTriangles = triMesh.NbTriangles();
            const nNodes = triMesh.NbNodes();

            // Collect nodes
            for (let i = 1; i <= nNodes; i++) {
                const node = triMesh.Node(i);
                vertices.push(node.X(), node.Y(), node.Z());
                // Placeholder normal (we'll compute per-face below)
                normals.push(0, 0, 1);
            }

            // Collect triangles
            for (let i = 1; i <= nTriangles; i++) {
                const tri = triMesh.Triangle(i);
                const [n, m, l] = [tri.Value(1), tri.Value(2), tri.Value(3)];
                indices.push(
                    vertexOffset + n - 1,
                    vertexOffset + m - 1,
                    vertexOffset + l - 1
                );
            }
            vertexOffset += nNodes;
        }
        explorer.Next();
    }

    const vertexArray = new Float32Array(vertices);
    const normalArray = new Float32Array(normals);
    const indexArray = new Uint32Array(indices);

    return {
        vertices: vertexArray,
        normals: normalArray,
        indices: indexArray,
    };
}

// ─── Message Handler ─────────────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent<OffsetRequest | BooleanRequest | SolidModelRequest>) => {
    const msg = e.data;

    try {
        if (msg.type === 'OFFSET') {
            const co = new ClipperLib.ClipperOffset(2, 0.25);
            co.AddPaths(msg.paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
            const solution: ClipperPoint[][] = [];
            co.Execute(solution, msg.delta * CLIPPER_SCALE);
            self.postMessage({ paths: solution } as WorkerResponse);

        } else if (msg.type === 'BOOLEAN') {
            const c = new ClipperLib.Clipper();
            c.AddPaths(msg.subjectPaths, ClipperLib.PolyType.ptSubject, true);
            c.AddPaths(msg.clipPaths, ClipperLib.PolyType.ptClip, true);
            const clipType = msg.op === 'DIFFERENCE'
                ? ClipperLib.ClipType.ctDifference
                : msg.op === 'UNION'
                    ? ClipperLib.ClipType.ctUnion
                    : ClipperLib.ClipType.ctIntersection;
            const solution: ClipperPoint[][] = [];
            c.Execute(clipType, solution, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
            self.postMessage({ paths: solution } as WorkerResponse);

        } else if (msg.type === 'SOLID_MODEL') {
            const result = await buildSolid(msg);
            // Transfer the large ArrayBuffers to avoid copying
            self.postMessage(result, [
                result.vertices.buffer,
                result.normals.buffer,
                result.indices.buffer
            ] as any);
        }

    } catch (err: any) {
        if (msg.type === 'SOLID_MODEL') {
            // Return a minimal valid response on error
            self.postMessage({
                vertices: new Float32Array(),
                normals: new Float32Array(),
                indices: new Uint32Array(),
                error: err.message
            } as SolidModelResponse);
        } else {
            self.postMessage({ paths: [], error: err.message } as WorkerResponse);
        }
    }
};
