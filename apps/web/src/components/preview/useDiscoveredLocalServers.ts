import type { DiscoveredLocalServer, EnvironmentId } from "@t3tools/contracts";
import { isLoopbackHost } from "@t3tools/shared/preview";
import { useEffect, useMemo, useState } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";

export interface PreviewableServer extends DiscoveredLocalServer {
  source: "scanner" | "configured" | "recent";
  listening: boolean;
}

export function useDiscoveredLocalServers(input: {
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentlySeenUrls?: ReadonlyArray<string> | undefined;
}): ReadonlyArray<PreviewableServer> {
  const [scannerSnapshot, setScannerSnapshot] = useState<ReadonlyArray<DiscoveredLocalServer>>([]);

  useEffect(() => {
    const api = ensureEnvironmentApi(input.environmentId);
    setScannerSnapshot([]);
    return api.preview.subscribePorts((next) => setScannerSnapshot(next.servers), {
      onResubscribe: () => setScannerSnapshot([]),
    });
  }, [input.environmentId]);

  return useMemo(
    () =>
      mergeServers({
        scanner: scannerSnapshot,
        configuredUrls: input.configuredUrls ?? [],
        recentlySeenUrls: input.recentlySeenUrls ?? [],
      }),
    [scannerSnapshot, input.configuredUrls, input.recentlySeenUrls],
  );
}

export function mergeServers(input: {
  scanner: ReadonlyArray<DiscoveredLocalServer>;
  configuredUrls: ReadonlyArray<string>;
  recentlySeenUrls: ReadonlyArray<string>;
}): ReadonlyArray<PreviewableServer> {
  const seen = new Map<string, PreviewableServer>();
  for (const url of input.configuredUrls) {
    const parsed = parseLocalUrl(url);
    if (!parsed) continue;
    const key = canonicalKey(parsed.host, parsed.port);
    if (!seen.has(key)) {
      seen.set(key, {
        ...parsed,
        processName: null,
        pid: null,
        source: "configured",
        listening: false,
      });
    }
  }
  for (const server of input.scanner) {
    const key = canonicalKey(server.host, server.port);
    const existing = seen.get(key);
    seen.set(
      key,
      existing
        ? {
            ...existing,
            processName: server.processName ?? existing.processName,
            pid: server.pid ?? existing.pid,
            url: server.url,
            listening: true,
          }
        : { ...server, source: "scanner", listening: true },
    );
  }
  for (const url of input.recentlySeenUrls) {
    const parsed = parseLocalUrl(url);
    if (!parsed) continue;
    const key = canonicalKey(parsed.host, parsed.port);
    if (!seen.has(key)) {
      seen.set(key, {
        ...parsed,
        processName: null,
        pid: null,
        source: "recent",
        listening: false,
      });
    }
  }

  const sourceOrder: Record<PreviewableServer["source"], number> = {
    configured: 0,
    scanner: 1,
    recent: 2,
  };
  return Array.from(seen.values()).toSorted(
    (left, right) => sourceOrder[left.source] - sourceOrder[right.source] || left.port - right.port,
  );
}

function canonicalKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

function parseLocalUrl(raw: string): { host: string; port: number; url: string } | null {
  try {
    const parsed = new URL(raw);
    if (!isLoopbackHost(parsed.hostname)) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const port = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : parsed.protocol === "http:"
        ? 80
        : 443;
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
    return { host: parsed.hostname, port, url: parsed.href };
  } catch {
    return null;
  }
}
