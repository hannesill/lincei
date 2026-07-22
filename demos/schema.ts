export interface DemoMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId?: string | null | undefined;
  readonly createdAtOffsetMinutes: number;
}

export interface DemoActivity {
  readonly id: string;
  readonly tone: "info" | "tool" | "approval" | "error";
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly turnId?: string | null | undefined;
  readonly sequence?: number | undefined;
  readonly createdAtOffsetMinutes: number;
}

export interface DemoDiff {
  readonly turnId: string;
  readonly checkpointRef: string;
  readonly status: "ready" | "missing" | "error";
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly assistantMessageId?: string | undefined;
  readonly checkpointTurnCount: number;
  readonly completedAtOffsetMinutes: number;
}

export interface DemoRuntimeState {
  readonly status: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
  readonly providerName: string | null;
  readonly activeTurnId: string | null;
  readonly lastError: string | null;
  readonly updatedAtOffsetMinutes: number;
}

export interface DemoSession {
  readonly id: string;
  readonly title: string;
  readonly messages: ReadonlyArray<DemoMessage>;
  readonly activities: ReadonlyArray<DemoActivity>;
  readonly diffs?: ReadonlyArray<DemoDiff> | undefined;
  readonly runtimeState?: DemoRuntimeState | undefined;
}

export interface DemoStudy {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly files?: ReadonlyArray<DemoWorkspaceFile> | undefined;
  readonly sessions: ReadonlyArray<DemoSession>;
}

export interface DemoWorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface DemoScenario {
  readonly scenarioId: string;
  readonly title: string;
  readonly baseTimestamp: string;
  readonly organizationName: string;
  readonly therapeuticArea: string;
  readonly studies: ReadonlyArray<DemoStudy>;
}

export interface DemoScenarioOverlay {
  readonly title?: string | undefined;
  readonly organizationName?: string | undefined;
  readonly therapeuticArea?: string | undefined;
  readonly studyTitles?: Readonly<Record<string, string>> | undefined;
  readonly sessionTitles?: Readonly<Record<string, string>> | undefined;
}

export interface DemoSeedRequest {
  readonly scenario: DemoScenario;
  readonly force?: boolean | undefined;
  readonly providerBacked?: boolean | undefined;
}

const demoIdPattern = /^demo-[a-z0-9-]+$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const tones = new Set(["info", "tool", "approval", "error"]);
const runtimeStatuses = new Set([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function assertDemoId(value: unknown, path: string): string {
  const id = assertString(value, path);
  if (!demoIdPattern.test(id)) {
    throw new Error(
      `${path} must start with demo- and contain only lowercase letters, numbers, and hyphens.`,
    );
  }
  return id;
}

function assertOptionalStringMap(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  for (const [key, entry] of Object.entries(value)) {
    assertString(key, `${path} key`);
    assertString(entry, `${path}.${key}`);
  }
  return value as Record<string, string>;
}

function validateMessages(value: unknown, path: string): DemoMessage[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}[${index}] must be an object.`);
    const role = entry.role;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new Error(`${path}[${index}].role is invalid.`);
    }
    return {
      id: assertDemoId(entry.id, `${path}[${index}].id`),
      role,
      text: typeof entry.text === "string" ? entry.text : "",
      ...(entry.turnId !== undefined
        ? {
            turnId:
              entry.turnId === null ? null : assertDemoId(entry.turnId, `${path}[${index}].turnId`),
          }
        : {}),
      createdAtOffsetMinutes: assertNumber(
        entry.createdAtOffsetMinutes,
        `${path}[${index}].createdAtOffsetMinutes`,
      ),
    };
  });
}

function validateWorkspaceFiles(value: unknown, path: string): DemoWorkspaceFile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}[${index}] must be an object.`);
    return {
      path: assertString(entry.path, `${path}[${index}].path`),
      content: typeof entry.content === "string" ? entry.content : "",
    };
  });
}

