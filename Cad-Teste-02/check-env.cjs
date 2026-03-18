// check-env.cjs — Pré-verificação e cópia automática das DLLs do OCCT
// Todas as dependências estão autocontidas em src-tauri/third_party/occt/
'use strict';

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

// ── 2. Windows: copiar DLLs do OCCT para o diretório de runtime do Cargo ─────
if (os.platform() === 'win32') {
  const occtBin = path.join(occtPath, 'bin');
  const targets = [
    path.join(srcTauri, 'target', 'debug'),
    path.join(srcTauri, 'target', 'debug', 'deps'),
  ];

  // Garante que as pastas de destino existam
  targets.forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Copia apenas as DLLs do OCCT (TK*.dll) — todas as dependências já estão
  // autocontidas nesta distribuição (sem TBB, freetype ou outros externos).
  const occtDlls = fs.readdirSync(occtBin).filter(f => f.toLowerCase().endsWith('.dll'));
  let totalCopied = 0;

  occtDlls.forEach(dll => {
    const src = path.join(occtBin, dll);
    targets.forEach(dest => {
      try {
        fs.copyFileSync(src, path.join(dest, dll));
        totalCopied++;
      } catch (_e) {
        // Silencioso — ficheiro em uso é aceitável (já copiado antes)
      }
    });
  });

  console.log(`\n📦 OCCT: ${occtDlls.length} DLLs copiadas para target/debug (${totalCopied} ops)`);
}

console.log('\n🚀 Ambiente OK — iniciando Tauri…\n');
