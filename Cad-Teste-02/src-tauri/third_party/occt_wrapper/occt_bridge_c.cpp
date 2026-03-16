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

} /* extern "C" */
