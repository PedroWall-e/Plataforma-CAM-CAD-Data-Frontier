import initOpenCascade from '/opencascade.wasm.js';

let oc = null;

async function getOC() {
    if (oc) return oc;
    oc = await initOpenCascade({
        locateFile: () => '/opencascade.wasm.wasm',
    });
    return oc;
}

async function buildSolid(request) {
    const oc = await getOC();
    const { stock: { width, height, depth }, ops } = request;

    // 1. Cria o Bloco Base
    const stockBox = new oc.BRepPrimAPI_MakeBox_2(
        new oc.gp_Pnt_3(-width / 2, -height / 2, -depth),
        width, height, depth
    );
    let solid = stockBox.Shape();

    const findConstructor = (path, name, args) => {
        for (let i = 1; i <= 20; i++) {
            const fullName = `${name}_${i}`;
            if (path[fullName]) {
                try { return new path[fullName](...args); } catch (e) { }
            }
        }
        if (path[name]) {
            try { return new path[name](...args); } catch (e) { }
        }
        return null;
    };

    // 2. Aplica as Operações (Pocket & Drill)
    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
        const op = ops[opIdx];
        
        if (op.type === 'pocket' && op.points.length > 2) {
            const wireMaker = findConstructor(oc, 'BRepBuilderAPI_MakeWire', []);
            if (!wireMaker) continue;

            for (let i = 0; i < op.points.length; i++) {
                const p1 = op.points[i];
                const p2 = op.points[(i + 1) % op.points.length];
                const pt1 = new oc.gp_Pnt_3(p1.x, p1.y, 1);
                const pt2 = new oc.gp_Pnt_3(p2.x, p2.y, 1);
                const edgeMaker = findConstructor(oc, 'BRepBuilderAPI_MakeEdge', [pt1, pt2]);
                if (edgeMaker && edgeMaker.IsDone()) {
                    wireMaker.Add_1(edgeMaker.Edge());
                }
                pt1.delete(); pt2.delete();
                if (edgeMaker) edgeMaker.delete();
            }

            if (!wireMaker.IsDone()) continue;
            const wire = wireMaker.Wire();
            const faceMaker = findConstructor(oc, 'BRepBuilderAPI_MakeFace', [wire, false]);
            if (!faceMaker || !faceMaker.IsDone()) continue;

            // Overshoot para evitar Z-Fighting
            const vec = findConstructor(oc, 'gp_Vec', [0, 0, -(op.depth + 1.001)]); 
            const prismMaker = findConstructor(oc, 'BRepPrimAPI_MakePrism', [faceMaker.Face(), vec, false, true]);

            if (prismMaker && prismMaker.IsDone()) {
                const prismShape = prismMaker.Shape();
                const boolOp = findConstructor(oc, 'BRepAlgoAPI_Cut', [solid, prismShape]);
                if (boolOp) {
                    if (boolOp.SetFuzzyTolerance) boolOp.SetFuzzyTolerance(1e-5);
                    boolOp.Build();
                    if (boolOp.IsDone()) solid = boolOp.Shape();
                    boolOp.delete();
                }
            }
            wireMaker.delete(); faceMaker.delete(); prismMaker.delete(); vec.delete();

        } else if (op.type === 'drill') {
            for (let ptIdx = 0; ptIdx < op.points.length; ptIdx++) {
                const pt = op.points[ptIdx];
                const cutLength = op.depth + 2;
                const zBottom = 1 - cutLength;

                // CORREÇÃO: Construtores forçados e robustos para o Eixo (Ax2) com 3 parâmetros
                const center = new oc.gp_Pnt_3(pt.x, pt.y, zBottom);
                const dir = new oc.gp_Dir_4(0, 0, 1);
                const vx = new oc.gp_Dir_4(1, 0, 0);

                let ax2;
                try { ax2 = new oc.gp_Ax2_2(center, dir, vx); }
                catch(e) {
                    try { ax2 = new oc.gp_Ax2_3(center, dir); }
                    catch(e2) { ax2 = new oc.gp_Ax2(center, dir); }
                }

                let cylMaker;
                try { cylMaker = new oc.BRepPrimAPI_MakeCylinder_3(ax2, op.radius, cutLength + 1); }
                catch(e) {
                    try { cylMaker = new oc.BRepPrimAPI_MakeCylinder_2(ax2, op.radius, cutLength + 1); }
                    catch(e2) { cylMaker = new oc.BRepPrimAPI_MakeCylinder(ax2, op.radius, cutLength + 1); }
                }

                if (cylMaker && cylMaker.IsDone()) {
                    const cylShape = cylMaker.Shape();
                    let boolOp;
                    try { boolOp = new oc.BRepAlgoAPI_Cut_3(solid, cylShape); }
                    catch(e) {
                        try { boolOp = new oc.BRepAlgoAPI_Cut_2(solid, cylShape); }
                        catch(e2) { boolOp = findConstructor(oc, 'BRepAlgoAPI_Cut', [solid, cylShape]); }
                    }

                    if (boolOp) {
                        if (boolOp.SetFuzzyTolerance) boolOp.SetFuzzyTolerance(1e-5);
                        boolOp.Build();
                        if (boolOp.IsDone() && !boolOp.Shape().IsNull()) {
                            solid = boolOp.Shape();
                        }
                        boolOp.delete();
                    }
                }
                center.delete(); dir.delete(); vx.delete(); ax2.delete(); if (cylMaker) cylMaker.delete();
            }
        }
    }

    // 3. Extração da Malha para o Three.js
    const mesh = new oc.BRepMesh_IncrementalMesh_2(solid, 0.1, false, 0.5, false);
    mesh.Perform();

    const vertices = []; const normals = []; const indices = [];
    const explorer = new oc.TopExp_Explorer_2(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let vertexOffset = 0;

    while (explorer.More()) {
        const face = oc.TopoDS.Face_1(explorer.Current());
        const location = new oc.TopLoc_Location_1();
        const triangulation = oc.BRep_Tool.Triangulation(face, location);

        if (!triangulation.IsNull()) {
            const triMesh = triangulation.get();
            const nTriangles = triMesh.NbTriangles();
            const nNodes = triMesh.NbNodes();
            
            // CORREÇÃO VITAL: Extrair a Matriz de Transformação!
            const trsf = location.Transformation(); 

            for (let i = 1; i <= nNodes; i++) {
                const node = triMesh.Node(i);
                
                // Aplicar a transformação para que os furos apareçam no sítio certo!
                const pnt = new oc.gp_Pnt_3(node.X(), node.Y(), node.Z());
                pnt.Transform(trsf);

                vertices.push(pnt.X(), pnt.Y(), pnt.Z());
                pnt.delete(); node.delete();
                normals.push(0, 0, 1);
            }

            for (let i = 1; i <= nTriangles; i++) {
                const tri = triMesh.Triangle(i);
                indices.push(vertexOffset + tri.Value(1) - 1, vertexOffset + tri.Value(2) - 1, vertexOffset + tri.Value(3) - 1);
                tri.delete();
            }
            vertexOffset += nNodes;
            trsf.delete(); // Limpar memória
        }
        face.delete(); location.delete();
        explorer.Next();
    }
    explorer.delete();

    return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

self.onmessage = async (e) => {
    if (e.data.type !== 'SOLID_MODEL') return;
    try {
        const result = await buildSolid(e.data);
        self.postMessage(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer]);
    } catch (err) {
        self.postMessage({ vertices: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(), error: err.message });
    }
};