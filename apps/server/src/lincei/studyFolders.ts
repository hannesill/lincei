/**
 * studyFolders - what a study's history leaves out, and which folders may
 * keep one at all. Pure, apart from one look at the disk for iCloud.
 *
 * A history is a git repository, so it lives in `.git` beside the study. Not
 * in the home folder or at the top of a disk, where it would take in far more
 * than one study, and not in a folder a cloud service syncs: a repository is
 * thousands of small files that change together, and a service that copies
 * them one by one, from more than one computer, can leave it damaged. Sync
 * services are recognised by where they keep their folders; one that keeps
 * them elsewhere goes unnoticed.
 *
 * @module studyFolders
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/** `csv` as `[cC][sS][vV]`: git on Linux matches case, and data arrives as `.CSV` too. */
const anyCase = (text: string) =>
  text.replace(/[a-z]/g, (char) => `[${char}${char.toUpperCase()}]`);

/** Data, archive, and imaging formats; Vitrine's store, environments, caches, and database journals. */
export const RULES = [
  ..."csv tsv parquet feather arrow xlsx xlsm xls ods sav dta sas7bdat xpt rds rdata rda h5 hdf5 npy npz mat pkl pickle duckdb db sqlite sqlite3 zip gz tgz tar bz2 xz 7z dcm nii edf"
    .split(" ")
    .map((extension) => `*.${anyCase(extension)}`),
  ...".vitrine/ .venv/ venv/ node_modules/ __pycache__/ .ipynb_checkpoints/ .pytest_cache/ .mypy_cache/ .ruff_cache/ .Rproj.user/ .DS_Store *.db-journal *.db-wal *.db-shm *.duckdb.wal *.sqlite-journal *.sqlite-wal *.sqlite-shm".split(
    " ",
  ),
];

/** The `.git/info/exclude` of a history: the rules, and `leftOut` (relative paths) by name. */
export const excludeFile = (leftOut: ReadonlyArray<string>): string =>
  [
    "# Lincei keeps research data out of this folder's history and rewrites this",
    "# file whenever it checks the folder. Rules of your own go in .gitignore.",
    ...RULES,
    "# Too large to keep:",
    ...[...new Set(leftOut)]
      .filter((file) => !/[\r\n]/.test(file))
      .toSorted()
      // Anchored, with every character that means something to git escaped.
      .map((file) => `/${file.replace(/[\\*?[\]!# ]/g, "\\$&")}`),
    "",
  ].join("\n");

/** The files an exclude file keeps out by name. */
export const leftOutIn = (exclude: string): ReadonlyArray<string> =>
  exclude
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => line.slice(1).replace(/\\(.)/g, "$1"));

export interface SyncedFolder {
  readonly folder: string;
  /** The service as its users know it. */
  readonly service: string;
}

/** Below `~/Library/CloudStorage`, File Provider services name their folder `<Service>-<account>`. */
const CLOUD_STORAGE = [
  ["dropbox", "Dropbox"],
  ["onedrive", "OneDrive"],
  ["googledrive", "Google Drive"],
  ["box", "Box"],
] as const;

interface Place {
  /** With links resolved. */
  readonly folder: string;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly path: Path.Path;
  /** Folders only the disk can tell are synced, such as Desktop and Documents in iCloud. */
  readonly alsoSynced?: ReadonlyArray<SyncedFolder>;
}

