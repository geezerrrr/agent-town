/**
 * Prepare the standalone build for npm publishing.
 *
 * After `next build` with output: 'standalone':
 * 1. Flatten pnpm node_modules (resolve .pnpm symlinks into flat structure)
 * 2. Copy public/        → .next/standalone/public/
 * 3. Copy .next/static/  → .next/standalone/.next/static/
 * 4. Copy server.prod.mjs → .next/standalone/server.prod.mjs
 * 5. Copy lib/*.mjs runtime modules → .next/standalone/lib/
 */

import { existsSync, readdirSync, statSync, mkdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const standalone = resolve(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("ERROR: .next/standalone/ not found. Run `next build` first.");
  process.exit(1);
}

console.log("Preparing standalone package...\n");

// --- 1. Flatten pnpm node_modules ---
const nm = resolve(standalone, "node_modules");
const pnpmDir = resolve(nm, ".pnpm");
const flatNm = resolve(standalone, "node_modules_flat");

if (existsSync(pnpmDir)) {
  if (existsSync(flatNm)) rmSync(flatNm, { recursive: true });
  mkdirSync(flatNm, { recursive: true });

  for (const spec of readdirSync(pnpmDir)) {
    if (spec.startsWith(".")) continue;
    const innerNm = resolve(pnpmDir, spec, "node_modules");
    if (!existsSync(innerNm) || !statSync(innerNm).isDirectory()) continue;

    for (const pkg of readdirSync(innerNm)) {
      if (pkg.startsWith(".")) continue;
      const src = resolve(innerNm, pkg);

      if (pkg.startsWith("@")) {
        for (const scopedPkg of readdirSync(src)) {
          const scopedSrc = resolve(src, scopedPkg);
          const scopedDest = resolve(flatNm, pkg, scopedPkg);
          if (!existsSync(scopedDest)) {
            mkdirSync(resolve(flatNm, pkg), { recursive: true });
            execSync(`cp -rL "${scopedSrc}" "${scopedDest}"`);
          }
        }
      } else {
        const dest = resolve(flatNm, pkg);
        if (!existsSync(dest)) {
          execSync(`cp -rL "${src}" "${dest}"`);
        }
      }
    }
  }

  rmSync(nm, { recursive: true });
  renameSync(flatNm, nm);
  console.log("  done  Flattened pnpm node_modules/");
} else {
  console.log("  skip  node_modules/ already flat");
}

// --- 2. Copy public/ ---
cpSync(resolve(root, "public"), resolve(standalone, "public"), {
  recursive: true,
});
console.log("  done  public/ → standalone/public/");

// --- 3. Copy .next/static/ ---
cpSync(resolve(root, ".next", "static"), resolve(standalone, ".next", "static"), {
  recursive: true,
});
console.log("  done  .next/static/ → standalone/.next/static/");

// --- 4. Copy server.prod.mjs ---
cpSync(resolve(root, "server.prod.mjs"), resolve(standalone, "server.prod.mjs"));
console.log("  done  server.prod.mjs → standalone/server.prod.mjs");

// --- 5. Copy runtime modules imported by server.prod.mjs ---
for (const file of ["ws-proxy.mjs", "auggie-bridge.mjs", "mcp/agent-town-mcp.mjs"]) {
  cpSync(resolve(root, "lib", file), resolve(standalone, "lib", file));
}
console.log("  done  lib/*.mjs → standalone/lib/");

console.log("\n  Standalone package ready.\n");
