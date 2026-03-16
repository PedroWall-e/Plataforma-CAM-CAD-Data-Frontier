// occt_wrapper.cpp — Pipeline B-Rep → tessela → arrays planos

#include "occt_wrapper.h"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <Poly_Triangulation.hxx>
#include <TopLoc_Location.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

// ── Tessela qualquer TopoDS_Shape → MeshDataC ─────────────────────────────────
MeshDataC TesselateOcctShape(const TopoDS_Shape& shape, double deflection) {
    MeshDataC result;

    BRepMesh_IncrementalMesh mesher(shape, deflection);
    mesher.Perform();

    uint32_t vertexOffset = 0;

    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face face = TopoDS::Face(ex.Current());

        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
        if (tri.IsNull()) continue;

        const int nbNodes     = tri->NbNodes();
        const int nbTriangles = tri->NbTriangles();
        const bool hasTrsf    = !loc.IsIdentity();
        const gp_Trsf trsf    = hasTrsf ? loc.Transformation() : gp_Trsf();

        for (int i = 1; i <= nbNodes; ++i) {
            gp_Pnt p = tri->Node(i);
            if (hasTrsf) p.Transform(trsf);
            result.vertices.push_back(static_cast<float>(p.X()));
            result.vertices.push_back(static_cast<float>(p.Y()));
            result.vertices.push_back(static_cast<float>(p.Z()));
        }

        for (int i = 1; i <= nbTriangles; ++i) {
            Standard_Integer n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);
            result.indices.push_back(vertexOffset + static_cast<uint32_t>(n1 - 1));
            result.indices.push_back(vertexOffset + static_cast<uint32_t>(n2 - 1));
            result.indices.push_back(vertexOffset + static_cast<uint32_t>(n3 - 1));
        }

        vertexOffset += static_cast<uint32_t>(nbNodes);
    }

    return result;
}

// ── Primitivas públicas ───────────────────────────────────────────────────────

MeshDataC GenerateBoxMesh(double w, double h, double d) {
    BRepPrimAPI_MakeBox maker(w, h, d);
    maker.Build();
    return TesselateOcctShape(maker.Shape());
}

MeshDataC GenerateCylinderMesh(double radius, double height) {
    BRepPrimAPI_MakeCylinder maker(radius, height);
    maker.Build();
    return TesselateOcctShape(maker.Shape());
}

MeshDataC GenerateSphereMesh(double radius) {
    BRepPrimAPI_MakeSphere maker(radius);
    maker.Build();
    return TesselateOcctShape(maker.Shape(), 0.05); // deflexão menor para superfície curva suave
}

MeshDataC GenerateConeMesh(double radius_bottom, double radius_top, double height) {
    BRepPrimAPI_MakeCone maker(radius_bottom, radius_top, height);
    maker.Build();
    return TesselateOcctShape(maker.Shape());
}
