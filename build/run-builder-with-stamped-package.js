// @ts-check

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
 * @typedef {{
 *   command: string;
  *   args: string[];
  *   displayCommand: string;
 * }} YarnCommand
 */

/**
 * @param {string[]} args
 * @returns {YarnCommand}
 */
function resolveYarnCommand(args) {
  const userAgent = String(process.env.npm_config_user_agent ?? "").trim().toLowerCase();
  const npmExecPath = String(process.env.npm_execpath ?? "").trim();
  const isYarnRuntime = userAgent.startsWith("yarn/");
  const npmExecExtension = path.extname(npmExecPath).toLowerCase();

  const canExecuteWithNode =
    npmExecExtension === ".js" || npmExecExtension === ".cjs" || npmExecExtension === ".mjs";

  // Running the active Yarn CLI via node avoids Windows `.cmd` spawn edge cases.
  if (isYarnRuntime && npmExecPath && existsSync(npmExecPath) && canExecuteWithNode) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
      displayCommand: `node ${path.basename(npmExecPath)} ${args.join(" ")}`
    };
  }

  // On Windows in Corepack contexts, npm_execpath can be a shell shim (not JS).
  // Resolve the real corepack yarn.js from the shim to execute it via Node.
  if (isYarnRuntime && process.platform === "win32" && npmExecPath && existsSync(npmExecPath)) {
    try {
      const shimContent = readFileSync(npmExecPath, "utf8");
      const corepackEntryMatch = shimContent.match(/['"]([^'"]*corepack[\\/]+dist[\\/]+yarn\.js)['"]/i);
      const corepackYarnPath = String(corepackEntryMatch?.[1] ?? "").trim();

      if (corepackYarnPath && existsSync(corepackYarnPath)) {
        return {
          command: process.execPath,
          args: [corepackYarnPath, ...args],
          displayCommand: `node ${path.basename(corepackYarnPath)} ${args.join(" ")}`
        };
      }
    } catch {
      // Ignore shim parse errors and fall back to normal resolution.
    }
  }

  const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";
  return {
    command: yarnExecutable,
    args,
    displayCommand: `${yarnExecutable} ${args.join(" ")}`
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @returns {Promise<void>}
 */
function runYarn(args, extraEnv) {
  const yarnCommand = resolveYarnCommand(args);

  return new Promise((resolve, reject) => {
    const child = spawn(yarnCommand.command, yarnCommand.args, {
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
        new Error(`Command failed (exit ${code ?? "unknown"}): ${yarnCommand.displayCommand}`)
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
