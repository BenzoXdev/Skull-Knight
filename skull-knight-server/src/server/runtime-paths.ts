import path from "path";
import fs from "fs";

export function resolveRuntimeRoot(cwd: string = process.cwd()): string {
  const explicitRoot = process.env.SKULL_KNIGHT_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  if (fs.existsSync(path.join(cwd, "skull-knight-client"))) {
    return cwd;
  }

  return path.resolve(cwd, "..");
}
