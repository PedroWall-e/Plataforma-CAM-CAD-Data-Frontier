/*
 * occt_bridge_c.cpp — FFI C-compatible (Fase 2+: thread-safe + transform real)
 *
 * g_shapes: std::map<int, TopoDS_Shape> — store em memória protegida por mutex
 * create_*: geram primitiva, guardam na store, retornam ID
 * transform_shape_c: aplica BRepBuilderAPI_Transform ao shape armazenado
 */

#include "occt_bridge_c.h"
#include "occt_wrapper.h"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <TopExp_Explorer.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>
#include <TopoDS.hxx>
// Export
#include <StlAPI_Writer.hxx>
#include <STEPControl_Writer.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <Standard_Failure.hxx>

#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <vector>

// ── Shape store (thread-safe) ─────────────────────────────────────────────────
static std::map<int, TopoDS_Shape>              g_shapes;     // estado actual
static std::map<int, TopoDS_Shape>              g_originals;  // forma original — nunca mutada
static std::map<int, std::vector<TopoDS_Shape>> g_undo_stack; // histórico de undo por shape
static std::map<int, std::vector<TopoDS_Shape>> g_redo_stack; // stack de redo por shape
static int                                      g_next_id = 1;
static std::mutex                               g_shapes_mutex;

// Empilha o estado actual de g_shapes[id] no undo stack e limpa o redo.
// Deve ser chamado ANTES de qualquer operação destrutiva.
static void push_undo(int id) {
    auto it = g_shapes.find(id);
    if (it == g_shapes.end()) return;
    g_undo_stack[id].push_back(it->second);
    g_redo_stack[id].clear();
}


// ── Utilitário: copia MeshDataC → OcctMesh ────────────────────────────────────
static void mesh_from_data(const MeshDataC& data, OcctMesh* out) {
    out->vertex_count = static_cast<int>(data.vertices.size());
    out->vertices     = static_cast<float*>(malloc(out->vertex_count * sizeof(float)));
    if (out->vertices && !data.vertices.empty())
        memcpy(out->vertices, data.vertices.data(), out->vertex_count * sizeof(float));

    out->index_count = static_cast<int>(data.indices.size());
    out->indices     = static_cast<unsigned*>(malloc(out->index_count * sizeof(unsigned)));
    if (out->indices && !data.indices.empty())
        memcpy(out->indices, data.indices.data(), out->index_count * sizeof(unsigned));
}

// Guarda shape na store e opcionalmente tessela. DEVE ser chamado com lock já adquirido.
static int store_and_mesh_locked(const TopoDS_Shape& shape, OcctMesh* out, double defl = 0.1) {
    int id = g_next_id++;
    g_shapes[id]    = shape;   // estado derivado (actualizado por transform)
    g_originals[id] = shape;   // baseline imutável — lido em transform_shape_c
    if (out) mesh_from_data(TesselateOcctShape(shape, defl), out);
    return id;
}

extern "C" {

// ── Primitivas com shape store ────────────────────────────────────────────────

int create_box_c(double w, double h, double d, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        BRepPrimAPI_MakeBox m(w, h, d); m.Build();
        return store_and_mesh_locked(m.Shape(), out);
    } catch (const Standard_Failure& e) {
        return -1;
    } catch (const std::exception&) {
        return -1;
    }
}

int create_cylinder_c(double radius, double height, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        BRepPrimAPI_MakeCylinder m(radius, height); m.Build();
        return store_and_mesh_locked(m.Shape(), out);
    } catch (const Standard_Failure&) {
        return -1;
    } catch (const std::exception&) {
        return -1;
    }
}

int create_sphere_c(double radius, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        BRepPrimAPI_MakeSphere m(radius); m.Build();
        return store_and_mesh_locked(m.Shape(), out, 0.05);
    } catch (const Standard_Failure&) {
        return -1;
    } catch (const std::exception&) {
        return -1;
    }
}

int create_cone_c(double rb, double rt, double height, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        BRepPrimAPI_MakeCone m(rb, rt, height); m.Build();
        return store_and_mesh_locked(m.Shape(), out);
    } catch (const Standard_Failure&) {
        return -1;
    } catch (const std::exception&) {
        return -1;
    }
}

// ── Backwards-compat (sem store) ─────────────────────────────────────────────