/** The folders each platform's sync services keep in the home folder, or name in the environment. */
const syncedFolders = ({ home, platform, environment, path }: Place): Array<SyncedFolder> => {
  const inHome = (service: string, ...segments: ReadonlyArray<string>) => ({
    service,
    folder: path.join(home, ...segments),
  });
  switch (platform) {
    case "darwin":
      return [
        inHome("iCloud Drive", "Library", "Mobile Documents"),
        inHome("Dropbox", "Dropbox"),
        inHome("Google Drive", "Google Drive"),
        inHome("Box", "Box"),
      ];
    case "win32":
      return [
        ...["OneDrive", "OneDriveConsumer", "OneDriveCommercial"].flatMap((name) => {
          const folder = environment[name]?.trim();
          return folder ? [{ service: "OneDrive", folder }] : [];
        }),
        inHome("iCloud Drive", "iCloudDrive"),
        inHome("Dropbox", "Dropbox"),
        inHome("Google Drive", "Google Drive"),
      ];
    default:
      return [
        inHome("Dropbox", "Dropbox"),
        inHome("OneDrive", "OneDrive"),
        inHome("Nextcloud", "Nextcloud"),
        inHome("pCloud", "pCloudDrive"),
      ];
  }
};

/** `folder` relative to `root`, or null when it is not inside it. macOS and Windows ignore case. */
const inside = (place: Place, root: string): string | null => {
  const fold = (target: string) => (place.platform === "linux" ? target : target.toLowerCase());
  const relative = place.path.relative(fold(root), fold(place.folder));
  return relative.startsWith("..") || place.path.isAbsolute(relative) ? null : relative;
};

/** The service that syncs the folder, or null. */
export const cloudServiceOf = (place: Place): string | null => {
  const synced = [...syncedFolders(place), ...(place.alsoSynced ?? [])].find(
    (candidate) => inside(place, candidate.folder) !== null,
  );
  if (synced !== undefined) return synced.service;
  const fromHome = place.platform === "darwin" ? inside(place, place.home) : null;
  if (fromHome === null) return null;
  // Folders whose names carry an account: `~/OneDrive - Company`, `~/Library/CloudStorage/Box-Box`.
  const [first = "", second, third = ""] = fromHome.split(place.path.sep);
  if (first.startsWith("onedrive")) return "OneDrive";
  if (first !== "library" || second !== "cloudstorage" || third === "") return null;
  return CLOUD_STORAGE.find(([prefix]) => third.startsWith(prefix))?.[1] ?? "a cloud service";
};

const OWN_FOLDER =
  "Lincei keeps a history only of a study's own folder: put the study in a folder of its own and add that folder as a project.";

/** Why the folder may not keep a history, in words for the researcher, or null when it may. */
export const whyNoHistory = (place: Place): string | null => {
  const { path, folder, home } = place;
  if (path.dirname(folder) === folder) return `This is the top of a disk. ${OWN_FOLDER}`;
  if (inside({ ...place, folder: home }, folder) !== null) {
    return `This is your home folder, or a folder that holds it. ${OWN_FOLDER}`;
  }
  const service = cloudServiceOf(place);
  return service === null
    ? null
    : `This folder is synced by ${service}, which can damage a history kept inside it. Keep the study in a folder outside cloud sync to get a history.`;
};

/**
 * Desktop and Documents while macOS syncs them with iCloud (System Settings,
 * iCloud Drive, "Desktop & Documents Folders"). They stay in the home folder,
 * and iCloud Drive's own folder holds links to them; turning the setting off
 * leaves copies there as folders of their own. Seen on macOS 15, where the
 * folders also carry iCloud's `com.apple.file-provider-domain-id` attribute,
 * which takes a process to read.
 */
export const iCloudDesktopAndDocuments = Effect.fn("studyFolders.iCloudDesktopAndDocuments")(
  function* (home: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const drive = path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    const synced: Array<SyncedFolder> = [];
    for (const name of ["Desktop", "Documents"]) {
      const paths = yield* Effect.option(
        Effect.all([
          fileSystem.realPath(path.join(drive, name)),
          fileSystem.realPath(path.join(home, name)),
        ]),
      );
      if (Option.isSome(paths) && paths.value[0] === paths.value[1]) {
        synced.push({
          folder: paths.value[1],
          service: "iCloud Drive (Desktop & Documents Folders)",
        });
      }
    }
    return synced;
  },
);
