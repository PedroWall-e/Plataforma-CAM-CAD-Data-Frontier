/*
 * occt_bridge_c.cpp — Bridge C-compatible (sem BRepBuilderAPI_GTransform)
 *
 * g_shapes: std::map<int, TopoDS_Shape> — store em memória
 * create_*: geram primitiva, guardam na store, retornam ID
 * transform_shape_c: DESACTIVADO (causava ACCESS_VIOLATION)
 */

#include "occt_bridge_c.h"
#include "occt_wrapper.h"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <TopoDS_Shape.hxx>

#include <cstdlib>
#include <cstring>
#include <map>

// ── Shape store ───────────────────────────────────────────────────────────────
static std::map<int, TopoDS_Shape> g_shapes;
static int g_next_id = 1;

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

static int store_and_mesh(const TopoDS_Shape& shape, OcctMesh* out, double defl = 0.1) {
    int id = g_next_id++;
    g_shapes[id] = shape;
    if (out) mesh_from_data(TesselateOcctShape(shape, defl), out);
    return id;
}

extern "C" {

// ── Primitivas com shape store ────────────────────────────────────────────────

int create_box_c(double w, double h, double d, OcctMesh* out) {
    BRepPrimAPI_MakeBox m(w, h, d); m.Build();
    return store_and_mesh(m.Shape(), out);
}

int create_cylinder_c(double radius, double height, OcctMesh* out) {
    BRepPrimAPI_MakeCylinder m(radius, height); m.Build();
    return store_and_mesh(m.Shape(), out);
}

int create_sphere_c(double radius, OcctMesh* out) {
    BRepPrimAPI_MakeSphere m(radius); m.Build();
    return store_and_mesh(m.Shape(), out, 0.05);
}

int create_cone_c(double rb, double rt, double height, OcctMesh* out) {
    BRepPrimAPI_MakeCone m(rb, rt, height); m.Build();
    return store_and_mesh(m.Shape(), out);
}

// ── Backwards-compat (sem store) ─────────────────────────────────────────────

void generate_box_mesh_c(double w, double h, double d, OcctMesh* out) {
    if (out) mesh_from_data(GenerateBoxMesh(w, h, d), out);
}
void generate_cylinder_mesh_c(double radius, double height, OcctMesh* out) {
    if (out) mesh_from_data(GenerateCylinderMesh(radius, height), out);
}
void generate_sphere_mesh_c(double radius, OcctMesh* out) {
    if (out) mesh_from_data(GenerateSphereMesh(radius), out);
}
void generate_cone_mesh_c(double rb, double rt, double height, OcctMesh* out) {
    if (out) mesh_from_data(GenerateConeMesh(rb, rt, height), out);
}

// ── Transform — stub (funcionalidade visual-only no Three.js por agora) ──────
int transform_shape_c(int shape_id, const float* /*m*/, OcctMesh* out) {
    auto it = g_shapes.find(shape_id);
    if (it == g_shapes.end()) return -1;
    // Apenas re-tessela o shape original (sem transformação OCCT)
    if (out) mesh_from_data(TesselateOcctShape(it->second), out);
    return shape_id;
}

void remove_shape_c(int shape_id) {
    g_shapes.erase(shape_id);
}

void free_occt_mesh(OcctMesh* mesh) {
    if (!mesh) return;
    free(mesh->vertices);  mesh->vertices    = nullptr; mesh->vertex_count = 0;
    free(mesh->indices);   mesh->indices     = nullptr; mesh->index_count  = 0;
}

} /* extern "C" */