void generate_box_mesh_c(double w, double h, double d, OcctMesh* out) {
    try {
        if (out) mesh_from_data(GenerateBoxMesh(w, h, d), out);
    } catch (...) { /* silencioso */ }
}
void generate_cylinder_mesh_c(double radius, double height, OcctMesh* out) {
    try {
        if (out) mesh_from_data(GenerateCylinderMesh(radius, height), out);
    } catch (...) { /* silencioso */ }
}
void generate_sphere_mesh_c(double radius, OcctMesh* out) {
    try {
        if (out) mesh_from_data(GenerateSphereMesh(radius), out);
    } catch (...) { /* silencioso */ }
}
void generate_cone_mesh_c(double rb, double rt, double height, OcctMesh* out) {
    try {
        if (out) mesh_from_data(GenerateConeMesh(rb, rt, height), out);
    } catch (...) { /* silencioso */ }
}

// ── Transform ─────────────────────────────────────────────────────────────────
/*
 * Recebe matrix16: 16 floats em coluna-major (Three.js Matrix4.elements).
 * Constrói uma gp_Trsf isométrica (translate + rotate) e aplica via
 * BRepBuilderAPI_Transform. Scale não-uniforme não é suportado por gp_Trsf;
 * para esse caso o frontend mantém o scale puramente visual no Three.js.
 */
int transform_shape_c(int shape_id, const float* m, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);

        // Lê o ORIGINAL (nunca mutado) → idempotente para Undo
        auto it = g_originals.find(shape_id);
        if (it == g_originals.end()) return -1;

        gp_Trsf trsf;
        trsf.SetValues(
            static_cast<double>(m[0]),  static_cast<double>(m[4]),  static_cast<double>(m[8]),  static_cast<double>(m[12]),
            static_cast<double>(m[1]),  static_cast<double>(m[5]),  static_cast<double>(m[9]),  static_cast<double>(m[13]),
            static_cast<double>(m[2]),  static_cast<double>(m[6]),  static_cast<double>(m[10]), static_cast<double>(m[14])
        );

        BRepBuilderAPI_Transform builder(it->second, trsf, /*copy=*/true);
        builder.Build();
        if (!builder.IsDone()) return -1;

        g_shapes[shape_id] = builder.Shape(); // actualiza estado derivado
        if (out) mesh_from_data(TesselateOcctShape(g_shapes[shape_id]), out);
        return shape_id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

void remove_shape_c(int shape_id) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        g_shapes.erase(shape_id);
        g_originals.erase(shape_id);
    } catch (...) { /* silencioso */ }
}

int clone_shape_c(int shape_id, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end()) return -1;
        BRepBuilderAPI_Copy copier(it->second, /*copyGeom=*/true, /*copyMesh=*/false);
        copier.Build();
        if (!copier.IsDone()) return -1;
        return store_and_mesh_locked(copier.Shape(), out);
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

void free_occt_mesh(OcctMesh* mesh) {
    if (!mesh) return;
    free(mesh->vertices);  mesh->vertices    = nullptr; mesh->vertex_count = 0;
    free(mesh->indices);   mesh->indices     = nullptr; mesh->index_count  = 0;
}

// ─── Operações Booleanas ─────────────────────────────────────────────────────

// Union: A ∪ B → novo shape substitui A, B é removido. Retorna idA ou -1.
int boolean_union_c(int id_a, int id_b, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto itA = g_shapes.find(id_a);
        auto itB = g_shapes.find(id_b);
        if (itA == g_shapes.end() || itB == g_shapes.end()) return -1;

        push_undo(id_a); // ★ undo
        BRepAlgoAPI_Fuse fuse(itA->second, itB->second);
        fuse.Build();
        if (!fuse.IsDone()) { g_undo_stack[id_a].pop_back(); return -1; }
        const TopoDS_Shape& result = fuse.Shape();

        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);
        g_undo_stack.erase(id_b); // limpa undo do shape removido
        g_redo_stack.erase(id_b);

        if (out) mesh_from_data(TesselateOcctShape(result, 0.1), out);
        return id_a;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// Cut: A − B → resultado substitui A, B é removido. Retorna idA ou -1.