function validateActivities(value: unknown, path: string): DemoActivity[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}[${index}] must be an object.`);
    const tone = assertString(entry.tone, `${path}[${index}].tone`);
    if (!tones.has(tone)) throw new Error(`${path}[${index}].tone is invalid.`);
    return {
      id: assertDemoId(entry.id, `${path}[${index}].id`),
      tone: tone as DemoActivity["tone"],
      kind: assertString(entry.kind, `${path}[${index}].kind`),
      summary: assertString(entry.summary, `${path}[${index}].summary`),
      payload: entry.payload,
      ...(entry.turnId !== undefined
        ? {
            turnId:
              entry.turnId === null ? null : assertDemoId(entry.turnId, `${path}[${index}].turnId`),
          }
        : {}),
      ...(entry.sequence !== undefined
        ? { sequence: assertNumber(entry.sequence, `${path}[${index}].sequence`) }
        : {}),
      createdAtOffsetMinutes: assertNumber(
        entry.createdAtOffsetMinutes,
        `${path}[${index}].createdAtOffsetMinutes`,
      ),
    };
  });
}

function validateDiffs(value: unknown, path: string): DemoDiff[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}[${index}] must be an object.`);
    const status = assertString(entry.status, `${path}[${index}].status`);
    if (status !== "ready" && status !== "missing" && status !== "error") {
      throw new Error(`${path}[${index}].status is invalid.`);
    }
    if (!Array.isArray(entry.files)) throw new Error(`${path}[${index}].files must be an array.`);
    return {
      turnId: assertDemoId(entry.turnId, `${path}[${index}].turnId`),
      checkpointRef: assertString(entry.checkpointRef, `${path}[${index}].checkpointRef`),
      status,
      files: entry.files.map((file, fileIndex) => {
        if (!isRecord(file))
          throw new Error(`${path}[${index}].files[${fileIndex}] must be an object.`);
        return {
          path: assertString(file.path, `${path}[${index}].files[${fileIndex}].path`),
          kind: assertString(file.kind, `${path}[${index}].files[${fileIndex}].kind`),
          additions: assertNumber(
            file.additions,
            `${path}[${index}].files[${fileIndex}].additions`,
          ),
          deletions: assertNumber(
            file.deletions,
            `${path}[${index}].files[${fileIndex}].deletions`,
          ),
        };
      }),
      ...(entry.assistantMessageId !== undefined
        ? {
            assistantMessageId: assertDemoId(
              entry.assistantMessageId,
              `${path}[${index}].assistantMessageId`,
            ),
          }
        : {}),
      checkpointTurnCount: assertNumber(
        entry.checkpointTurnCount,
        `${path}[${index}].checkpointTurnCount`,
      ),
      completedAtOffsetMinutes: assertNumber(
        entry.completedAtOffsetMinutes,
        `${path}[${index}].completedAtOffsetMinutes`,
      ),
    };
  });
}

function validateRuntimeState(value: unknown, path: string): DemoRuntimeState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const status = assertString(value.status, `${path}.status`);
  if (!runtimeStatuses.has(status)) throw new Error(`${path}.status is invalid.`);
  return {
    status: status as DemoRuntimeState["status"],
    providerName:
      value.providerName === null ? null : assertString(value.providerName, `${path}.providerName`),
    activeTurnId:
      value.activeTurnId === null ? null : assertDemoId(value.activeTurnId, `${path}.activeTurnId`),
    lastError: value.lastError === null ? null : assertString(value.lastError, `${path}.lastError`),
    updatedAtOffsetMinutes: assertNumber(
      value.updatedAtOffsetMinutes,
      `${path}.updatedAtOffsetMinutes`,
    ),
  };
}

