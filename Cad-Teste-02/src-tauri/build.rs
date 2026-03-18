use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_root = PathBuf::from(&manifest_dir);

    // ── Paths ─────────────────────────────────────────────────────────────────
    let occt_inc         = project_root.join("third_party").join("occt").join("inc");
    let occt_lib         = project_root.join("third_party").join("occt").join("lib");
    let wrapper_dir      = project_root.join("third_party").join("occt_wrapper");
    let clipper2_dir     = project_root.join("third_party").join("clipper2");
    let cavc_dir         = project_root.join("third_party").join("cavalier_contours");
    let sketch_dir       = project_root.join("third_party").join("sketch_bridge");

    // ── Compilação C++: OCCT bridge ───────────────────────────────────────────
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

    // ── Compilação C++: Sketch bridge (sempre compila stub; real quando Clipper2 disponível) ─
    // O stub garante que os símbolos existem no linker mesmo sem Clipper2.
    // Quando Clipper2 é encontrado, o real é compilado na mesma lib sobreescrevendo o stub.
    let clipper_subdir = clipper2_dir.join("clipper2");
    let clipper_cpp    = clipper_subdir.join("clipper.cpp");
    // Voltar o comportamento original: usar o Clipper2 real se o .cpp existir
    // O erro do compilador MSVC era falta de flags /EHsc (exceções) e /std:c++17 para C++ moderno.
    let has_clipper = clipper_subdir.join("clipper.engine.cpp").exists();

    let mut sketch_build = cc::Build::new();
    sketch_build
        .cpp(true)
        .flag_if_supported("/std:c++17") // sintaxe MSVC
        .flag_if_supported("/EHsc")      // ativar exceções C++ no MSVC
        .flag_if_supported("-std=c++17") // fallback p/ GCC/Clang
        .flag_if_supported("-D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH")
        .include(&sketch_dir);

    if has_clipper {
        println!("cargo:rustc-cfg=clipper2");
        sketch_build
            .include(&clipper2_dir)   // permite "clipper2/clipper.h"
            .include(&cavc_dir)
            .file(clipper_subdir.join("clipper.engine.cpp"))
            .file(clipper_subdir.join("clipper.offset.cpp"))
            .file(clipper_subdir.join("clipper.rectclip.cpp"))
            .file(clipper_subdir.join("clipper.triangulation.cpp"))
            .file(sketch_dir.join("sketch_bridge_c.cpp"));
    } else {
        println!("cargo:warning=Clipper2 não encontrado — usando stub do sketch bridge.");
        sketch_build.file(sketch_dir.join("sketch_bridge_stub.cpp"));
    }
    sketch_build.compile("sketch_bridge");

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
        // Nota: Clipper2 e CavalierContours são compilados como static libs acima
        // (occt_bridge e sketch_bridge) — sem flags de linkagem adicionais
    ] {
        println!("cargo:rustc-link-lib={}", lib);
    }

    // ── Triggers de recompilação ──────────────────────────────────────────────
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_bridge_c.h");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_bridge_c.cpp");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_wrapper.h");
    println!("cargo:rerun-if-changed=third_party/occt_wrapper/occt_wrapper.cpp");
    println!("cargo:rerun-if-changed=third_party/sketch_bridge/sketch_bridge_c.h");
    println!("cargo:rerun-if-changed=third_party/sketch_bridge/sketch_bridge_c.cpp");
    println!("cargo:rerun-if-changed=third_party/clipper2/clipper.cpp");
    println!("cargo:rerun-if-changed=src/lib.rs");

    // ── Tauri v2 build ────────────────────────────────────────────────────────
    tauri_build::build();
}