int boolean_cut_c(int id_a, int id_b, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto itA = g_shapes.find(id_a);
        auto itB = g_shapes.find(id_b);
        if (itA == g_shapes.end() || itB == g_shapes.end()) return -1;

        push_undo(id_a); // ★ undo
        BRepAlgoAPI_Cut cut(itA->second, itB->second);
        cut.Build();
        if (!cut.IsDone()) { g_undo_stack[id_a].pop_back(); return -1; }
        const TopoDS_Shape& result = cut.Shape();

        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);
        g_undo_stack.erase(id_b);
        g_redo_stack.erase(id_b);

        if (out) mesh_from_data(TesselateOcctShape(result, 0.1), out);
        return id_a;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// Intersect: A ∩ B → resultado substitui A, B é removido. Retorna idA ou -1.
int boolean_intersect_c(int id_a, int id_b, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto itA = g_shapes.find(id_a);
        auto itB = g_shapes.find(id_b);
        if (itA == g_shapes.end() || itB == g_shapes.end()) return -1;

        push_undo(id_a); // ★ undo
        BRepAlgoAPI_Common common(itA->second, itB->second);
        common.Build();
        if (!common.IsDone()) { g_undo_stack[id_a].pop_back(); return -1; }
        const TopoDS_Shape& result = common.Shape();

        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);
        g_undo_stack.erase(id_b);
        g_redo_stack.erase(id_b);

        if (out) mesh_from_data(TesselateOcctShape(result, 0.1), out);
        return id_a;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// ─── Fillet & Chamfer ──────────────────────────────────────────────────────────

// Arredonda TODAS as arestas com o raio dado. Retorna shape_id ou -1.
int fillet_all_c(int shape_id, float radius, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end()) return -1;

        push_undo(shape_id); // ★ undo
        BRepFilletAPI_MakeFillet fillet(it->second);
        TopExp_Explorer exp(it->second, TopAbs_EDGE);
        int edge_count = 0;
        while (exp.More()) {
            fillet.Add(static_cast<double>(radius), TopoDS::Edge(exp.Current()));
            exp.Next(); ++edge_count;
        }
        if (edge_count == 0) { g_undo_stack[shape_id].pop_back(); return -1; }
        fillet.Build();
        if (!fillet.IsDone()) { g_undo_stack[shape_id].pop_back(); return -1; }

        const TopoDS_Shape& result = fillet.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;

        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// Chanfra TODAS as arestas com a distância dada. Retorna shape_id ou -1.
int chamfer_all_c(int shape_id, float dist, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end()) return -1;

        push_undo(shape_id); // ★ undo
        BRepFilletAPI_MakeChamfer chamfer(it->second);
        TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
        TopExp::MapShapesAndAncestors(it->second, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);
        for (int i = 1; i <= edgeFaceMap.Extent(); ++i) {
            const TopoDS_Edge& edge  = TopoDS::Edge(edgeFaceMap.FindKey(i));
            const TopTools_ListOfShape& faces = edgeFaceMap.FindFromIndex(i);
            if (faces.Extent() >= 1)
                chamfer.Add(static_cast<double>(dist), static_cast<double>(dist), edge, TopoDS::Face(faces.First()));
        }
        chamfer.Build();
        if (!chamfer.IsDone()) { g_undo_stack[shape_id].pop_back(); return -1; }

        const TopoDS_Shape& result = chamfer.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;

        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// ─── Shell (Casca oca) ─────────────────────────────────────────────────────────

// Cria uma casca oca. Retorna shape_id ou -1 em erro.
int shell_c(int shape_id, float thickness, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end()) return -1;

        push_undo(shape_id); // ★ undo
        const TopoDS_Shape& shape = it->second;
        TopoDS_Face topFace; double maxY = -1e30; bool found = false;
        TopExp_Explorer faceExp(shape, TopAbs_FACE);
        while (faceExp.More()) {
            const TopoDS_Face& f = TopoDS::Face(faceExp.Current());
            GProp_GProps props; BRepGProp::SurfaceProperties(f, props);
            double cy = props.CentreOfMass().Y();
            if (cy > maxY) { maxY = cy; topFace = f; found = true; }
            faceExp.Next();
        }
        if (!found) { g_undo_stack[shape_id].pop_back(); return -1; }

        TopTools_ListOfShape facesToRemove; facesToRemove.Append(topFace);
        BRepOffsetAPI_MakeThickSolid thickener;
        thickener.MakeThickSolidByJoin(shape, facesToRemove,
            -static_cast<double>(thickness), 1.0e-3);
        thickener.Build();
        if (!thickener.IsDone()) { g_undo_stack[shape_id].pop_back(); return -1; }

        const TopoDS_Shape& result = thickener.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;

        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// ─── Export STL ──────────────────────────────────────────────────────────────
