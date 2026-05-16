/**
 * Copies the tokencut service into the extension's output folder so it gets
 * packaged by vsce. Runs as part of `vscode:prepublish`.
 *
 * Source:      ../service/
 * Destination: ./service/   (relative to this script's directory)
 *
 * We copy everything except node_modules/, data/, and *.db files, then run
 * `npm install --omit=dev` in the destination to install production deps.
 */

import { cpSync, rmSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC  = join(__dirname, "..", "..", "service");
const DEST = join(__dirname, "..", "service");

console.log(`Copying service:\n  ${SRC}\n→ ${DEST}`);

if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}
mkdirSync(DEST, { recursive: true });

cpSync(SRC, DEST, {
  recursive: true,
  filter: (src) => {
    const rel = src.replace(SRC, "");
    // Exclude: node_modules, data directory, sqlite DB files
    return !/[\\/](node_modules|data)[\\/]?/.test(rel) && !rel.endsWith(".db");
  },
});

console.log("Installing production dependencies in bundled service...");
execSync("npm install --omit=dev", { cwd: DEST, stdio: "inherit" });

console.log("Service bundled successfully.");
