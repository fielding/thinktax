import fs from "node:fs";
import path from "node:path";
import { getPaths } from "./paths.js";

export interface SyncState {
  lastRun?: Record<string, string>;
  counts?: Record<string, number>;
}

export interface EtagState {
  [url: string]: {
    etag?: string;
    lastChecked?: string;
  };
}

export function readSyncState(): SyncState {
  const { stateDir } = getPaths();
  const filePath = path.join(stateDir, "sync.json");
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as SyncState;
  } catch {
    return {};
  }
}

export function writeSyncState(state: SyncState): void {
  const { stateDir } = getPaths();
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, "sync.json");
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function readEtagState(): EtagState {
  const { stateDir } = getPaths();
  const filePath = path.join(stateDir, "etag.json");
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as EtagState;
  } catch {
    return {};
  }
}

export function writeEtagState(state: EtagState): void {
  const { stateDir } = getPaths();
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, "etag.json");
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}