int export_stl_c(int shape_id, const char* path) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end() || !path) return -1;
    try {
        StlAPI_Writer writer;
        // ASCII=false → binário (menor); ASCII=true → texto legível
        writer.ASCIIMode() = Standard_False;
        if (!writer.Write(it->second, path)) return -1;
        return 0;
    } catch (...) { return -1; }
}

// ─── Export STEP ─────────────────────────────────────────────────────────────
int export_step_c(int shape_id, const char* path) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end() || !path) return -1;
    try {
        STEPControl_Writer writer;
        IFSelect_ReturnStatus status = writer.Transfer(it->second, STEPControl_AsIs);
        if (status != IFSelect_RetDone) return -1;
        if (writer.Write(path) != IFSelect_RetDone) return -1;
        return 0;
    } catch (...) { return -1; }
}

// ─── Edge Selection Helpers ───────────────────────────────────────────────────
#include <BRep_Tool.hxx>
#include <Geom_Curve.hxx>
#include <gp_Pnt.hxx>

// Conta arestas do shape
int get_edge_count_c(int shape_id) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end()) return -1;
    int count = 0;
    for (TopExp_Explorer ex(it->second, TopAbs_EDGE); ex.More(); ex.Next()) count++;
    return count;
}

// Ponto médio de cada aresta → array float[3*n]  (para raycasting no frontend)
int get_edge_midpoints_c(int shape_id, float* out_xyz, int max_edges) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end() || !out_xyz) return -1;
    int i = 0;
    for (TopExp_Explorer ex(it->second, TopAbs_EDGE); ex.More() && i < max_edges; ex.Next(), ++i) {
        const TopoDS_Edge& edge = TopoDS::Edge(ex.Current());
        Standard_Real first, last;
        Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
        if (curve.IsNull()) { out_xyz[i*3]=0; out_xyz[i*3+1]=0; out_xyz[i*3+2]=0; continue; }
        gp_Pnt mid;
        curve->D0((first + last) * 0.5, mid);
        out_xyz[i*3]   = (float)mid.X();
        out_xyz[i*3+1] = (float)mid.Y();
        out_xyz[i*3+2] = (float)mid.Z();
    }
    return i;
}

// Fillet em arestas específicas (edge_ids[]: índices 0-based das arestas)
int fillet_edges_c(int shape_id, const int* edge_ids, int n, float radius, OcctMesh* out) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end() || !edge_ids || n <= 0) return -1;
    try {
        push_undo(shape_id); // ★ undo
        std::vector<TopoDS_Edge> edges;
        for (TopExp_Explorer ex(it->second, TopAbs_EDGE); ex.More(); ex.Next())
            edges.push_back(TopoDS::Edge(ex.Current()));

        BRepFilletAPI_MakeFillet fillet(it->second);
        for (int k = 0; k < n; ++k)
            if (edge_ids[k] >= 0 && edge_ids[k] < (int)edges.size())
                fillet.Add((double)radius, edges[edge_ids[k]]);
        fillet.Build();
        if (!fillet.IsDone()) { g_undo_stack[shape_id].pop_back(); return -1; }
        const TopoDS_Shape& result = fillet.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;
        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (...) { return -1; }
}

// Chamfer em arestas específicas
int chamfer_edges_c(int shape_id, const int* edge_ids, int n, float dist, OcctMesh* out) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end() || !edge_ids || n <= 0) return -1;
    try {
        push_undo(shape_id); // ★ undo
        std::vector<TopoDS_Edge> edges;
        for (TopExp_Explorer ex(it->second, TopAbs_EDGE); ex.More(); ex.Next())
            edges.push_back(TopoDS::Edge(ex.Current()));

        BRepFilletAPI_MakeChamfer chamfer(it->second);
        TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
        TopExp::MapShapesAndAncestors(it->second, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);
        for (int k = 0; k < n; ++k) {
            if (edge_ids[k] < 0 || edge_ids[k] >= (int)edges.size()) continue;
            const TopoDS_Edge& e = edges[edge_ids[k]];
            int idx = edgeFaceMap.FindIndex(e);
            if (idx < 1) continue;
            const TopTools_ListOfShape& faces = edgeFaceMap.FindFromIndex(idx);
            if (faces.IsEmpty()) continue;
            chamfer.Add((double)dist, (double)dist, e, TopoDS::Face(faces.First()));
        }
        chamfer.Build();
        if (!chamfer.IsDone()) { g_undo_stack[shape_id].pop_back(); return -1; }
        const TopoDS_Shape& result = chamfer.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;
        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (...) { return -1; }
}

