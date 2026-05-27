// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAttachmentId,
  parseSessionSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";

describe("attachmentStore", () => {
  it("sanitizes session ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("session.folder/unsafe space");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }

    const sessionSegment = parseSessionSegmentFromAttachmentId(attachmentId);
    expect(sessionSegment).toBeTruthy();
    expect(sessionSegment).toMatch(/^[a-z0-9_-]+$/i);
    expect(sessionSegment).not.toContain(".");
    expect(sessionSegment).not.toContain("%");
    expect(sessionSegment).not.toContain("/");
  });

  it("parses exact session segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseSessionSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseSessionSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("normalizes created session segments to lowercase", () => {
    const attachmentId = createAttachmentId("Session.Foo");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }
    expect(parseSessionSegmentFromAttachmentId(attachmentId)).toBe("session-foo");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-attachment-store-"));
    try {
      const attachmentId = "session-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId,
      });
      expect(resolved).toBe(pngPath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("returns null when no attachment file exists for the id", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-attachment-store-"));
    try {
      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId: "session-1-missing",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
