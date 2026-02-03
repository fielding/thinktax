import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createEventId,
  readJsonl,
  writeJsonl,
  appendJsonl,
  emptyCost,
  emptyTokens,
  emptyProject,
} from "../src/core/events.js";

describe("createEventId", () => {
  it("creates consistent IDs for same input", () => {
    const parts = { source: "claude_code", ts: "2026-02-02T10:00:00Z", model: "claude" };

    const id1 = createEventId(parts);
    const id2 = createEventId(parts);

    expect(id1).toBe(id2);
  });

  it("creates different IDs for different input", () => {
    const id1 = createEventId({ source: "claude_code", ts: "2026-02-02T10:00:00Z" });
    const id2 = createEventId({ source: "claude_code", ts: "2026-02-02T10:00:01Z" });

    expect(id1).not.toBe(id2);
  });

  it("returns valid hex string", () => {
    const id = createEventId({ test: "value" });

    expect(id).toMatch(/^[a-f0-9]{40}$/);
  });

  it("handles complex nested objects", () => {
    const parts = {
      source: "claude_code",
      tokens: { in: 100, out: 50 },
      meta: { nested: { deep: true } },
    };

    const id = createEventId(parts);

    expect(id).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe("JSONL utilities", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "thinktax-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readJsonl", () => {
    it("reads valid JSONL file", async () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      fs.writeFileSync(filePath, '{"id":1}\n{"id":2}\n{"id":3}\n');

      const result = await readJsonl<{ id: number }>(filePath);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it("skips empty lines", async () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      fs.writeFileSync(filePath, '{"id":1}\n\n{"id":2}\n   \n{"id":3}\n');

      const result = await readJsonl<{ id: number }>(filePath);

      expect(result).toHaveLength(3);
    });

    it("skips malformed lines", async () => {
      const filePath = path.join(tmpDir, "test.jsonl");
      fs.writeFileSync(filePath, '{"id":1}\nnot json\n{"id":2}\n{broken\n{"id":3}\n');

      const result = await readJsonl<{ id: number }>(filePath);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it("returns empty array for non-existent file", async () => {
      const filePath = path.join(tmpDir, "nonexistent.jsonl");

      const result = await readJsonl<{ id: number }>(filePath);

      expect(result).toEqual([]);
    });

    it("returns empty array for empty file", async () => {
      const filePath = path.join(tmpDir, "empty.jsonl");
      fs.writeFileSync(filePath, "");

      const result = await readJsonl<{ id: number }>(filePath);

      expect(result).toEqual([]);
    });
  });

  describe("writeJsonl", () => {
    it("writes JSONL file", () => {
      const filePath = path.join(tmpDir, "output.jsonl");
      const data = [{ id: 1 }, { id: 2 }];

      writeJsonl(filePath, data);

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toBe('{"id":1}\n{"id":2}\n');
    });

    it("creates parent directories", () => {
      const filePath = path.join(tmpDir, "nested", "deep", "output.jsonl");
      const data = [{ id: 1 }];

      writeJsonl(filePath, data);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("handles empty array", () => {
      const filePath = path.join(tmpDir, "empty.jsonl");

      writeJsonl(filePath, []);

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toBe("");
    });
  });

  describe("appendJsonl", () => {
    it("appends to existing file", () => {
      const filePath = path.join(tmpDir, "append.jsonl");
      fs.writeFileSync(filePath, '{"id":1}\n');

      appendJsonl(filePath, { id: 2 });

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toBe('{"id":1}\n{"id":2}\n');
    });

    it("creates file if not exists", () => {
      const filePath = path.join(tmpDir, "new.jsonl");

      appendJsonl(filePath, { id: 1 });

      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toBe('{"id":1}\n');
    });
  });
});

describe("helper functions", () => {
  it("emptyCost returns proper defaults", () => {
    const cost = emptyCost();

    expect(cost.reported_usd).toBeNull();
    expect(cost.estimated_usd).toBeNull();
    expect(cost.final_usd).toBeNull();
    expect(cost.mode).toBe("unknown");
  });

  it("emptyTokens returns zero values", () => {
    const tokens = emptyTokens();

    expect(tokens.in).toBe(0);
    expect(tokens.out).toBe(0);
    expect(tokens.cache_write).toBe(0);
    expect(tokens.cache_read).toBe(0);
  });

  it("emptyProject returns null values", () => {
    const project = emptyProject();

    expect(project.id).toBeNull();
    expect(project.name).toBeNull();
    expect(project.root).toBeNull();
  });
});