// ─── Undo / Redo ────────────────────────────────────────────────────────────────────

// Retorna quantos estados de undo existem para o shape (0 = nada a desfazer).
int undo_depth_c(int shape_id) {
    auto it = g_undo_stack.find(shape_id);
    return (it == g_undo_stack.end()) ? 0 : (int)it->second.size();
}

// Retorna quantos estados de redo existem para o shape.
int redo_depth_c(int shape_id) {
    auto it = g_redo_stack.find(shape_id);
    return (it == g_redo_stack.end()) ? 0 : (int)it->second.size();
}

// Desfaz a última operação sobre shape_id.
// Empurra estado atual no redo stack antes de restaurar. Retorna shape_id ou -1.
int undo_shape_c(int shape_id, OcctMesh* out) {
    std::lock_guard<std::mutex> lock(g_shapes_mutex);
    auto& ustack = g_undo_stack[shape_id];
    if (ustack.empty()) return -1;
    // Salva estado actual no redo stack
    auto it = g_shapes.find(shape_id);
    if (it != g_shapes.end())
        g_redo_stack[shape_id].push_back(it->second);
    // Restaura estado anterior
    TopoDS_Shape prev = ustack.back();
    ustack.pop_back();
    g_shapes[shape_id]    = prev;
    g_originals[shape_id] = prev;
    if (out) mesh_from_data(TesselateOcctShape(prev, 0.05), out);
    return shape_id;
}

// Refaz a operação desfeita mais recente (Ctrl+Y).
// Empurra estado atual no undo stack antes de aplicar. Retorna shape_id ou -1.
int redo_shape_c(int shape_id, OcctMesh* out) {
    std::lock_guard<std::mutex> lock(g_shapes_mutex);
    auto& rstack = g_redo_stack[shape_id];
    if (rstack.empty()) return -1;
    // Salva estado actual no undo stack
    auto it = g_shapes.find(shape_id);
    if (it != g_shapes.end())
        g_undo_stack[shape_id].push_back(it->second);
    // Aplica estado redo
    TopoDS_Shape next = rstack.back();
    rstack.pop_back();
    g_shapes[shape_id]    = next;
    g_originals[shape_id] = next;
    if (out) mesh_from_data(TesselateOcctShape(next, 0.05), out);
    return shape_id;
}

} /* extern "C" — fim das funções existentes */


// ─── Fase 4: Workplane + Extrude + Revolve ────────────────────────────────────
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <GeomLProp_SLProps.hxx>
#include <Geom_Surface.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

static constexpr double OCCT_PI = 3.14159265358979323846;

