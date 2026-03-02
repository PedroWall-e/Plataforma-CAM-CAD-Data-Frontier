import initOpenCascade from '/opencascade.wasm.js';

let oc = null;

async function getOC() {
    if (oc) return oc;
    oc = await initOpenCascade({
        locateFile: () => '/opencascade.wasm.wasm',
    });
    return oc;
}

// Global registry for objects that need deletion
let registry = [];
const reg = (obj) => {
    if (obj && obj.delete) registry.push(obj);
    return obj;
};
const cleanup = () => {
    registry.forEach(obj => {
        try { obj.delete(); } catch (e) { }
    });
    registry = [];
};

async function buildSolid(request) {
    const oc = await getOC();
    const { stock: { width, height, depth }, ops } = request;

    console.group(`[B-Rep Worker] Iniciando Processamento`);
    console.log(`Config: ${width}x${height}x${depth}, Ops: ${ops.length}`);

    try {
        // 1. Construtor helper robusto
        const fc = (name, args) => {
            for (let i = 1; i <= 10; i++) {
                const fn = `${name}_${i}`;
                if (oc[fn]) {
                    try {
                        const obj = new oc[fn](...args);
                        console.log(`[OCCT] Construtor: ${fn} (sucesso)`);
                        return reg(obj);
                    } catch (e) { }
                }
            }
            if (oc[name]) {
                try {
                    const obj = new oc[name](...args);
                    console.log(`[OCCT] Construtor: ${name} (sucesso)`);
                    return reg(obj);
                } catch (e) { }
            }
            return null;
        };

        // 2. Criação do Bloco Base
        const p1 = reg(new oc.gp_Pnt_3(-width / 2, -height / 2, -depth));
        const stockBox = fc('BRepPrimAPI_MakeBox', [p1, width, height, depth]);
        if (!stockBox || !stockBox.IsDone()) throw new Error("Falha ao criar o Bloco Base.");

        let solid = stockBox.Shape();
        console.log("✓ Bloco Base criado.");

        // 3. Processamento de Operações
        for (let opIdx = 0; opIdx < ops.length; opIdx++) {
            const op = ops[opIdx];
            console.group(`Op ${opIdx + 1}: ${op.type}`);

            try {
                if (op.type === 'pocket' && op.points && op.points.length > 2) {
                    const wireMaker = fc('BRepBuilderAPI_MakeWire', []);
                    if (!wireMaker) throw new Error("Falha no MakeWire");

                    for (let i = 0; i < op.points.length; i++) {
                        const a = op.points[i];
                        const b = op.points[(i + 1) % op.points.length];
                        const dist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
                        if (dist < 0.001) continue;

                        const ptA = reg(new oc.gp_Pnt_3(a.x, a.y, 2));
                        const ptB = reg(new oc.gp_Pnt_3(b.x, b.y, 2));
                        const edgeMaker = fc('BRepBuilderAPI_MakeEdge', [ptA, ptB]);
                        if (edgeMaker && edgeMaker.IsDone()) {
                            wireMaker.Add_1(edgeMaker.Edge());
                        }
                    }

                    if (!wireMaker.IsDone()) throw new Error("Wire não fechado ou inválido.");

                    const faceMaker = fc('BRepBuilderAPI_MakeFace', [wireMaker.Wire(), false]);
                    if (!faceMaker || !faceMaker.IsDone()) throw new Error("Falha ao gerar Face do pocket.");

                    const vec = fc('gp_Vec', [0, 0, -(op.depth + 4)]);
                    const prism = fc('BRepPrimAPI_MakePrism', [faceMaker.Face(), vec, false, true]);
                    if (!prism || !prism.IsDone()) throw new Error("Falha na extrusão (Prism).");

                    const boolOp = fc('BRepAlgoAPI_Cut', [solid, prism.Shape()]);
                    if (boolOp) {
                        const setter = boolOp.SetFuzzyTolerance || boolOp.SetFuzzyValue;
                        if (setter) setter.call(boolOp, 1e-4);
                        boolOp.Build();
                        if (boolOp.IsDone() && !boolOp.Shape().IsNull()) {
                            solid = boolOp.Shape();
                            console.log("✓ Pocket aplicado.");
                        }
                    }
                }
                else if (op.type === 'drill') {
                    for (const pt of op.points) {
                        const loc = reg(new oc.gp_Pnt_3(pt.x, pt.y, 2));
                        const dz = reg(new oc.gp_Dir_4(0, 0, -1));
                        const dx = reg(new oc.gp_Dir_4(1, 0, 0));
                        const ax2 = fc('gp_Ax2', [loc, dz, dx]);

                        const cyl = fc('BRepPrimAPI_MakeCylinder', [ax2, op.radius, op.depth + 4]);
                        if (cyl && cyl.IsDone()) {
                            const boolOp = fc('BRepAlgoAPI_Cut', [solid, cyl.Shape()]);
                            if (boolOp) {
                                const setter = boolOp.SetFuzzyTolerance || boolOp.SetFuzzyValue;
                                if (setter) setter.call(boolOp, 1e-4);
                                boolOp.Build();
                                if (boolOp.IsDone() && !boolOp.Shape().IsNull()) {
                                    solid = boolOp.Shape();
                                }
                            }
                        }
                    }
                    console.log(`✓ ${op.points.length} furos aplicados.`);
                }
            } catch (err) {
                console.error(`Erro na Op ${opIdx + 1}:`, err.message);
            }
            console.groupEnd();
        }

        // 4. Mesh & Triangulação
        const mesh = reg(new oc.BRepMesh_IncrementalMesh_2(solid, 0.1, false, 0.5, false));
        mesh.Perform();

        const vertices = []; const normals = []; const indices = [];
        const explorer = reg(new oc.TopExp_Explorer_2(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
        let vBase = 0;

        while (explorer.More()) {
            const face = oc.TopoDS.Face_1(explorer.Current());
            const loc = reg(new oc.TopLoc_Location_1());
            const tri = oc.BRep_Tool.Triangulation(face, loc);

            if (!tri.IsNull()) {
                const meshData = tri.get();
                const nTri = meshData.NbTriangles();
                const nNodes = meshData.NbNodes();
                const trsf = loc.Transformation();

                // Extração de Normais
                const hasNormals = meshData.HasNormals();

                for (let i = 1; i <= nNodes; i++) {
                    const p = meshData.Node(i);
                    const pnt = reg(new oc.gp_Pnt_3(p.X(), p.Y(), p.Z()));
                    pnt.Transform(trsf);
                    vertices.push(pnt.X(), pnt.Y(), pnt.Z());

                    if (hasNormals) {
                        const n = meshData.Normal(i);
                        const nDir = reg(new oc.gp_Dir_5(n.X(), n.Y(), n.Z()));
                        nDir.Transform(trsf);
                        normals.push(nDir.X(), nDir.Y(), nDir.Z());
                    } else {
                        normals.push(0, 0, 1);
                    }
                }

                for (let i = 1; i <= nTri; i++) {
                    const t = meshData.Triangle(i);
                    indices.push(vBase + t.Value(1) - 1, vBase + t.Value(2) - 1, vBase + t.Value(3) - 1);
                }
                vBase += nNodes;
            }
            explorer.Next();
        }

        console.log(`✓ Malha gerada: ${vertices.length / 3} vértices.`);
        return {
            vertices: new Float32Array(vertices),
            normals: new Float32Array(normals),
            indices: new Uint32Array(indices)
        };

    } finally {
        cleanup();
        console.groupEnd();
    }
}

self.onmessage = async (e) => {
    if (e.data.type !== 'SOLID_MODEL') return;
    try {
        const result = await buildSolid(e.data);
        self.postMessage(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer]);
    } catch (err) {
        console.error("[B-Rep Worker] Fallback:", err);
        self.postMessage({ error: err.message });
    }
};