export function validateDemoScenario(input: unknown): DemoScenario {
  if (!isRecord(input)) throw new Error("scenario must be an object.");
  const baseTimestamp = assertString(input.baseTimestamp, "scenario.baseTimestamp");
  if (!timestampPattern.test(baseTimestamp)) {
    throw new Error("scenario.baseTimestamp must be an ISO minute timestamp ending in .000Z.");
  }
  if (!Array.isArray(input.studies)) throw new Error("scenario.studies must be an array.");
  return {
    scenarioId: assertDemoId(input.scenarioId, "scenario.scenarioId"),
    title: assertString(input.title, "scenario.title"),
    baseTimestamp,
    organizationName: assertString(input.organizationName, "scenario.organizationName"),
    therapeuticArea: assertString(input.therapeuticArea, "scenario.therapeuticArea"),
    studies: input.studies.map((study, studyIndex) => {
      if (!isRecord(study)) throw new Error(`scenario.studies[${studyIndex}] must be an object.`);
      if (!Array.isArray(study.sessions)) {
        throw new Error(`scenario.studies[${studyIndex}].sessions must be an array.`);
      }
      return {
        id: assertDemoId(study.id, `scenario.studies[${studyIndex}].id`),
        title: assertString(study.title, `scenario.studies[${studyIndex}].title`),
        workspaceRoot: assertString(
          study.workspaceRoot,
          `scenario.studies[${studyIndex}].workspaceRoot`,
        ),
        ...(study.files !== undefined
          ? {
              files: validateWorkspaceFiles(study.files, `scenario.studies[${studyIndex}].files`),
            }
          : {}),
        sessions: study.sessions.map((session, sessionIndex) => {
          if (!isRecord(session)) {
            throw new Error(
              `scenario.studies[${studyIndex}].sessions[${sessionIndex}] must be an object.`,
            );
          }
          return {
            id: assertDemoId(
              session.id,
              `scenario.studies[${studyIndex}].sessions[${sessionIndex}].id`,
            ),
            title: assertString(
              session.title,
              `scenario.studies[${studyIndex}].sessions[${sessionIndex}].title`,
            ),
            messages: validateMessages(
              session.messages,
              `scenario.studies[${studyIndex}].sessions[${sessionIndex}].messages`,
            ),
            activities: validateActivities(
              session.activities,
              `scenario.studies[${studyIndex}].sessions[${sessionIndex}].activities`,
            ),
            ...(session.diffs !== undefined
              ? {
                  diffs: validateDiffs(
                    session.diffs,
                    `scenario.studies[${studyIndex}].sessions[${sessionIndex}].diffs`,
                  ),
                }
              : {}),
            ...(session.runtimeState !== undefined
              ? {
                  runtimeState: validateRuntimeState(
                    session.runtimeState,
                    `scenario.studies[${studyIndex}].sessions[${sessionIndex}].runtimeState`,
                  ),
                }
              : {}),
          };
        }),
      };
    }),
  };
}

export function validateDemoScenarioOverlay(input: unknown): DemoScenarioOverlay {
  if (!isRecord(input)) throw new Error("overlay must be an object.");
  return {
    ...(input.title !== undefined ? { title: assertString(input.title, "overlay.title") } : {}),
    ...(input.organizationName !== undefined
      ? { organizationName: assertString(input.organizationName, "overlay.organizationName") }
      : {}),
    ...(input.therapeuticArea !== undefined
      ? { therapeuticArea: assertString(input.therapeuticArea, "overlay.therapeuticArea") }
      : {}),
    ...(input.studyTitles !== undefined
      ? { studyTitles: assertOptionalStringMap(input.studyTitles, "overlay.studyTitles") }
      : {}),
    ...(input.sessionTitles !== undefined
      ? { sessionTitles: assertOptionalStringMap(input.sessionTitles, "overlay.sessionTitles") }
      : {}),
  };
}

export function validateDemoSeedRequest(input: unknown): DemoSeedRequest {
  if (!isRecord(input)) throw new Error("seed request must be an object.");
  return {
    scenario: validateDemoScenario(input.scenario),
    ...(input.force !== undefined ? { force: input.force === true } : {}),
    ...(input.providerBacked !== undefined
      ? { providerBacked: input.providerBacked === true }
      : {}),
  };
}

export function applyDemoScenarioOverlay(
  scenario: DemoScenario,
  overlay: DemoScenarioOverlay,
): DemoScenario {
  const studyTitles = overlay.studyTitles ?? {};
  const sessionTitles = overlay.sessionTitles ?? {};

  return {
    ...scenario,
    title: overlay.title ?? scenario.title,
    organizationName: overlay.organizationName ?? scenario.organizationName,
    therapeuticArea: overlay.therapeuticArea ?? scenario.therapeuticArea,
    studies: scenario.studies.map((study) => ({
      ...study,
      title: studyTitles[study.id] ?? study.title,
      sessions: study.sessions.map((session) => ({
        ...session,
        title: sessionTitles[session.id] ?? session.title,
      })),
    })),
  };
}
