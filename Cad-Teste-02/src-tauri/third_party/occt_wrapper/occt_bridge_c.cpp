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

// ── Shape store (thread-safe) ─────────────────────────────────────────────────
static std::map<int, TopoDS_Shape> g_shapes;    // estado actual (derivado)
static std::map<int, TopoDS_Shape> g_originals; // forma original — nunca mutada
static int                         g_next_id = 1;
static std::mutex                  g_shapes_mutex;

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

        BRepAlgoAPI_Fuse fuse(itA->second, itB->second);
        fuse.Build();
        if (!fuse.IsDone()) return -1;
        const TopoDS_Shape& result = fuse.Shape();

        // Substitui A pelo resultado; remove B
        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);

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

        BRepAlgoAPI_Cut cut(itA->second, itB->second);
        cut.Build();
        if (!cut.IsDone()) return -1;
        const TopoDS_Shape& result = cut.Shape();

        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);

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

        BRepAlgoAPI_Common common(itA->second, itB->second);
        common.Build();
        if (!common.IsDone()) return -1;
        const TopoDS_Shape& result = common.Shape();

        g_shapes[id_a]    = result;
        g_originals[id_a] = result;
        g_shapes.erase(id_b);
        g_originals.erase(id_b);

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

        BRepFilletAPI_MakeFillet fillet(it->second);

        // Itera todas as arestas do shape
        TopExp_Explorer exp(it->second, TopAbs_EDGE);
        int edge_count = 0;
        while (exp.More()) {
            fillet.Add(static_cast<double>(radius), TopoDS::Edge(exp.Current()));
            exp.Next();
            ++edge_count;
        }
        if (edge_count == 0) return -1;

        fillet.Build();
        if (!fillet.IsDone()) return -1;

        const TopoDS_Shape& result = fillet.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;

        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out); // deflexão menor para suavidade
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

        BRepFilletAPI_MakeChamfer chamfer(it->second);

        // Mapa aresta → faces adjacentes (necessário para BRepFilletAPI_MakeChamfer)
        TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
        TopExp::MapShapesAndAncestors(
            it->second, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

        for (int i = 1; i <= edgeFaceMap.Extent(); ++i) {
            const TopoDS_Edge& edge  = TopoDS::Edge(edgeFaceMap.FindKey(i));
            const TopTools_ListOfShape& faces = edgeFaceMap.FindFromIndex(i);
            if (faces.Extent() >= 1) {
                const TopoDS_Face& face = TopoDS::Face(faces.First());
                chamfer.Add(static_cast<double>(dist), static_cast<double>(dist), edge, face);
            }
        }

        chamfer.Build();
        if (!chamfer.IsDone()) return -1;

        const TopoDS_Shape& result = chamfer.Shape();
        g_shapes[shape_id]    = result;
        g_originals[shape_id] = result;

        if (out) mesh_from_data(TesselateOcctShape(result, 0.05), out);
        return shape_id;
    } catch (const Standard_Failure&) { return -1; }
      catch (const std::exception&)   { return -1; }
}

// ─── Shell (Casca oca) ─────────────────────────────────────────────────────────

// Cria uma casca oca: remove a face com maior Y (topo) e aplica espessura inward.
// Retorna shape_id ou -1 em erro.
int shell_c(int shape_id, float thickness, OcctMesh* out) {
    try {
        std::lock_guard<std::mutex> lock(g_shapes_mutex);
        auto it = g_shapes.find(shape_id);
        if (it == g_shapes.end()) return -1;

        const TopoDS_Shape& shape = it->second;

        // Encontra a face com centróide mais alto (maior Y)
        TopoDS_Face topFace;
        double maxY = -1e30;
        bool   found = false;

        TopExp_Explorer faceExp(shape, TopAbs_FACE);
        while (faceExp.More()) {
            const TopoDS_Face& f = TopoDS::Face(faceExp.Current());
            GProp_GProps props;
            BRepGProp::SurfaceProperties(f, props);
            double cy = props.CentreOfMass().Y();
            if (cy > maxY) { maxY = cy; topFace = f; found = true; }
            faceExp.Next();
        }
        if (!found) return -1;

        // Lista de faces a remover (abre o topo)
        TopTools_ListOfShape facesToRemove;
        facesToRemove.Append(topFace);

        // Aplica espessura negativa (inward)
        BRepOffsetAPI_MakeThickSolid thickener;
        thickener.MakeThickSolidByJoin(
            shape,
            facesToRemove,
            -static_cast<double>(thickness), // negativo = para dentro
            1.0e-3                            // tolerância
        );
        thickener.Build();
        if (!thickener.IsDone()) return -1;

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

} /* extern "C" */
