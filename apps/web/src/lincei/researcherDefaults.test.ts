import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { RESEARCHER_DEFAULTS, seedOnce } from "./researcherDefaults";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("Lincei's starting settings", () => {
  it("are written once per device, so running setup again keeps what the user chose", () => {
    const storage = memoryStorage();
    let applied = 0;
    seedOnce(storage, () => (applied += 1));
    seedOnce(storage, () => (applied += 1));
    expect(applied).toBe(1);
  });

  it("are still written when the device's storage cannot be used", () => {
    const broken = {
      getItem: () => {
        throw new Error("storage is blocked");
      },
      setItem: () => {
        throw new Error("storage is blocked");
      },
    };
    let applied = 0;
    seedOnce(broken, () => (applied += 1));
    expect(applied).toBe(1);
  });

  it("each differ from upstream's default; one that no longer does can be removed", () => {
    for (const [key, value] of Object.entries(RESEARCHER_DEFAULTS)) {
      expect(DEFAULT_UNIFIED_SETTINGS[key as keyof typeof RESEARCHER_DEFAULTS], key).not.toBe(
        value,
      );
    }
  });
});
