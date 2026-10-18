import type { ClinicalImageRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeImageRequestButton, imageRequestNews } from "./imageRequests";

const request = (
  id: string,
  state: ClinicalImageRequest["state"],
  extra: Partial<ClinicalImageRequest> = {},
): ClinicalImageRequest => ({
  id,
  threadId: "thread-1",
  dataset: "mimic-cxr-jpg",
  datasetTitle: "MIMIC-CXR-JPG",
  images: 200,
  state,
  completed: 0,
  message: "",
  requestedAt: 0,
  ...extra,
});

describe("describeImageRequestButton", () => {
  it("puts a request waiting for the researcher before one that is fetching", () => {
    const button = describeImageRequestButton([
      request("a", "fetching", { completed: 30, total: 200 }),
      request("b", "waiting-for-login", { images: 12 }),
    ]);
    expect(button).toMatchObject({ waiting: true, request: { id: "b" } });
    expect(button?.label).toBe("Sign in with PhysioNet to fetch 12 images from MIMIC-CXR-JPG");
  });

  it("shows a fetch's progress, and nothing once every request has finished", () => {
    expect(
      describeImageRequestButton([request("a", "fetching", { completed: 30, total: 180 })])?.label,
    ).toBe("Fetching images from MIMIC-CXR-JPG: 30 of 180");
    expect(describeImageRequestButton([request("a", "done"), request("b", "declined")])).toBeNull();
  });
});

describe("imageRequestNews", () => {
  it("asks once for a request that starts waiting, and announces one that finishes", () => {
    const first = imageRequestNews([], [request("a", "waiting-for-login")]);
    expect(first.newlyWaiting.map((r) => r.id)).toEqual(["a"]);

    const again = imageRequestNews(
      [request("a", "waiting-for-login")],
      [request("a", "waiting-for-login")],
    );
    expect(again.newlyWaiting).toEqual([]);

    const ended = imageRequestNews([request("a", "fetching")], [request("a", "failed")]);
    expect(ended.finished.map((r) => r.id)).toEqual(["a"]);
    // A failed request signed in to again waits no more: it is fetching.
    expect(
      imageRequestNews([request("a", "failed")], [request("a", "fetching")]).newlyWaiting,
    ).toEqual([]);
  });

  it("does not announce what finished before this window saw it open", () => {
    expect(imageRequestNews([], [request("a", "done")]).finished).toEqual([]);
  });
});
