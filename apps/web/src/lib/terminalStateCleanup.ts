interface TerminalRetentionSession {
  key: string;
  deletedAt: string | null;
  archivedAt: string | null;
}

interface CollectActiveTerminalSessionIdsInput {
  snapshotSessions: readonly TerminalRetentionSession[];
  draftSessionKeys: Iterable<string>;
}

export function collectActiveTerminalSessionIds(
  input: CollectActiveTerminalSessionIdsInput,
): Set<string> {
  const activeSessionIds = new Set<string>();
  const snapshotSessionById = new Map(
    input.snapshotSessions.map((session) => [session.key, session]),
  );
  for (const session of input.snapshotSessions) {
    if (session.deletedAt !== null) continue;
    if (session.archivedAt !== null) continue;
    activeSessionIds.add(session.key);
  }
  for (const draftSessionKey of input.draftSessionKeys) {
    const snapshotSession = snapshotSessionById.get(draftSessionKey);
    if (
      snapshotSession &&
      (snapshotSession.deletedAt !== null || snapshotSession.archivedAt !== null)
    ) {
      continue;
    }
    activeSessionIds.add(draftSessionKey);
  }
  return activeSessionIds;
}
