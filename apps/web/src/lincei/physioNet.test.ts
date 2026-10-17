import { describe, expect, it } from "vite-plus/test";

import { physioNetProjectPage, splitPhysioNetAddresses } from "./physioNet";

describe("splitPhysioNetAddresses", () => {
  it("takes the addresses out of a sentence without the punctuation after them", () => {
    expect(
      splitPhysioNetAddresses(
        "Sign the data use agreement on https://physionet.org/content/mimiciv/3.1/, then choose Download again.",
      ),
    ).toEqual([
      "Sign the data use agreement on ",
      "https://physionet.org/content/mimiciv/3.1/",
      ", then choose Download again.",
    ]);
    expect(splitPhysioNetAddresses("See https://physionet.org/content/eicu-crd/.")).toEqual([
      "See ",
      "https://physionet.org/content/eicu-crd/",
      ".",
    ]);
  });

  it("leaves addresses elsewhere as text", () => {
    const text = "Not https://example.test/physionet.org/ or https://physionet.org.example.test/x/";
    expect(splitPhysioNetAddresses(text)).toEqual([text]);
  });
});

describe("physioNetProjectPage", () => {
  it("prefers the page the server names, and knows the long-standing ones without it", () => {
    expect(
      physioNetProjectPage({
        name: "mimic-iv-ed",
        agreementUrl: "https://physionet.org/content/mimic-iv-ed/",
      }),
    ).toBe("https://physionet.org/content/mimic-iv-ed/");
    expect(physioNetProjectPage({ name: "mimic-iv" })).toBe(
      "https://physionet.org/content/mimiciv/",
    );
    expect(physioNetProjectPage({ name: "mimic-iii" })).toBeNull();
  });
});
