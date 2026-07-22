import type { DiscoveredLocalServer } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { mergeServers } from "./useDiscoveredLocalServers";

const scannerServer: DiscoveredLocalServer = {
  host: "127.0.0.1",
  port: 5173,
  url: "http://127.0.0.1:5173/",
  processName: "vite",
  pid: 42,
};

describe("mergeServers", () => {
  it("keeps only loopback configured and recent URLs", () => {
    const result = mergeServers({
      scanner: [],
      configuredUrls: ["http://localhost:7741", "https://example.com"],
      recentlySeenUrls: ["http://127.0.0.1:3000", "file:///tmp/index.html"],
    });

    expect(result.map((server) => server.url)).toEqual([
      "http://localhost:7741/",
      "http://127.0.0.1:3000/",
    ]);
  });

  it("enriches configured ports with live scanner metadata without duplicates", () => {
    const result = mergeServers({
      scanner: [scannerServer],
      configuredUrls: ["http://127.0.0.1:5173"],
      recentlySeenUrls: ["http://127.0.0.1:5173/"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "configured",
      listening: true,
      processName: "vite",
      pid: 42,
    });
  });

  it("sorts configured, live, then recent servers", () => {
    const result = mergeServers({
      scanner: [scannerServer],
      configuredUrls: ["http://localhost:7741"],
      recentlySeenUrls: ["http://localhost:9999"],
    });

    expect(result.map((server) => server.source)).toEqual(["configured", "scanner", "recent"]);
  });
});
