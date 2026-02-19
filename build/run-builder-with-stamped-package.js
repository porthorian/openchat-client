// @ts-check

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {"pack" | "dist"} BuildMode
 */

const ROOT_PACKAGE_JSON_PATH = path.resolve("package.json");
const STAMPED_PACKAGE_JSON_PATH = path.resolve("build", "package.json");

/**
 * @param {string} rawMode
 * @returns {BuildMode}
 */
function resolveMode(rawMode) {
  if (rawMode === "pack" || rawMode === "dist") {
    return rawMode;
  }

  throw new Error(`Invalid build mode "${rawMode}". Expected "pack" or "dist".`);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @returns {Promise<void>}
 */
function runYarn(args, extraEnv) {
  const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";

  return new Promise((resolve, reject) => {
    const child = spawn(yarnExecutable, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`Command failed (exit ${code ?? "unknown"}): ${yarnExecutable} ${args.join(" ")}`)
      );
    });
  });
}

async function main() {
  const mode = resolveMode(String(process.argv[2] ?? "dist").trim().toLowerCase());
  const originalPackageJson = readFileSync(ROOT_PACKAGE_JSON_PATH, "utf8");

  let stampedPackageJson;
  try {
    stampedPackageJson = readFileSync(STAMPED_PACKAGE_JSON_PATH, "utf8");
  } catch {
    throw new Error('Missing build/package.json. Run "yarn run stamp_build X.Y.Z" first.');
  }

  let stampedVersion = "unknown";
  try {
    const parsed = /** @type {{ version?: unknown }} */ (JSON.parse(stampedPackageJson));
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      stampedVersion = parsed.version.trim();
    }
  } catch {
    throw new Error("build/package.json is not valid JSON.");
  }

  console.log(`Using stamped package version: ${stampedVersion}`);

  writeFileSync(ROOT_PACKAGE_JSON_PATH, stampedPackageJson);

  try {
    await runYarn(["build"]);

    const builderArgs =
      mode === "pack"
        ? ["dlx", "electron-builder@24.13.3", "--dir", "--publish", "never"]
        : ["dlx", "electron-builder@24.13.3", "--publish", "never"];

    const builderDebugValue =
      "electron-builder,electron-osx-sign*,electron-notarize*,@electron/osx-sign*,@electron/notarize*";
    const builderEnv = mode === "pack" ? { DEBUG: builderDebugValue } : undefined;

    if (mode === "pack") {
      console.log(`electron-builder debug enabled: DEBUG=${builderDebugValue}`);
    }

    await runYarn(builderArgs, builderEnv);
  } finally {
    writeFileSync(ROOT_PACKAGE_JSON_PATH, originalPackageJson);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to build with stamped package.json: ${message}`);
  process.exit(1);
});