extern "C" {

/**
 * get_face_plane_c — Extrai o sistema de coordenadas de uma face plana.
 *
 * out_f32[0..2]  = origin (centro da face)
 * out_f32[3..5]  = normal
 * out_f32[6..8]  = u_axis (eixo "direita" no plano)
 * out_f32[9..11] = v_axis (eixo "cima" no plano)
 *
 * Retorna 0 em sucesso, -1 em erro.
 */
int get_face_plane_c(int shape_id, int face_index, float* out_f32) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end() || !out_f32) return -1;

        // Itera sobre as faces para encontrar face_index
        int idx = 0;
        TopoDS_Face found_face;
        bool found = false;
        for (TopExp_Explorer exp(it->second, TopAbs_FACE); exp.More(); exp.Next(), ++idx) {
            if (idx == face_index) {
                found_face = TopoDS::Face(exp.Current());
                found = true;
                break;
            }
        }
        if (!found) return -1;

        // Calcula centro de massa da face (origin)
        GProp_GProps props;
        BRepGProp::SurfaceProperties(found_face, props);
        gp_Pnt center = props.CentreOfMass();

        // Obtém normal no centro via GeomLProp_SLProps
        Handle(Geom_Surface) surf = BRep_Tool::Surface(found_face);
        if (surf.IsNull()) return -1;

        // Usa ponto paramétrico central para calcular normal
        Standard_Real u_min, u_max, v_min, v_max;
        BRepTools::UVBounds(found_face, u_min, u_max, v_min, v_max); // API correta OCCT
        Standard_Real u = (u_min + u_max) * 0.5;
        Standard_Real v = (v_min + v_max) * 0.5;

        GeomLProp_SLProps props2(surf, u, v, 1, 1e-6);
        if (!props2.IsNormalDefined()) return -1;

        gp_Dir normal = props2.Normal();
        // Orienta a normal para fora se necessário
        if (found_face.Orientation() == TopAbs_REVERSED)
            normal.Reverse();

        // Constrói u_axis e v_axis ortogonais (gp_Dir não tem construtor default nem Normalize())
        // Usamos gp_Vec para o cross product e depois convertemos para gp_Dir
        gp_Vec n_vec(normal.X(), normal.Y(), normal.Z());
        gp_Vec ref = (std::abs(normal.X()) < 0.9) ? gp_Vec(1, 0, 0) : gp_Vec(0, 1, 0);
        gp_Vec u_vec = n_vec.Crossed(ref).Normalized();
        gp_Vec v_vec = n_vec.Crossed(u_vec).Normalized();
        gp_Dir u_axis(u_vec.X(), u_vec.Y(), u_vec.Z());
        gp_Dir v_axis(v_vec.X(), v_vec.Y(), v_vec.Z());

        // Origin
        out_f32[0] = (float)center.X();
        out_f32[1] = (float)center.Y();
        out_f32[2] = (float)center.Z();
        // Normal
        out_f32[3] = (float)normal.X();
        out_f32[4] = (float)normal.Y();
        out_f32[5] = (float)normal.Z();
        // U axis
        out_f32[6] = (float)u_axis.X();
        out_f32[7] = (float)u_axis.Y();
        out_f32[8] = (float)u_axis.Z();
        // V axis
        out_f32[9]  = (float)v_axis.X();
        out_f32[10] = (float)v_axis.Y();
        out_f32[11] = (float)v_axis.Z();
        return 0;
    } catch (...) { return -1; }
}

/**
 * Converte array de pontos 2D (u,v) + matriz de plano (col-major 4x4 Three.js)
 * para pontos 3D em world-space e constrói um TopoDS_Wire fechado.
 */
static TopoDS_Wire build_wire_from_2d(
    const float* xy, int n_pts,
    const float* m   // plane_mat16 col-major: col0=(m[0],m[1],m[2]), col1=(m[4],m[5],m[6]), origem=(m[12],m[13],m[14])
) {
    // Extrai eixos do plano da matrix (Three.js col-major 4x4)
    // u_axis = coluna 0, v_axis = coluna 1, origem = coluna 3
    gp_Vec u_axis(m[0], m[1], m[2]);
    gp_Vec v_axis(m[4], m[5], m[6]);
    gp_Pnt origin(m[12], m[13], m[14]);

    BRepBuilderAPI_MakeWire wire_builder;
    for (int i = 0; i < n_pts; ++i) {
        int j = (i + 1) % n_pts;
        double u0 = xy[i*2], v0 = xy[i*2+1];
        double u1 = xy[j*2], v1 = xy[j*2+1];

        gp_Pnt P0 = origin.Translated(u_axis.Multiplied(u0) + v_axis.Multiplied(v0));
        gp_Pnt P1 = origin.Translated(u_axis.Multiplied(u1) + v_axis.Multiplied(v1));

        if (P0.Distance(P1) < 1e-7) continue; // Ignora segmentos degenerados
        BRepBuilderAPI_MakeEdge edge(P0, P1);
        if (!edge.IsDone()) continue;
        wire_builder.Add(edge.Edge());
    }
    if (!wire_builder.IsDone()) return TopoDS_Wire();
    return wire_builder.Wire();
}

/**
 * extrude_profile_c — Extrude um perfil 2D por uma profundidade dada.
 *
 * @param xy           Pontos 2D no espaço do plano (u,v pairs, n_pts pontos)
 * @param n_pts        Nº de pontos
 * @param plane_mat16  Matriz 4x4 col-major do plano (Three.js Matrix4.elements)
 * @param depth        Profundidade da extrusão (positivo = direção da normal)
 * @param fuse_with    -1 = novo shape; ≥0 = funde o resultado com esse shape_id
 * @param out          Malha tesselada de saída
 * @return shape_id ou -1
 */
