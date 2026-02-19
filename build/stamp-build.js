// @ts-check

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {{ version?: string, [key: string]: unknown }} PackageJson
 */

const ROOT_PACKAGE_JSON_PATH = path.resolve("package.json");
const STAMPED_PACKAGE_JSON_PATH = path.resolve("build", "package.json");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TAG_VERSION_PATTERN = /^v(\d+\.\d+\.\d+)$/;

/**
 * @param {string} filePath
 * @returns {PackageJson}
 */
function parsePackageJson(filePath) {
  return /** @type {PackageJson} */ (JSON.parse(readFileSync(filePath, "utf8")));
}

/**
 * @param {string} packageJsonVersion
 * @param {string} argVersion
 * @returns {string}
 */
function resolveStampedVersion(packageJsonVersion, argVersion) {
  if (argVersion && !VERSION_PATTERN.test(argVersion)) {
    throw new Error(`Invalid version argument "${argVersion}". Expected X.Y.Z.`);
  }

  const tagName = String(process.env.GITHUB_REF_NAME ?? "").trim();
  const tagMatch = tagName.match(TAG_VERSION_PATTERN);
  const packageMatch = packageJsonVersion.match(VERSION_PATTERN);
  const runNumber = Number.parseInt(String(process.env.GITHUB_RUN_NUMBER ?? "0"), 10);
  const fallbackPatch = Number.isFinite(runNumber) && runNumber >= 0 ? runNumber : 0;

  return argVersion || tagMatch?.[1] || packageMatch?.[0] || `0.0.${fallbackPatch}`;
}

function main() {
  const sourcePackageJson = parsePackageJson(ROOT_PACKAGE_JSON_PATH);
  const packageJsonVersion = String(sourcePackageJson.version ?? "").trim();
  const argVersion = String(process.argv[2] ?? "").trim();
  const stampedVersion = resolveStampedVersion(packageJsonVersion, argVersion);

  /** @type {PackageJson} */
  const stampedPackageJson = {
    ...sourcePackageJson,
    version: stampedVersion
  };

  mkdirSync(path.dirname(STAMPED_PACKAGE_JSON_PATH), { recursive: true });
  writeFileSync(STAMPED_PACKAGE_JSON_PATH, `${JSON.stringify(stampedPackageJson, null, 2)}\n`);

  console.log(`Stamped build/package.json version: ${stampedVersion}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to stamp build/package.json: ${message}`);
  process.exit(1);
}
