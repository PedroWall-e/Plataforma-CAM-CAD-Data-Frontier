// check-env.cjs — Pré-verificação e cópia automática de DLLs (OCCT + dependências)
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const srcTauri = path.join(__dirname, 'src-tauri');
const occtPath = path.join(srcTauri, 'third_party', 'occt');

console.log('🔍 Verificando ambiente OpenCASCADE…\n');

let hasError = false;

// ── 1. Verificar pastas obrigatórias ─────────────────────────────────────────
const requiredDirs = ['inc', 'lib'];
if (os.platform() === 'win32') requiredDirs.push('bin');

requiredDirs.forEach(dir => {
  const fullPath = path.join(occtPath, dir);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ ERRO: Pasta '${dir}' não encontrada em: ${fullPath}`);
    hasError = true;
  } else {
    const files = fs.readdirSync(fullPath);
    if (files.length === 0) {
      console.error(`❌ ERRO: A pasta '${dir}' está vazia!`);
      hasError = true;
    } else {
      console.log(`✅ '${dir}' OK (${files.length} itens)`);
    }
  }
});

if (hasError) {
  console.error('\n🛑 Corrija os erros acima antes de continuar.');
  process.exit(1);
}

// ── 2. Windows: copiar DLLs para os diretórios de runtime do Cargo ────────────
if (os.platform() === 'win32') {
  const targets = [
    path.join(srcTauri, 'target', 'debug'),
    path.join(srcTauri, 'target', 'debug', 'deps'),
  ];
  targets.forEach(d => fs.mkdirSync(d, { recursive: true }));

  let totalCopied = 0;

  // ── 2a. DLLs do OCCT (TK*.dll) ──────────────────────────────────────────────
  const occtBin = path.join(occtPath, 'bin');
  const occtDlls = fs.readdirSync(occtBin).filter(f => f.toLowerCase().endsWith('.dll'));
  occtDlls.forEach(dll => {
    targets.forEach(dest => {
      try { fs.copyFileSync(path.join(occtBin, dll), path.join(dest, dll)); totalCopied++; }
      catch (e) { /* silencioso — ficheiro em uso é ok */ }
    });
  });
  console.log(`\n📦 OCCT: ${occtDlls.length} DLLs copiadas`);

  // ── 2b. Dependências transitivas do OCCT (tbb12, freetype, jemalloc…) ────────
  // TKernel.dll depende de: tbb12, tbbmalloc, jemalloc, freetype, freeimage
  // Estas DLLs NÃO estão em occt/bin — vêm do Conda ou vcpkg.
  const transitiveDlls = [
    'tbb12.dll',
    'tbb.dll',
    'tbbmalloc.dll',
    'tbbmalloc_proxy.dll',
    'jemalloc.dll',      // ← alocador de memória usado pelo TKernel
    'freetype.dll',      // ← renderização de fontes (TKService)
    'freeimage.dll',     // ← suporte a imagens (TKService)
  ];

  // Ordem de prioridade: Conda hardcoded primeiro (path conhecido), depois PATH
  const condaBase = 'C:\\Users\\Pedro\\miniconda3\\Library\\bin';
  const searchDirs = [
    condaBase,
    path.join(process.env.USERPROFILE || '', 'miniconda3', 'Library', 'bin'),
    path.join(process.env.USERPROFILE || '', 'anaconda3',  'Library', 'bin'),
    'C:\\ProgramData\\miniconda3\\Library\\bin',
    'C:\\conda\\Library\\bin',
    'C:\\vcpkg\\installed\\x64-windows\\bin',
    ...(process.env.PATH || '').split(';').filter(Boolean),
  ];

  let transitiveFound = 0;
  transitiveDlls.forEach(dll => {
    for (const dir of searchDirs) {
      const src = path.join(dir, dll);
      if (fs.existsSync(src)) {
        targets.forEach(dest => {
          try { fs.copyFileSync(src, path.join(dest, dll)); totalCopied++; }
          catch (e) { /* silencioso */ }
        });
        transitiveFound++;
        break; // encontrou — passa para o próximo dll
      }
    }
  });
  console.log(`📦 Transitivas: ${transitiveFound}/${transitiveDlls.length} DLLs encontradas e copiadas`);
  console.log(`📦 Total: ${totalCopied} operações de cópia`);
}

console.log('\n🚀 Ambiente OK — iniciando Tauri…\n');
