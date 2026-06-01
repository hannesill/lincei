import { useMemo } from "react";
import type { SessionId } from "@t3tools/contracts";

import { useStore } from "../../store";
import type { Session } from "../../types";

const EMPTY_PROPOSED_PLANS: Session["proposedPlans"] = [];
const AI_REVIEW_NOTICE = "Review AI outputs.";

type SessionPlanCatalogEntry = Pick<Session, "id" | "proposedPlans">;

export function AiReviewNotice() {
  return (
    <p className="px-2 text-center text-[11px] leading-4 text-muted-foreground/55">
      {AI_REVIEW_NOTICE}
    </p>
  );
}

export function useSessionPlanCatalog(sessionIds: readonly SessionId[]): SessionPlanCatalogEntry[] {
  return useStore(
    useMemo(() => {
      let previousSessionIds: readonly SessionId[] = [];
      let previousResult: SessionPlanCatalogEntry[] = [];
      let previousEntries = new Map<
        SessionId,
        {
          shell: object | null;
          proposedPlanIds: readonly string[] | undefined;
          proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;
          entry: SessionPlanCatalogEntry;
        }
      >();

      return (state) => {
        const sameSessionIds =
          previousSessionIds.length === sessionIds.length &&
          previousSessionIds.every((id, index) => id === sessionIds[index]);
        const nextEntries = new Map<
          SessionId,
          {
            shell: object | null;
            proposedPlanIds: readonly string[] | undefined;
            proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;
            entry: SessionPlanCatalogEntry;
          }
        >();
        const nextResult: SessionPlanCatalogEntry[] = [];
        let changed = !sameSessionIds;

        for (const sessionId of sessionIds) {
          let shell: object | undefined;
          let proposedPlanIds: readonly string[] | undefined;
          let proposedPlansById: Record<string, Session["proposedPlans"][number]> | undefined;

          for (const environmentState of Object.values(state.environmentStateById)) {
            const matchedShell = environmentState.sessionShellById[sessionId];
            if (!matchedShell) {
              continue;
            }
            shell = matchedShell;
            proposedPlanIds = environmentState.proposedPlanIdsBySessionId[sessionId];
            proposedPlansById = environmentState.proposedPlanBySessionId[sessionId] as
              | Record<string, Session["proposedPlans"][number]>
              | undefined;
            break;
          }

          if (!shell) {
            const previous = previousEntries.get(sessionId);
            if (
              previous &&
              previous.shell === null &&
              previous.proposedPlanIds === undefined &&
              previous.proposedPlansById === undefined
            ) {
              nextEntries.set(sessionId, previous);
              continue;
            }
            changed = true;
            nextEntries.set(sessionId, {
              shell: null,
              proposedPlanIds: undefined,
              proposedPlansById: undefined,
              entry: { id: sessionId, proposedPlans: EMPTY_PROPOSED_PLANS },
            });
            continue;
          }

          const previous = previousEntries.get(sessionId);
          if (
            previous &&
            previous.shell === shell &&
            previous.proposedPlanIds === proposedPlanIds &&
            previous.proposedPlansById === proposedPlansById
          ) {
            nextEntries.set(sessionId, previous);
            nextResult.push(previous.entry);
            continue;
          }

          changed = true;
          const proposedPlans =
            proposedPlanIds && proposedPlanIds.length > 0 && proposedPlansById
              ? proposedPlanIds.flatMap((planId) => {
                  const proposedPlan = proposedPlansById?.[planId];
                  return proposedPlan ? [proposedPlan] : [];
                })
              : EMPTY_PROPOSED_PLANS;
          const entry = { id: sessionId, proposedPlans };
          nextEntries.set(sessionId, {
            shell,
            proposedPlanIds,
            proposedPlansById,
            entry,
          });
          nextResult.push(entry);
        }

        if (!changed && previousResult.length === nextResult.length) {
          return previousResult;
        }

        previousSessionIds = sessionIds;
        previousEntries = nextEntries;
        previousResult = nextResult;
        return nextResult;
      };
    }, [sessionIds]),
  );
}
