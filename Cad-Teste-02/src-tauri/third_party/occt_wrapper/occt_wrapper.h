#pragma once

#include <vector>
#include <cstdint>

// Forward-declare to avoid including OCCT headers here
class TopoDS_Shape;

struct MeshDataC {
    std::vector<float>    vertices;
    std::vector<uint32_t> indices;
};

// ── Primitivas ────────────────────────────────────────────────────────────────
MeshDataC GenerateBoxMesh     (double w, double h, double d);
MeshDataC GenerateCylinderMesh(double radius, double height);
MeshDataC GenerateSphereMesh  (double radius);
MeshDataC GenerateConeMesh    (double radius_bottom, double radius_top, double height);

// ── Tessela qualquer shape OCCT já construído ─────────────────────────────────
MeshDataC TesselateOcctShape(const TopoDS_Shape& shape, double deflection = 0.1);
