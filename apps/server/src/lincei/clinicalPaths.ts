/**
 * Where Lincei keeps the clinical research tools and what they produce, under
 * its home directory. The service that installs the tools and the one that
 * runs M4 both read the layout from here, so neither needs the other to find
 * a file.
 *
 * @module clinicalPaths
 */
import type * as Path from "effect/Path";

export interface ClinicalPaths {
  readonly home: string;
  /** Tools Lincei fetched for itself, such as uv. */
  readonly toolsDir: string;
  readonly venvDir: string;
  readonly binDir: string;
  readonly python: string;
  /** M4's command-line program. */
  readonly m4: string;
  readonly skillsDir: string;
  /** M4's dataset store: the user's own when they exported one, else Lincei's. */
  readonly dataDir: string;
  readonly statePath: string;
  /** Holds one file per dataset whose preparation started and has not completed. */
  readonly preparingDir: string;
  /** Histories of study folders whose history was turned off, kept to bring back. */
  readonly studyHistoryDir: string;
}

export const clinicalPaths = (input: {
  readonly baseDir: string;
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly join: Path.Path["join"];
}): ClinicalPaths => {
  const home = input.join(input.baseDir, "clinical");
  const venvDir = input.join(home, "venv");
  const windows = input.platform === "win32";
  const binDir = input.join(venvDir, windows ? "Scripts" : "bin");
  return {
    home,
    toolsDir: input.join(home, "bin"),
    venvDir,
    binDir,
    python: input.join(binDir, windows ? "python.exe" : "python"),
    m4: input.join(binDir, windows ? "m4.exe" : "m4"),
    skillsDir: input.join(home, "skills"),
    dataDir: input.environment.M4_DATA_DIR?.trim() || input.join(home, "m4_data"),
    statePath: input.join(home, "runtime.json"),
    preparingDir: input.join(home, "preparing"),
    studyHistoryDir: input.join(home, "study-history"),
  };
};
