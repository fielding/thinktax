import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ThinktaxPaths {
  configDir: string;
  configFile: string;
  dataDir: string;
  eventsDir: string;
  snapshotsDir: string;
  stateDir: string;
  pricingFile: string;
}

export function getPaths(): ThinktaxPaths {
  const home = os.homedir();
  const isMac = process.platform === "darwin";

  const configBase = isMac
    ? path.join(home, "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");

  const dataBase = isMac
    ? path.join(home, "Library", "Application Support")
    : process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");

  const configDir = path.join(configBase, "thinktax");
  const dataDir = isMac
    ? path.join(dataBase, "thinktax", "data")
    : path.join(dataBase, "thinktax");

  const eventsDir = path.join(dataDir, "events");
  const snapshotsDir = path.join(dataDir, "snapshots");
  const stateDir = path.join(dataDir, "state");

  const bundledPricing = fileURLToPath(
    new URL("../pricing/models.json", import.meta.url)
  );
  const cwdPricing = path.join(process.cwd(), "pricing", "models.json");
  const pricingFile = fs.existsSync(bundledPricing)
    ? bundledPricing
    : cwdPricing;

  return {
    configDir,
    configFile: path.join(configDir, "config.toml"),
    dataDir,
    eventsDir,
    snapshotsDir,
    stateDir,
    pricingFile,
  };
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensurePaths(paths: ThinktaxPaths): void {
  ensureDir(paths.configDir);
  ensureDir(paths.dataDir);
  ensureDir(paths.eventsDir);
  ensureDir(paths.snapshotsDir);
  ensureDir(paths.stateDir);
}
