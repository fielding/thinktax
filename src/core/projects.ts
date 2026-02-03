import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { ProjectMapping, ThinktaxConfig } from "./config.js";
import { UsageProject } from "./events.js";

export function hashProjectId(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function resolveProjectFromMapping(
  config: ThinktaxConfig,
  instanceId: string | null,
  root: string | null
): UsageProject {
  const mappings = config.projects?.mappings ?? [];

  for (const mapping of mappings) {
    if (mapping.match?.instanceId && instanceId) {
      if (mapping.match.instanceId === instanceId) {
        return {
          id: mapping.id ?? instanceId,
          name: mapping.name ?? mapping.id ?? instanceId,
          root: mapping.root ?? root,
        };
      }
    }

    if (mapping.match?.pathPrefix && root) {
      if (root.startsWith(mapping.match.pathPrefix)) {
        return {
          id: mapping.id ?? hashProjectId(root),
          name: mapping.name ?? mapping.id ?? path.basename(root),
          root: mapping.root ?? root,
        };
      }
    }
  }

  if (root) {
    return {
      id: hashProjectId(root),
      name: path.basename(root),
      root,
    };
  }

  if (instanceId) {
    return {
      id: instanceId,
      name: instanceId,
      root: null,
    };
  }

  return { id: null, name: null, root: null };
}

export function findGitRoot(start: string): string | null {
  let current = start;
  while (current && current !== path.dirname(current)) {
    const candidate = path.join(current, ".git");
    if (fs.existsSync(candidate)) return current;
    current = path.dirname(current);
  }
  return null;
}
