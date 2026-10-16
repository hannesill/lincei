import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  cloudServiceOf,
  excludeFile,
  iCloudDesktopAndDocuments,
  leftOutIn,
  whyNoHistory,
} from "./studyFolders.ts";

interface Case {
  readonly folder: string;
  readonly service: string | null;
  readonly environment?: NodeJS.ProcessEnv;
}

const check = (platform: NodeJS.Platform, home: string, cases: ReadonlyArray<Case>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    for (const { folder, service, environment = {} } of cases) {
      expect(cloudServiceOf({ folder, home, platform, environment, path }), folder).toBe(service);
    }
  });

describe("cloudServiceOf", () => {
  it.effect("knows where sync services keep their folders on a Mac", () =>
    check("darwin", "/Users/ada", [
      {
        folder: "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/sepsis",
        service: "iCloud Drive",
      },
      { folder: "/Users/ada/Library/CloudStorage/Dropbox/sepsis", service: "Dropbox" },
      { folder: "/Users/ada/Library/CloudStorage/OneDrive-TUM/sepsis", service: "OneDrive" },
      {
        folder: "/Users/ada/Library/CloudStorage/GoogleDrive-ada@tum.de/My Drive",
        service: "Google Drive",
      },
      { folder: "/Users/ada/Library/CloudStorage/Box-Box/sepsis", service: "Box" },
      { folder: "/Users/ada/Library/CloudStorage/pCloud-ada/sepsis", service: "a cloud service" },
      { folder: "/Users/ada/Dropbox", service: "Dropbox" },
      { folder: "/Users/ada/dropbox/sepsis", service: "Dropbox" },
      { folder: "/Users/ada/OneDrive - TUM/sepsis", service: "OneDrive" },
      { folder: "/Users/ada/Google Drive/sepsis", service: "Google Drive" },
      { folder: "/Users/ada/Box/sepsis", service: "Box" },
      { folder: "/Users/ada/Library/CloudStorage", service: null },
      { folder: "/Users/ada/Studies/sepsis", service: null },
      { folder: "/Users/ada/Dropboxes/sepsis", service: null },
      { folder: "/Volumes/Data/Dropbox/sepsis", service: null },
    ]).pipe(Effect.provide(NodePath.layerPosix)),
  );

  it.effect("knows OneDrive by its variables on Windows", () =>
    check("win32", "C:\\Users\\ada", [
      {
        folder: "D:\\OneDrive - TUM\\sepsis",
        environment: { OneDriveCommercial: "D:\\OneDrive - TUM" },
        service: "OneDrive",
      },
      {
        folder: "C:\\Users\\ada\\OneDrive\\sepsis",
        environment: { OneDrive: "C:\\Users\\ada\\OneDrive", OneDriveConsumer: "" },
        service: "OneDrive",
      },
      { folder: "c:\\users\\ada\\iclouddrive\\sepsis", service: "iCloud Drive" },
      { folder: "C:\\Users\\ada\\Dropbox\\sepsis", service: "Dropbox" },
      { folder: "C:\\Users\\ada\\Google Drive\\sepsis", service: "Google Drive" },
      // Without its variables, a folder called OneDrive is just a folder.
      { folder: "C:\\Users\\ada\\OneDrive\\sepsis", service: null },
      { folder: "C:\\Users\\ada\\Studies\\sepsis", service: null },
    ]).pipe(Effect.provide(NodePath.layerWin32)),
  );

  it.effect("knows the sync clients' folders on Linux, by their exact names", () =>
    check("linux", "/home/ada", [
      { folder: "/home/ada/Dropbox/sepsis", service: "Dropbox" },
      { folder: "/home/ada/OneDrive/sepsis", service: "OneDrive" },
      { folder: "/home/ada/Nextcloud/sepsis", service: "Nextcloud" },
      { folder: "/home/ada/pCloudDrive/sepsis", service: "pCloud" },
      { folder: "/home/ada/dropbox/sepsis", service: null },
      { folder: "/home/ada/studies/sepsis", service: null },
    ]).pipe(Effect.provide(NodePath.layerPosix)),
  );

  it.effect("adds folders that only the disk knows are synced", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const alsoSynced = [
        { folder: "/Users/ada/Documents", service: "iCloud Drive (Desktop & Documents Folders)" },
      ];
      const of = (folder: string) =>
        cloudServiceOf({
          folder,
          home: "/Users/ada",
          platform: "darwin",
          environment: {},
          path,
          alsoSynced,
        });
      expect(of("/Users/ada/Documents/sepsis")).toBe("iCloud Drive (Desktop & Documents Folders)");
      expect(of("/Users/ada/Desktop/sepsis")).toBeNull();
    }).pipe(Effect.provide(NodePath.layerPosix)),
  );
});

describe("whyNoHistory", () => {
  it.effect("allows a study's own folder, and nothing that holds a home or a disk", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const why = (folder: string) =>
        whyNoHistory({ folder, home: "C:\\Users\\ada", platform: "win32", environment: {}, path });
      expect(why("C:\\Users\\ada\\Studies\\sepsis")).toBeNull();
      expect(why("D:\\sepsis")).toBeNull();
      expect(why("C:\\Users\\ada")).toContain("your home folder");
      expect(why("c:\\users")).toContain("a folder that holds it");
      expect(why("D:\\")).toContain("the top of a disk");
      expect(why("C:\\Users\\ada\\Dropbox\\sepsis")).toBe(
        "This folder is synced by Dropbox, which can damage a history kept inside it. Keep the study in a folder outside cloud sync to get a history.",
      );
    }).pipe(Effect.provide(NodePath.layerWin32)),
  );
});

describe("excludeFile", () => {
  it("reads back the names it keeps out, whatever characters they have", () => {
    const leftOut = ["big.bin", "outputs/#run [1] !final .bin", "a\\b*?.bin"];
    expect(leftOutIn(excludeFile(leftOut))).toEqual(leftOut.toSorted());
  });
});

describe("iCloudDesktopAndDocuments", () => {
  // iCloud links Desktop and Documents into its own folder; making such a
  // link on Windows needs Developer Mode.
  it.effect.skipIf(!symlinksSupported)(
    "finds Desktop and Documents while iCloud Drive links them",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* Effect.flatMap(
          fileSystem.makeTempDirectoryScoped({ prefix: "lincei-icloud-home-" }),
          fileSystem.realPath,
        );
        const drive = path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
        yield* fileSystem.makeDirectory(drive, { recursive: true });
        for (const name of ["Desktop", "Documents"]) {
          yield* fileSystem.makeDirectory(path.join(home, name));
        }
        expect(yield* iCloudDesktopAndDocuments(home)).toEqual([]);

        // With the setting on, iCloud Drive's folder links to Documents.
        yield* fileSystem.symlink(path.join(home, "Documents"), path.join(drive, "Documents"));
        // Turning it off for Desktop leaves a copy there, a folder of its own.
        yield* fileSystem.makeDirectory(path.join(drive, "Desktop"));
        expect(yield* iCloudDesktopAndDocuments(home)).toEqual([
          {
            folder: path.join(home, "Documents"),
            service: "iCloud Drive (Desktop & Documents Folders)",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
