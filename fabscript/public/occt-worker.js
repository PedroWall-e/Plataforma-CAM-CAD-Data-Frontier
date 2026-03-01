/**
 * occt-worker.js (ES Module Worker)
 *
 * Loads OpenCASCADE as an ES module. Spawned with { type: 'module' }.
 * Because this file lives in /public, Vite never bundles it,
 * so there's no Rollup WASM integration issue.
 *
 * The locateFile callback tells Emscripten to fetch the .wasm from /public.
 */
import initOpenCascade from '/opencascade.wasm.js';

let oc = null;

async function getOC() {
    if (oc) return oc;
    oc = await initOpenCascade({
        // Point to the .wasm file served from /public
        locateFile: () => '/opencascade.wasm.wasm',
    });
    return oc;
}

async function buildSolid(request) {
    const oc = await getOC();
    const { stock: { width, height, depth }, ops } = request;

    console.log('[OCCT Worker] gp_Vec constructors:', Object.keys(oc).filter(k => k.startsWith('gp_Vec')));
    console.log('[OCCT Worker] BRepPrimAPI_MakePrism constructors:', Object.keys(oc).filter(k => k.startsWith('BRepPrimAPI_MakePrism')));

    // Build stock box (centered at 0,0)
    const stockBox = new oc.BRepPrimAPI_MakeBox_2(
        new oc.gp_Pnt_3(-width / 2, -height / 2, -depth),
        width, height, depth
    );
    let solid = stockBox.Shape();

    // Helper to find the correct constructor signature for this OCCT build
    const findConstructor = (path, name, args) => {
        for (let i = 1; i <= 20; i++) {
            const fullName = `${name}_${i}`;
            if (path[fullName]) {
                try {
                    const obj = new path[fullName](...args);
                    console.log(`[OCCT Worker] Found valid constructor: ${fullName}`);
                    return obj;
                } catch (e) {
                    // console.log(`[OCCT Worker] Tried ${fullName}, failed: ${e.message}`);
                }
            }
        }
        // Try base name without suffix
        if (path[name]) {
            try {
                const obj = new path[name](...args);
                console.log(`[OCCT Worker] Found valid constructor: ${name}`);
                return obj;
            } catch (e) { }
        }
        return null;
    };

    // Apply each operation
    console.log(`[OCCT Worker] Starting ${ops.length} operations...`);
    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
        const op = ops[opIdx];
        if (op.type === 'pocket' && op.points.length > 2) {
            console.log(`[OCCT Worker] OP[${opIdx}]: Building pocket...`);

            const wireMaker = findConstructor(oc, 'BRepBuilderAPI_MakeWire', []);
            if (!wireMaker) {
                console.error(`[OCCT Worker] OP[${opIdx}]: BRepBuilderAPI_MakeWire failed!`);
                continue;
            }

            for (let i = 0; i < op.points.length; i++) {
                const p1 = op.points[i];
                const p2 = op.points[(i + 1) % op.points.length];

                const pt1 = new oc.gp_Pnt_3(p1.x, p1.y, 1);
                const pt2 = new oc.gp_Pnt_3(p2.x, p2.y, 1);

                const edgeMaker = findConstructor(oc, 'BRepBuilderAPI_MakeEdge', [pt1, pt2]);
                if (!edgeMaker || !edgeMaker.IsDone()) {
                    console.error(`[OCCT Worker] OP[${opIdx}]: Edge ${i} build failed!`);
                    continue;
                }
                wireMaker.Add_1(edgeMaker.Edge());

                pt1.delete();
                pt2.delete();
                edgeMaker.delete();
            }

            if (!wireMaker.IsDone()) {
                console.error(`[OCCT Worker] OP[${opIdx}]: Wire build failed!`);
                continue;
            }

            const wire = wireMaker.Wire();
            const faceMaker = findConstructor(oc, 'BRepBuilderAPI_MakeFace', [wire, false]);
            if (!faceMaker || !faceMaker.IsDone()) {
                console.error(`[OCCT Worker] OP[${opIdx}]: Face build failed!`);
                continue;
            }

            const vec = findConstructor(oc, 'gp_Vec', [0, 0, -(op.depth + 1)]);
            if (!vec) {
                console.error(`[OCCT Worker] OP[${opIdx}]: gp_Vec constructor failed!`);
                continue;
            }
            const prismMaker = findConstructor(oc, 'BRepPrimAPI_MakePrism', [faceMaker.Face(), vec, false, true]);

            if (!prismMaker || !prismMaker.IsDone()) {
                console.error(`[OCCT Worker] OP[${opIdx}]: Prism build failed!`);
                continue;
            }

            const prismShape = prismMaker.Shape();
            const boolOp = findConstructor(oc, 'BRepAlgoAPI_Cut', [solid, prismShape]);

            if (boolOp) {
                boolOp.Build();
                if (boolOp.IsDone()) {
                    solid = boolOp.Shape();
                    console.log(`[OCCT Worker] OP[${opIdx}]: Pocket cut success.`);
                } else {
                    console.error(`[OCCT Worker] OP[${opIdx}]: Pocket cut Build failed.`);
                }
                boolOp.delete();
            } else {
                console.error(`[OCCT Worker] OP[${opIdx}]: BRepAlgoAPI_Cut constructor failed!`);
            }

            wireMaker.delete();
            faceMaker.delete();
            prismMaker.delete();
            vec.delete();

        } else if (op.type === 'drill') {
            console.log(`[OCCT Worker] OP[${opIdx}]: Building ${op.points.length} drill(s) for ${op.tool.name}...`);
            for (let ptIdx = 0; ptIdx < op.points.length; ptIdx++) {
                const pt = op.points[ptIdx];
                console.log(`[OCCT Worker] OP[${opIdx}] Drill ${ptIdx + 1}/${op.points.length} at (${pt.x}, ${pt.y})`);

                const center = new oc.gp_Pnt_3(pt.x, pt.y, 1);
                const dir = new oc.gp_Dir_4(0, 0, -1);
                const ax2 = findConstructor(oc, 'gp_Ax2', [center, dir]);

                if (!ax2) {
                    console.error(`[OCCT Worker] OP[${opIdx}]: gp_Ax2 constructor failed!`);
                    continue;
                }

                const cylMaker = findConstructor(oc, 'BRepPrimAPI_MakeCylinder', [ax2, op.radius, op.depth + 1]);
                if (!cylMaker || !cylMaker.IsDone()) {
                    console.error(`[OCCT Worker] OP[${opIdx}]: Cylinder build failed!`);
                    continue;
                }

                const cylShape = cylMaker.Shape();
                if (cylShape.IsNull()) {
                    console.error(`[OCCT Worker] OP[${opIdx}]: Cylinder shape is Null!`);
                    continue;
                }

                const boolOp = findConstructor(oc, 'BRepAlgoAPI_Cut', [solid, cylShape]);
                if (boolOp) {
                    boolOp.Build();
                    if (boolOp.IsDone()) {
                        const newSolid = boolOp.Shape();
                        if (!newSolid.IsNull()) {
                            solid = newSolid;
                            console.log(`[OCCT Worker] OP[${opIdx}]: Drill ${ptIdx + 1} success.`);
                        } else {
                            console.error(`[OCCT Worker] OP[${opIdx}]: Drill cut returned Null shape!`);
                        }
                    } else {
                        console.error(`[OCCT Worker] OP[${opIdx}]: Drill cut build not done.`);
                    }
                    boolOp.delete();
                } else {
                    console.error(`[OCCT Worker] OP[${opIdx}]: BRepAlgoAPI_Cut for drill failed!`);
                }

                center.delete();
                dir.delete();
                ax2.delete();
                cylMaker.delete();
            }
        }
    }

    // Tessellate
    const mesh = new oc.BRepMesh_IncrementalMesh_2(solid, 0.1, false, 0.5, false);
    mesh.Perform();

    const vertices = [];
    const normals = [];
    const indices = [];

    const explorer = new oc.TopExp_Explorer_2(
        solid,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );
    let vertexOffset = 0;
    let faceCount = 0;

    while (explorer.More()) {
        faceCount++;
        const face = oc.TopoDS.Face_1(explorer.Current());
        const location = new oc.TopLoc_Location_1();

        // Pass only 2 arguments to avoid calling a non-existent Emscripten overload
        const triangulation = oc.BRep_Tool.Triangulation(face, location);

        if (!triangulation.IsNull()) {
            const triMesh = triangulation.get();
            const nTriangles = triMesh.NbTriangles();
            const nNodes = triMesh.NbNodes();

            // Extract vertices directly
            for (let i = 1; i <= nNodes; i++) {
                const node = triMesh.Node(i);
                vertices.push(node.X(), node.Y(), node.Z());
                node.delete(); // Delete C++ proxy wrapper
                normals.push(0, 0, 1);
            }

            // Extract triangles
            for (let i = 1; i <= nTriangles; i++) {
                const tri = triMesh.Triangle(i);
                indices.push(
                    vertexOffset + tri.Value(1) - 1,
                    vertexOffset + tri.Value(2) - 1,
                    vertexOffset + tri.Value(3) - 1
                );
                tri.delete(); // Delete C++ proxy wrapper
            }
            vertexOffset += nNodes;
        }

        face.delete();
        location.delete();
        explorer.Next();
    }

    explorer.delete();

    const vertexArray = new Float32Array(vertices);
    const normalArray = new Float32Array(normals);
    const indexArray = new Uint32Array(indices);

    console.log(`[OCCT Worker] Faces: ${faceCount}, Extracted ${vertices.length / 3} vertices and ${indices.length / 3} triangles.`);

    // Safety check against bad meshes
    if (vertices.length === 0) {
        console.warn('[OCCT Worker] WARNING: Mesh extraction yielded 0 vertices. Solid bounds:',
            width, height, depth, `Ops count: ${ops.length}`
        );
    }

    return { vertices: vertexArray, normals: normalArray, indices: indexArray };
}

self.onmessage = async (e) => {
    if (e.data.type !== 'SOLID_MODEL') return;

    try {
        const result = await buildSolid(e.data);
        self.postMessage(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer]);
    } catch (err) {
        self.postMessage({
            vertices: new Float32Array(),
            normals: new Float32Array(),
            indices: new Uint32Array(),
            error: err.message
        });
    }
};
