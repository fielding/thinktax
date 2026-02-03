import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonl, writeJsonl } from "../src/core/events.js";

describe("jsonl utilities", () => {
  it("writes and reads JSONL", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thinktax-"));
    const filePath = path.join(dir, "events.jsonl");

    const payload = [{ id: 1 }, { id: 2 }];
    writeJsonl(filePath, payload);

    const read = await readJsonl<{ id: number }>(filePath);
    expect(read.map((row) => row.id)).toEqual([1, 2]);
  });
});
