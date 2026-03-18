use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_root = PathBuf::from(&manifest_dir);

    // ── Paths ─────────────────────────────────────────────────────────────────
    let occt_inc    = project_root.join("third_party").join("occt").join("inc");
    let occt_lib    = project_root.join("third_party").join("occt").join("lib");
    let wrapper_dir = project_root.join("third_party").join("occt_wrapper");

    // ── Compilação C++ via cc (sem bindgen/autocxx, sem problemas SIMD) ───────
    cc::Build::new()
        .cpp(true)
        .flag_if_supported("-std=c++17")
        .flag_if_supported("-D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH")
        .include(&wrapper_dir)
        .include(&occt_inc)
        // Bridge C-compatible (não usa std::vector na API pública)
        .file(wrapper_dir.join("occt_bridge_c.cpp"))
        // Wrapper OCCT interno (usa std::vector internamente, ok)
        .file(wrapper_dir.join("occt_wrapper.cpp"))
        .compile("occt_bridge");

    // ── Linkagem OCCT ─────────────────────────────────────────────────────────
    println!("cargo:rustc-link-search=native={}", occt_lib.display());

    for lib in &[
        "TKernel",
        "TKMath",
        "TKBRep",
        "TKG3d",
        "TKGeomBase",
        "TKGeomAlgo",
        "TKTopAlgo",
        "TKPrim",
        "TKMesh",
        "TKShHealing",
        // Fase 2: Booleanas (TKBO = BRepAlgoAPI 7.x), Fillet/Chamfer, Shell
        "TKBO",      // BRepAlgoAPI_Fuse / Cut / Common  ← módulo correto OCCT 7.x
        "TKBool",    // dependência interna do TKBO (BRepAlgo, BRepFeat)
        "TKFeat",    // BRepFeat — dependência do TKBool
        "TKFillet",  // BRepFilletAPI_MakeFillet / MakeChamfer
        "TKOffset",  // BRepOffsetAPI_MakeThickSolid
        // Fase 3.2: Export STL/STEP
        "TKDESTL",   // StlAPI_Writer
        "TKDESTEP",  // STEPControl_Writer
    ] {
        println!("cargo:rustc-link-lib={}", lib);
    }

    // ── Triggers de recompilação ──────────────────────────────────────────────
    println!("cargo:rerun-if-changed=build.rs"); // rebuild quando as libs mudam
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_bridge_c.h");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_bridge_c.cpp");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_wrapper.h");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_wrapper.cpp");
    println!("cargo:rerun-if-changed=src/lib.rs");

    // ── Tauri v2 build ────────────────────────────────────────────────────────
    tauri_build::build();
}