int extrude_profile_c(
    const float* xy, int n_pts,
    const float* plane_mat16,
    float depth,
    int fuse_with,
    OcctMesh* out
) {
    if (!xy || n_pts < 3 || !plane_mat16) return -1;
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);

        TopoDS_Wire wire = build_wire_from_2d(xy, n_pts, plane_mat16);
        if (wire.IsNull()) return -1;

        BRepBuilderAPI_MakeFace face_builder(wire, /*onlyPlane=*/Standard_True);
        if (!face_builder.IsDone()) return -1;

        // Direção de extrusão = normal do plano (col 2 da matrix = m[8],m[9],m[10])
        gp_Vec extrude_dir(plane_mat16[8], plane_mat16[9], plane_mat16[10]);
        extrude_dir.Normalize();
        extrude_dir.Multiply(static_cast<double>(depth));

        BRepPrimAPI_MakePrism prism(face_builder.Face(), extrude_dir, /*copy=*/Standard_True);
        prism.Build();
        if (!prism.IsDone()) return -1;

        TopoDS_Shape result = prism.Shape();

        // Se fuse_with ≥ 0, funde o resultado com o shape existente
        if (fuse_with >= 0) {
            auto it = g_shapes.find(fuse_with);
            if (it == g_shapes.end()) return -1;
            push_undo(fuse_with);
            BRepAlgoAPI_Fuse fuse(it->second, result);
            fuse.Build();
            if (!fuse.IsDone()) { g_undo_stack[fuse_with].pop_back(); return -1; }
            result = fuse.Shape();
            g_shapes[fuse_with]    = result;
            g_originals[fuse_with] = result;
            if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
            return fuse_with;
        }

        // Novo shape
        int id = store_and_mesh_locked(result, out, 0.05);
        return id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

/**
 * revolve_profile_c — Revolve um perfil 2D em torno de um eixo.
 *
 * @param xy           Pontos 2D no espaço do plano (u,v pairs)
 * @param n_pts        Nº de pontos
 * @param plane_mat16  Matriz 4x4 col-major do plano de origem
 * @param axis_xyz     Direção do eixo de revolução (3 floats, world-space)
 * @param angle_deg    Ângulo de rotação em graus
 * @param fuse_with    -1 = novo shape; ≥0 = funde com shape existente
 * @param out          Malha tesselada de saída
 * @return shape_id ou -1
 */
int revolve_profile_c(
    const float* xy, int n_pts,
    const float* plane_mat16,
    const float* axis_xyz,
    float angle_deg,
    int fuse_with,
    OcctMesh* out
) {
    if (!xy || n_pts < 2 || !plane_mat16 || !axis_xyz) return -1;
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);

        TopoDS_Wire wire = build_wire_from_2d(xy, n_pts, plane_mat16);
        if (wire.IsNull()) return -1;

        // Face plana a partir do wire (perfil de revolução)
        BRepBuilderAPI_MakeFace face_builder(wire, Standard_True);
        if (!face_builder.IsDone()) return -1;

        // Eixo de revolução: passa pela origem do plano
        gp_Pnt axis_origin(plane_mat16[12], plane_mat16[13], plane_mat16[14]);
        gp_Dir axis_dir(axis_xyz[0], axis_xyz[1], axis_xyz[2]);
        gp_Ax1 axis(axis_origin, axis_dir);

        double angle_rad = static_cast<double>(angle_deg) * OCCT_PI / 180.0;
        BRepPrimAPI_MakeRevol revol(face_builder.Face(), axis, angle_rad, Standard_True);
        revol.Build();
        if (!revol.IsDone()) return -1;

        TopoDS_Shape result = revol.Shape();

        if (fuse_with >= 0) {
            auto it = g_shapes.find(fuse_with);
            if (it == g_shapes.end()) return -1;
            push_undo(fuse_with);
            BRepAlgoAPI_Fuse fuse(it->second, result);
            fuse.Build();
            if (!fuse.IsDone()) { g_undo_stack[fuse_with].pop_back(); return -1; }
            result = fuse.Shape();
            g_shapes[fuse_with]    = result;
            g_originals[fuse_with] = result;
            if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
            return fuse_with;
        }

        int id = store_and_mesh_locked(result, out, 0.05);
        return id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

} /* extern "C" — Fase 4 */


