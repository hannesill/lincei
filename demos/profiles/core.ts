import type { DemoCard, DemoMessage, DemoScenario } from "../schema.ts";

const dagSvgBase64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgMzYwIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgZmlsbD0iI2Y4ZmFmYyIvPjxnIHN0cm9rZT0iIzBmNzY2ZSIgc3Ryb2tlLXdpZHRoPSIzIiBmaWxsPSJub25lIj48cGF0aCBkPSJNMTIwIDkwIEMyMzAgODAgMjUwIDE1MCAzNDAgMTQ1IEM0NDAgMTQwIDQ2MCAyMjAgNTQwIDIxMCIvPjxwYXRoIGQ9Ik0xNTAgMjUwIEMyMzAgMjEwIDI4MCAyNDUgMzUwIDIxMCBDNDMwIDE3MCA0NzAgMTg1IDU0MCAxMzAiIHN0cm9rZT0iIzRmNDZlNSIvPjwvZz48ZyBmaWxsPSIjMGYxNzJhIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiPjx0ZXh0IHg9IjkyIiB5PSI1MCI+Q29uZm91bmRpbmcgREFHIHNrZXRjaDwvdGV4dD48dGV4dCB4PSI5NSIgeT0iMzE1Ij5zZXZlcml0eSAtPiBmbHVpZHMgLT4gdmFzb3ByZXNzb3JzIC0+IG1vcnRhbGl0eTwvdGV4dD48L2c+PC9zdmc+";
const calibrationSvgBase64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgMzYwIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgZmlsbD0iI2Y5ZmFmYiIvPjxnIGZpbGw9IiMxMTE4MjciIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCI+PHRleHQgeD0iODAiIHk9IjUwIj5DYWxpYnJhdGlvbiBkcmlmdDwvdGV4dD48L2c+PGcgc3Ryb2tlPSIjOWNhM2FmIiBzdHJva2Utd2lkdGg9IjEiPjxwYXRoIGQ9Ik05MCAyOTAgTDU2MCAyOTAgTTkwIDI5MCBMOTAgODAiLz48L2c+PHBhdGggZD0iTTEwMCAyODAgTDE4MCAyMzAgTDI2MCAxODggTDM0MCAxNTUgTDQyMCAxMjggTDU0MCAxMDUiIHN0cm9rZT0iIzBmNzY2ZSIgc3Ryb2tlLXdpZHRoPSI1IiBmaWxsPSJub25lIi8+PHBhdGggZD0iTTEwMCAyODAgTDE5MCAyNTAgTDI3MCAyNTAgTDM1MCAyMTAgTDQ0MCAyMDUgTDU0MCAxNzAiIHN0cm9rZT0iI2RjMjYyNiIgc3Ryb2tlLXdpZHRoPSI1IiBmaWxsPSJub25lIi8+PGxpbmUgeDE9IjEwMCIgeTE9IjI4MCIgeDI9IjU0MCIgeTI9IjEwMCIgc3Ryb2tlPSIjMTExODI3IiBzdHJva2UtZGFzaGFycmF5PSI3IDciLz48L3N2Zz4=";

function messages(
  prefix: string,
  turnOne: string,
  userOne: string,
  assistantOne: string,
  offset: number,
  turnTwo?: { readonly turnId: string; readonly user: string; readonly assistant: string },
): DemoMessage[] {
  const result: DemoMessage[] = [
    {
      id: `demo-message-${prefix}-user-1`,
      role: "user",
      text: userOne,
      turnId: turnOne,
      createdAtOffsetMinutes: offset,
    },
    {
      id: `demo-message-${prefix}-assistant-1`,
      role: "assistant",
      text: assistantOne,
      turnId: turnOne,
      createdAtOffsetMinutes: offset + 3,
    },
  ];
  if (turnTwo) {
    result.push(
      {
        id: `demo-message-${prefix}-user-2`,
        role: "user",
        text: turnTwo.user,
        turnId: turnTwo.turnId,
        createdAtOffsetMinutes: offset + 7,
      },
      {
        id: `demo-message-${prefix}-assistant-2`,
        role: "assistant",
        text: turnTwo.assistant,
        turnId: turnTwo.turnId,
        createdAtOffsetMinutes: offset + 11,
      },
    );
  }
  return result;
}

function artifact(
  id: string,
  kind: string,
  path: string,
  label: string,
  role?: string,
  mimeType?: string,
): NonNullable<DemoCard["artifacts"]>[number] {
  return {
    id,
    kind,
    path,
    label,
    ...(role ? { role } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

function plotlyPreview(title: string, x: string[], series: ReadonlyArray<[string, number[]]>) {
  return {
    spec: {
      data: series.map(([name, y]) => ({ type: "scatter", mode: "lines+markers", name, x, y })),
      layout: {
        title: { text: title },
        xaxis: { title: "Analysis window" },
        yaxis: { title: "Adjusted estimate" },
      },
    },
  };
}

export const coreDemoScenario = {
  scenarioId: "demo-core",
  title: "Clinical Research Demo Portfolio",
  baseTimestamp: "2026-05-18T09:00:00.000Z",
  organizationName: "Lincei Research Cooperative",
  therapeuticArea: "cardiometabolic, oncology, critical care, and neurology",
  studies: [
    {
      id: "demo-study-cardio",
      title: "GLP-1 Persistence and Cardiovascular Risk",
      workspaceRoot: ".demo-home/workspaces/glp1-cv-risk",
      files: [
        {
          path: "protocol/target_trial_protocol.md",
          content: `# Target-trial emulation protocol

Question: among adults with type 2 diabetes initiating GLP-1RA, estimate the effect of 12-month treatment persistence on MACE.

Eligibility: new GLP-1RA users, active comparator SGLT2i initiators, no MACE in prior 180 days, continuous enrollment for 365 days.
Time zero: first eligible prescription fill.
Primary endpoint: nonfatal MI, nonfatal stroke, cardiovascular death within 365 days.
Primary estimand: per-protocol persistence effect using clone-censor-weight.
Key bias controls: grace period pre-specified, IPCW for adherence censoring, negative-control outcome of traumatic injury.
`,
        },
        {
          path: "analysis/cohort.sql",
          content: `with eligible as (
  select person_id, index_date, exposure_arm
  from warehouse.glp1_new_user_index
  where age between 40 and 85
    and prior_mace_180d = 0
    and enrollment_days_prior >= 365
)
select exposure_arm, count(*) as n
from eligible
group by exposure_arm;
`,
        },
        {
          path: "artifacts/baseline_balance.csv",
          content:
            "covariate,weighted_smd,flag\nage,0.03,ok\nprior_mi,0.05,ok\negfr_lt_60,0.11,review\nheart_failure,0.07,ok\nbaseline_hba1c,0.04,ok\n",
        },
        {
          path: "artifacts/extraction_counts.json",
          content: `{
  "new_users": 48218,
  "glp1ra": 26402,
  "sglt2i": 21816,
  "minimum_follow_up_days": 365,
  "negative_control_ready": true
}
`,
        },
        {
          path: "artifacts/persistence_curve.plotly.json",
          content: `{
  "data": [
    { "type": "scatter", "mode": "lines+markers", "name": "GLP-1RA", "x": ["30d", "90d", "180d", "365d"], "y": [0.92, 0.81, 0.70, 0.58] },
    { "type": "scatter", "mode": "lines+markers", "name": "SGLT2i", "x": ["30d", "90d", "180d", "365d"], "y": [0.94, 0.85, 0.76, 0.66] }
  ],
  "layout": { "title": { "text": "Persistence by treatment arm" } }
}
`,
        },
        {
          path: "reports/statistical_analysis_plan.md",
          content: `# Statistical analysis plan

Primary model: weighted pooled logistic model with monthly intervals.
Robust variance: patient-level sandwich estimator.
Sensitivity: 30-day and 60-day persistence grace periods, renal subgroup, falsification endpoint.
Reporting: absolute risk difference and hazard ratio at 365 days.
`,
        },
      ],
      sessions: [
        {
          id: "demo-session-cardio-protocol",
          title: "Target-trial protocol and cohort guardrails",
          messages: messages(
            "cardio-protocol",
            "demo-turn-cardio-protocol-1",
            "Draft a target-trial protocol for GLP-1 persistence and 12-month MACE risk. Flag confounding and censoring choices.",
            "Built the protocol skeleton with eligibility, time zero, active comparator, MACE endpoint, clone-censor-weight design, and negative-control outcome. The main risk is immortal-time bias around persistence classification.",
            1,
            {
              turnId: "demo-turn-cardio-protocol-2",
              user: "Keep it continuation-ready. Add the minimum checks a cardiology reviewer would expect.",
              assistant:
                "Added reviewer checks for grace-period justification, IPCW positivity, renal subgroup balance, and endpoint ascertainment consistency.",
            },
          ),
          cards: [
            {
              id: "demo-card-cardio-markdown-protocol",
              type: "markdown",
              status: "review-requested",
              title: "Target-trial emulation protocol",
              preview: {
                markdown:
                  "Eligibility, time zero, comparator, MACE endpoint, persistence grace period, IPCW plan, and negative-control outcome are specified. Reviewer check: confirm the grace period before extraction.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-cardio-protocol",
                  "markdown",
                  "protocol/target_trial_protocol.md",
                  "Protocol markdown",
                  "primary protocol",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-cardio-protocol-1",
              createdAtOffsetMinutes: 5,
              reviewPrompt:
                "Confirm estimand, comparator, censoring, and negative-control outcome before analysis.",
            },
            {
              id: "demo-card-cardio-table-balance",
              type: "table",
              status: "accepted",
              title: "Baseline balance after weighting",
              preview: {
                columns: ["Covariate", "Weighted SMD", "Flag"],
                rows: [
                  ["Age", "0.03", "ok"],
                  ["Prior MI", "0.05", "ok"],
                  ["eGFR <60", "0.11", "review"],
                  ["Heart failure", "0.07", "ok"],
                ],
                shape: [5, 3],
              },
              artifacts: [
                artifact(
                  "demo-artifact-cardio-balance",
                  "table",
                  "artifacts/baseline_balance.csv",
                  "Weighted baseline table",
                  "diagnostic table",
                  "text/csv",
                ),
              ],
              turnId: "demo-turn-cardio-protocol-2",
              createdAtOffsetMinutes: 12,
              reviewPrompt: "Is residual kidney-disease imbalance acceptable?",
              reviewResponseAction: "accept",
              reviewResponseSummary: "Accept with renal subgroup sensitivity retained.",
            },
          ],
          activities: [
            {
              id: "demo-activity-cardio-plan",
              tone: "info",
              kind: "turn.plan.updated",
              summary: "Protocol review checklist updated",
              payload: {
                plan: [
                  { step: "Define target trial", status: "completed" },
                  { step: "Check baseline balance", status: "completed" },
                  { step: "Run renal sensitivity", status: "pending" },
                ],
              },
              turnId: "demo-turn-cardio-protocol-2",
              sequence: 1,
              createdAtOffsetMinutes: 13,
            },
          ],
          diffs: [
            {
              turnId: "demo-turn-cardio-protocol-2",
              checkpointRef: "demo-checkpoint-cardio-protocol",
              status: "ready",
              assistantMessageId: "demo-message-cardio-protocol-assistant-2",
              checkpointTurnCount: 2,
              completedAtOffsetMinutes: 14,
              files: [
                {
                  path: "protocol/target_trial_protocol.md",
                  kind: "modified",
                  additions: 96,
                  deletions: 8,
                },
                { path: "analysis/cohort.sql", kind: "added", additions: 11, deletions: 0 },
              ],
            },
          ],
        },
        {
          id: "demo-session-cardio-extraction",
          title: "Cohort extraction and audit trail",
          messages: messages(
            "cardio-extraction",
            "demo-turn-cardio-extraction-1",
            "Run the dry-run cohort extraction and show arm counts, exclusions, and anything that could break reproducibility.",
            "Prepared the extraction query and summarized expected counts. I am holding before the warehouse command because this needs command approval.",
            18,
            {
              turnId: "demo-turn-cardio-extraction-2",
              user: "Assume the dry run passed. What should we inspect before the real extraction?",
              assistant:
                "Inspect index-date density, comparator ratio by site, missing baseline eGFR, and whether the negative-control outcome table has the same enrollment window.",
            },
          ),
          cards: [
            {
              id: "demo-card-cardio-counts",
              type: "keyValue",
              status: "proposed",
              title: "Expected extraction checks",
              preview: {
                "New users": "48,218",
                "GLP-1RA": "26,402",
                SGLT2i: "21,816",
                "Minimum follow-up": "365 days",
                "Negative control": "ready",
              },
              artifacts: [
                artifact(
                  "demo-artifact-cardio-counts",
                  "other",
                  "artifacts/extraction_counts.json",
                  "Extraction counts JSON",
                  "audit summary",
                  "application/json",
                ),
              ],
              turnId: "demo-turn-cardio-extraction-2",
              createdAtOffsetMinutes: 30,
            },
          ],
          activities: [
            {
              id: "demo-activity-cardio-approval-requested",
              tone: "approval",
              kind: "approval.requested",
              summary: "Command approval requested",
              payload: {
                requestId: "demo-approval-cardio-extract",
                requestKind: "command",
                requestType: "command_execution_approval",
                detail: "bun run lincei:study extract --study glp1-cv-risk --dry-run=false",
              },
              turnId: "demo-turn-cardio-extraction-1",
              sequence: 1,
              createdAtOffsetMinutes: 22,
            },
          ],
          runtimeState: {
            status: "ready",
            providerName: "Codex",
            activeTurnId: null,
            lastError: null,
            updatedAtOffsetMinutes: 31,
          },
        },
        {
          id: "demo-session-cardio-persistence",
          title: "Persistence curves and adherence censoring",
          messages: messages(
            "cardio-persistence",
            "demo-turn-cardio-persistence-1",
            "Plot persistence by arm and tell me whether censoring weights look stable enough for the primary analysis.",
            "The persistence separation is clinically plausible and weights are stable through month 12. The SGLT2i arm has slightly better continuation, so persistence cannot be treated as random.",
            35,
          ),
          cards: [
            {
              id: "demo-card-cardio-chart-persistence",
              type: "chart",
              status: "accepted",
              title: "Persistence by treatment arm",
              preview: plotlyPreview(
                "Persistence by treatment arm",
                ["30d", "90d", "180d", "365d"],
                [
                  ["GLP-1RA", [0.92, 0.81, 0.7, 0.58]],
                  ["SGLT2i", [0.94, 0.85, 0.76, 0.66]],
                ],
              ),
              artifacts: [
                artifact(
                  "demo-artifact-cardio-persistence-plot",
                  "visual",
                  "artifacts/persistence_curve.plotly.json",
                  "Plotly persistence specification",
                  "analysis figure",
                  "application/json",
                ),
              ],
              turnId: "demo-turn-cardio-persistence-1",
              createdAtOffsetMinutes: 40,
              reviewResponseAction: "accept",
              reviewResponseSummary: "Use in methods review.",
            },
          ],
          activities: [
            {
              id: "demo-activity-cardio-tool-persistence",
              tone: "tool",
              kind: "tool.completed",
              summary: "Generated persistence curve artifact",
              payload: {
                toolTitle: "analysis/persistence_curve.ts",
                changedFiles: ["artifacts/persistence_curve.plotly.json"],
              },
              turnId: "demo-turn-cardio-persistence-1",
              sequence: 1,
              createdAtOffsetMinutes: 39,
            },
          ],
        },
        {
          id: "demo-session-cardio-sensitivity",
          title: "Renal subgroup and grace-period sensitivity",
          messages: messages(
            "cardio-sensitivity",
            "demo-turn-cardio-sensitivity-1",
            "Stress-test the renal subgroup and the persistence grace period. I need a decision on whether the primary result is fragile.",
            "The renal subgroup moves the risk difference but not direction. A 60-day grace period attenuates the effect; I would report it as sensitivity, not switch the primary grace period.",
            48,
          ),
          cards: [
            {
              id: "demo-card-cardio-sap",
              type: "markdown",
              status: "accepted",
              title: "Statistical analysis plan update",
              preview: {
                markdown:
                  "Primary model remains weighted pooled logistic regression. Sensitivity analyses: renal subgroup, 30-day and 60-day grace periods, falsification endpoint.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-cardio-sap",
                  "markdown",
                  "reports/statistical_analysis_plan.md",
                  "SAP markdown",
                  "analysis plan",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-cardio-sensitivity-1",
              createdAtOffsetMinutes: 52,
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-cardio-package",
          title: "Clinical review package",
          messages: messages(
            "cardio-package",
            "demo-turn-cardio-package-1",
            "Prepare the cardiology review package. Surface anything that should block screenshots or live demo continuation.",
            "Packaged the protocol, balance table, persistence plot, and SAP. The only live-demo caveat is that Plotly specs are previewed as card metadata until the chart renderer is upgraded.",
            58,
          ),
          cards: [
            {
              id: "demo-card-cardio-review-gate",
              type: "decision",
              status: "review-requested",
              title: "Proceed to cardiology review",
              preview: {
                fields: [
                  {
                    name: "proceed",
                    header: "Review gate",
                    question: "Proceed with cardiology review package?",
                    options: [
                      {
                        label: "Proceed",
                        description: "Package is coherent for specialist review.",
                      },
                      { label: "Hold", description: "Resolve extraction or charting gaps first." },
                    ],
                  },
                ],
              },
              turnId: "demo-turn-cardio-package-1",
              createdAtOffsetMinutes: 62,
              reviewPrompt: "Confirm whether the cardiology review package can be shown.",
            },
          ],
          activities: [],
        },
      ],
    },
    {
      id: "demo-study-oncology",
      title: "Checkpoint Inhibitor Safety Signal Review",
      workspaceRoot: ".demo-home/workspaces/ici-safety",
      files: [
        {
          path: "protocol/safety_signal_protocol.md",
          content: `# irAE safety signal protocol

Population: metastatic melanoma and NSCLC patients receiving checkpoint inhibitors.
Signals: thyroiditis and myocarditis.
Challenge: separate true incidence from surveillance intensity and lab-only ascertainment.
Primary endpoint: treated thyroiditis and chart-confirmed myocarditis.
`,
        },
        {
          path: "artifacts/irae_incidence.plotly.json",
          content: `{
  "data": [
    { "type": "bar", "name": "Treated thyroiditis", "x": ["1L", "2L", "3L+"], "y": [2.8, 3.1, 3.3] },
    { "type": "bar", "name": "Lab-only thyroiditis", "x": ["1L", "2L", "3L+"], "y": [1.3, 1.4, 1.5] },
    { "type": "bar", "name": "Myocarditis", "x": ["1L", "2L", "3L+"], "y": [0.2, 0.4, 0.5] }
  ],
  "layout": { "title": { "text": "Surveillance-adjusted irAE incidence" }, "barmode": "group" }
}
`,
        },
        {
          path: "artifacts/adjudication_queue.csv",
          content:
            "case_id,signal,days_from_start,troponin_peak,echo_change,priority\ncase-014,myocarditis,18,2.1,true,high\ncase-082,myocarditis,43,0.4,false,medium\ncase-117,thyroiditis,96,,false,low\n",
        },
        {
          path: "reports/safety_board_brief.md",
          content: `# Safety board brief

Thyroiditis signal is stable after visit-density adjustment when lab-only events are separated.
Myocarditis is sparse and should remain chart-review-confirmed for the primary endpoint.
Recommendation: do not use automated myocarditis labels as the primary endpoint.
`,
        },
      ],
      sessions: [
        {
          id: "demo-session-oncology-protocol",
          title: "Safety signal protocol",
          messages: messages(
            "oncology-protocol",
            "demo-turn-oncology-protocol-1",
            "Draft the immune-related adverse event protocol. Separate incidence from surveillance intensity.",
            "Defined the safety cohort, event taxonomy, surveillance adjustment, and endpoint hierarchy. Lab-only thyroiditis is explicitly separated from treated thyroiditis.",
            70,
          ),
          cards: [
            {
              id: "demo-card-oncology-protocol",
              type: "markdown",
              status: "accepted",
              title: "irAE safety protocol",
              preview: {
                markdown:
                  "Primary endpoint uses treated thyroiditis and chart-confirmed myocarditis. Surveillance intensity is modeled by visit density and lab frequency.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-oncology-protocol",
                  "markdown",
                  "protocol/safety_signal_protocol.md",
                  "Safety protocol",
                  "protocol",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-oncology-protocol-1",
              createdAtOffsetMinutes: 74,
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-oncology-incidence",
          title: "Surveillance-adjusted incidence views",
          messages: messages(
            "oncology-incidence",
            "demo-turn-oncology-incidence-1",
            "Triage thyroiditis and myocarditis safety signals. I need visuals that separate incidence from surveillance intensity.",
            "Created the adjusted incidence view. Thyroiditis is stable after separating lab-only events; myocarditis remains sparse and needs chart review.",
            78,
          ),
          cards: [
            {
              id: "demo-card-oncology-chart-irae",
              type: "chart",
              status: "changes-requested",
              title: "Adjusted irAE incidence by treatment line",
              preview: plotlyPreview(
                "Surveillance-adjusted irAE incidence",
                ["1L", "2L", "3L+"],
                [
                  ["Treated thyroiditis", [2.8, 3.1, 3.3]],
                  ["Lab-only thyroiditis", [1.3, 1.4, 1.5]],
                  ["Myocarditis", [0.2, 0.4, 0.5]],
                ],
              ),
              artifacts: [
                artifact(
                  "demo-artifact-oncology-irae-chart",
                  "visual",
                  "artifacts/irae_incidence.plotly.json",
                  "irAE incidence Plotly spec",
                  "safety visualization",
                  "application/json",
                ),
              ],
              turnId: "demo-turn-oncology-incidence-1",
              createdAtOffsetMinutes: 83,
              reviewPrompt: "Should this chart separate lab-only thyroiditis from treated events?",
              reviewResponseAction: "request_changes",
              reviewResponseSummary: "Split lab-only thyroiditis from treated thyroiditis.",
            },
          ],
          activities: [
            {
              id: "demo-activity-oncology-tool",
              tone: "tool",
              kind: "tool.completed",
              summary: "Generated surveillance-adjusted incidence chart",
              payload: {
                toolTitle: "analysis/run_safety_signal.ts",
                changedFiles: ["artifacts/irae_incidence.plotly.json"],
              },
              turnId: "demo-turn-oncology-incidence-1",
              sequence: 1,
              createdAtOffsetMinutes: 82,
            },
          ],
        },
        {
          id: "demo-session-oncology-adjudication",
          title: "Myocarditis adjudication queue",
          messages: messages(
            "oncology-adjudication",
            "demo-turn-oncology-adjudication-1",
            "Build a chart-review queue for suspected myocarditis. Prioritize sparse high-risk cases.",
            "Queued cases by troponin peak, echo change, and time from treatment start. The primary endpoint should use confirmed cases only.",
            88,
          ),
          cards: [
            {
              id: "demo-card-oncology-adjudication-table",
              type: "table",
              status: "review-requested",
              title: "Myocarditis adjudication queue",
              preview: {
                columns: ["case_id", "signal", "days_from_start", "priority"],
                rows: [
                  ["case-014", "myocarditis", 18, "high"],
                  ["case-082", "myocarditis", 43, "medium"],
                  ["case-117", "thyroiditis", 96, "low"],
                ],
                shape: [3, 6],
              },
              artifacts: [
                artifact(
                  "demo-artifact-oncology-adjudication",
                  "table",
                  "artifacts/adjudication_queue.csv",
                  "Adjudication queue",
                  "review queue",
                  "text/csv",
                ),
              ],
              turnId: "demo-turn-oncology-adjudication-1",
              createdAtOffsetMinutes: 93,
              reviewPrompt: "Confirm which cases enter manual chart review.",
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-oncology-endpoint",
          title: "Endpoint decision review",
          messages: messages(
            "oncology-endpoint",
            "demo-turn-oncology-endpoint-1",
            "Should automated myocarditis classification be used in the primary endpoint?",
            "No. The PPV is too uncertain. Use chart-review-confirmed myocarditis for the primary endpoint and keep automated labels as sensitivity only.",
            98,
          ),
          cards: [
            {
              id: "demo-card-oncology-decision-chartreview",
              type: "decision",
              status: "rejected",
              title: "Automated myocarditis case classification",
              preview: {
                recommendation: "Reject for primary analysis",
                rationale:
                  "Positive predictive value is too uncertain without adjudicated chart review.",
                alternatives: ["Manual adjudication sample", "Sensitivity-only automated label"],
              },
              turnId: "demo-turn-oncology-endpoint-1",
              createdAtOffsetMinutes: 102,
              reviewPrompt: "Use automated classification in the primary endpoint?",
              reviewResponseAction: "reject",
              reviewResponseSummary: "Use chart-review-confirmed myocarditis only.",
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-oncology-brief",
          title: "Safety board brief",
          messages: messages(
            "oncology-brief",
            "demo-turn-oncology-brief-1",
            "Package this for a safety board update. Keep it clinically conservative.",
            "Prepared the board brief with separated thyroiditis definitions, chart-review requirements, and sparse-event caveats.",
            106,
          ),
          cards: [
            {
              id: "demo-card-oncology-board-brief",
              type: "markdown",
              status: "accepted",
              title: "Safety board summary",
              preview: {
                markdown:
                  "Thyroiditis signal is stable after surveillance adjustment. Myocarditis remains chart-review-confirmed for primary endpoint.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-oncology-board-brief",
                  "markdown",
                  "reports/safety_board_brief.md",
                  "Safety board brief",
                  "clinical brief",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-oncology-brief-1",
              createdAtOffsetMinutes: 110,
            },
          ],
          activities: [],
        },
      ],
    },
    {
      id: "demo-study-icu",
      title: "Sepsis Fluid Strategy Heterogeneity",
      workspaceRoot: ".demo-home/workspaces/sepsis-fluid",
      files: [
        {
          path: "protocol/fluid_strategy_protocol.md",
          content: `# Sepsis fluid strategy protocol

Question: compare early restrictive versus liberal crystalloid strategy among adults with suspected sepsis.
Primary outcome: 28-day mortality.
Subgroups: vasopressor timing, baseline heart failure, early lactate clearance.
Major bias: treatment selection by clinician severity assessment.
`,
        },
        {
          path: "figures/fluid_strategy_dag.svg",
          content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f8fafc"/><g stroke="#0f766e" stroke-width="3" fill="none"><path d="M120 90 C230 80 250 150 340 145 C440 140 460 220 540 210"/><path d="M150 250 C230 210 280 245 350 210 C430 170 470 185 540 130" stroke="#4f46e5"/></g><g fill="#0f172a" font-family="Arial" font-size="18"><text x="92" y="50">Confounding DAG sketch</text><text x="95" y="315">severity -> fluids -> vasopressors -> mortality</text></g></svg>
`,
        },
        {
          path: "artifacts/subgroup_frame.csv",
          content:
            "subgroup,clinical_value,statistical_risk,decision\nvasopressor_timing,high,medium,primary\nlactate_clearance,medium,high,sensitivity\nbaseline_heart_failure,high,medium,secondary\n",
        },
        {
          path: "reports/clinician_input.md",
          content: `# Clinician input log

Primary subgroup should be vasopressor timing because it is observable early and maps to bedside decision-making.
Lactate clearance remains sensitivity because it is downstream of initial treatment response.
`,
        },
      ],
      sessions: [
        {
          id: "demo-session-icu-protocol",
          title: "Protocol and causal diagram",
          messages: messages(
            "icu-protocol",
            "demo-turn-icu-protocol-1",
            "Frame subgroup analysis for early restrictive versus liberal fluids. Ask before locking final subgroup labels.",
            "The candidate subgroups are vasopressor timing, lactate clearance, and baseline heart failure. The DAG shows severity, clinician preference, fluids, vasopressor timing, renal failure, and mortality.",
            116,
          ),
          cards: [
            {
              id: "demo-card-icu-image-dag",
              type: "image",
              status: "review-requested",
              title: "Confounding DAG for fluid strategy",
              preview: {
                data: dagSvgBase64,
                format: "svg",
                imageAlt:
                  "Directed graph linking sepsis severity, clinician preference, fluid volume, vasopressor timing, renal failure, and mortality.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-icu-dag",
                  "visual",
                  "figures/fluid_strategy_dag.svg",
                  "DAG SVG",
                  "causal diagram",
                  "image/svg+xml",
                ),
              ],
              turnId: "demo-turn-icu-protocol-1",
              createdAtOffsetMinutes: 121,
              reviewPrompt:
                "Confirm whether clinician preference should be modeled as site-level random effect.",
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-icu-input",
          title: "Pending clinician input on subgroup framing",
          messages: messages(
            "icu-input",
            "demo-turn-icu-input-1",
            "Before you finalize subgroup labels, ask the clinician which framing should be primary.",
            "I prepared the subgroup decision point. Vasopressor timing is most interpretable; lactate clearance may be more physiologic but is downstream of initial treatment.",
            126,
          ),
          cards: [
            {
              id: "demo-card-icu-subgroup-frame",
              type: "decision",
              status: "review-requested",
              title: "Primary subgroup framing",
              preview: {
                fields: [
                  {
                    name: "subgroup-frame",
                    header: "Subgroups",
                    question: "Which subgroup frame should be primary?",
                    options: [
                      {
                        label: "Vasopressor timing",
                        description: "Best bedside interpretability.",
                      },
                      {
                        label: "Lactate clearance",
                        description: "Stronger physiologic signal, but downstream.",
                      },
                      {
                        label: "Heart failure",
                        description: "Clinically important effect modifier.",
                      },
                    ],
                  },
                ],
              },
              turnId: "demo-turn-icu-input-1",
              createdAtOffsetMinutes: 130,
              reviewPrompt: "Choose the primary subgroup frame.",
            },
          ],
          activities: [
            {
              id: "demo-activity-icu-user-input",
              tone: "info",
              kind: "user-input.requested",
              summary: "User input requested",
              payload: { requestId: "demo-input-icu-subgroups" },
              turnId: "demo-turn-icu-input-1",
              sequence: 1,
              createdAtOffsetMinutes: 131,
            },
          ],
          runtimeState: {
            status: "ready",
            providerName: "Codex",
            activeTurnId: null,
            lastError: null,
            updatedAtOffsetMinutes: 132,
          },
        },
        {
          id: "demo-session-icu-subgroup-table",
          title: "Subgroup table and estimand labels",
          messages: messages(
            "icu-subgroup-table",
            "demo-turn-icu-subgroup-table-1",
            "Assume the clinician chose vasopressor timing. Convert the subgroup plan into a table we can review.",
            "Prepared the subgroup table. Vasopressor timing is primary, heart failure is secondary, and lactate clearance stays sensitivity-only.",
            136,
          ),
          cards: [
            {
              id: "demo-card-icu-subgroup-table",
              type: "table",
              status: "accepted",
              title: "Subgroup framing table",
              preview: {
                columns: ["subgroup", "clinical_value", "statistical_risk", "decision"],
                rows: [
                  ["vasopressor_timing", "high", "medium", "primary"],
                  ["lactate_clearance", "medium", "high", "sensitivity"],
                  ["baseline_heart_failure", "high", "medium", "secondary"],
                ],
                shape: [3, 4],
              },
              artifacts: [
                artifact(
                  "demo-artifact-icu-subgroups",
                  "table",
                  "artifacts/subgroup_frame.csv",
                  "Subgroup frame table",
                  "analysis table",
                  "text/csv",
                ),
              ],
              turnId: "demo-turn-icu-subgroup-table-1",
              createdAtOffsetMinutes: 140,
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-icu-positivity",
          title: "Positivity and treatment-selection checks",
          messages: messages(
            "icu-positivity",
            "demo-turn-icu-positivity-1",
            "Check whether treatment overlap is credible after stratifying by vasopressor timing.",
            "Overlap is acceptable in early vasopressor and no-vasopressor strata. The late-vasopressor stratum is thin, so I marked it as sensitivity-only.",
            144,
          ),
          cards: [
            {
              id: "demo-card-icu-positivity",
              type: "keyValue",
              status: "proposed",
              title: "Treatment overlap diagnostics",
              preview: {
                "Early vasopressor": "acceptable",
                "No vasopressor": "acceptable",
                "Late vasopressor": "thin overlap",
                Action: "sensitivity only",
              },
              turnId: "demo-turn-icu-positivity-1",
              createdAtOffsetMinutes: 148,
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-icu-report",
          title: "Clinician-facing subgroup report",
          messages: messages(
            "icu-report",
            "demo-turn-icu-report-1",
            "Package the ICU subgroup choice with the clinician rationale.",
            "Created a short clinician input log and linked the subgroup table. The report is ready for critical-care review.",
            152,
          ),
          cards: [
            {
              id: "demo-card-icu-clinician-log",
              type: "markdown",
              status: "accepted",
              title: "Clinician input log",
              preview: {
                markdown:
                  "Primary subgroup: vasopressor timing. Lactate clearance remains sensitivity because it is downstream of initial treatment response.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-icu-clinician-log",
                  "markdown",
                  "reports/clinician_input.md",
                  "Clinician input log",
                  "review note",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-icu-report-1",
              createdAtOffsetMinutes: 156,
            },
          ],
          activities: [],
        },
      ],
    },
    {
      id: "demo-study-neuro",
      title: "Post-stroke Readmission Risk Model",
      workspaceRoot: ".demo-home/workspaces/stroke-readmission",
      files: [
        {
          path: "reports/model_audit.md",
          content: `# Model audit

Problem: calibration worsened after adding imaging proxies.
Finding: imaging_proxy_score has temporal missingness drift and discharge disposition leaks post-baseline care planning.
Action: remove discharge disposition from baseline model and keep preventable readmission as sensitivity endpoint only.
`,
        },
        {
          path: "figures/calibration_drift.svg",
          content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f9fafb"/><g fill="#111827" font-family="Arial" font-size="18"><text x="80" y="50">Calibration drift</text></g><g stroke="#9ca3af" stroke-width="1"><path d="M90 290 L560 290 M90 290 L90 80"/></g><path d="M100 280 L180 230 L260 188 L340 155 L420 128 L540 105" stroke="#0f766e" stroke-width="5" fill="none"/><path d="M100 280 L190 250 L270 250 L350 210 L440 205 L540 170" stroke="#dc2626" stroke-width="5" fill="none"/><line x1="100" y1="280" x2="540" y2="100" stroke="#111827" stroke-dasharray="7 7"/></svg>
`,
        },
        {
          path: "artifacts/feature_audit.csv",
          content:
            "feature,missingness_train,missingness_recent,leakage_risk,action\nimaging_proxy_score,0.08,0.19,medium,review\ndischarge_disposition,0.01,0.01,high,remove\nnihss_score,0.12,0.13,low,keep\n",
        },
      ],
      sessions: [
        {
          id: "demo-session-neuro-calibration",
          title: "Calibration drift investigation",
          messages: messages(
            "neuro-calibration",
            "demo-turn-neuro-calibration-1",
            "The calibration plot got worse after adding imaging proxies. Investigate before changing the endpoint.",
            "I found missingness drift in the imaging proxy table and a likely leakage path through discharge disposition. I am isolating the feature group now.",
            162,
          ),
          cards: [
            {
              id: "demo-card-neuro-calibration-image",
              type: "image",
              status: "review-requested",
              title: "Calibration drift after imaging proxies",
              preview: {
                data: calibrationSvgBase64,
                format: "svg",
                imageAlt: "Calibration drift plot with baseline and imaging proxy model lines.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-neuro-calibration",
                  "visual",
                  "figures/calibration_drift.svg",
                  "Calibration drift SVG",
                  "diagnostic figure",
                  "image/svg+xml",
                ),
              ],
              turnId: "demo-turn-neuro-calibration-1",
              createdAtOffsetMinutes: 166,
              reviewPrompt: "Confirm whether to remove the suspected leakage feature group.",
            },
          ],
          activities: [
            {
              id: "demo-activity-neuro-warning",
              tone: "error",
              kind: "runtime.warning",
              summary: "Feature audit found missingness drift",
              payload: {
                message:
                  "imaging_proxy_score missingness increased from 8% to 19% in the recent validation window.",
              },
              turnId: "demo-turn-neuro-calibration-1",
              sequence: 1,
              createdAtOffsetMinutes: 165,
            },
          ],
        },
        {
          id: "demo-session-neuro-feature-audit",
          title: "Feature audit table",
          messages: messages(
            "neuro-feature-audit",
            "demo-turn-neuro-feature-audit-1",
            "Show the feature audit table and mark leakage risks.",
            "Discharge disposition is high leakage risk and should be removed. Imaging proxy score has missingness drift and needs a temporal sensitivity check.",
            170,
          ),
          cards: [
            {
              id: "demo-card-neuro-feature-audit",
              type: "table",
              status: "changes-requested",
              title: "Feature audit and leakage risks",
              preview: {
                columns: [
                  "feature",
                  "missingness_train",
                  "missingness_recent",
                  "leakage_risk",
                  "action",
                ],
                rows: [
                  ["imaging_proxy_score", "0.08", "0.19", "medium", "review"],
                  ["discharge_disposition", "0.01", "0.01", "high", "remove"],
                  ["nihss_score", "0.12", "0.13", "low", "keep"],
                ],
                shape: [3, 5],
              },
              artifacts: [
                artifact(
                  "demo-artifact-neuro-feature-audit",
                  "table",
                  "artifacts/feature_audit.csv",
                  "Feature audit table",
                  "audit table",
                  "text/csv",
                ),
              ],
              turnId: "demo-turn-neuro-feature-audit-1",
              createdAtOffsetMinutes: 174,
              reviewPrompt: "Should discharge disposition be excluded from all baseline models?",
              reviewResponseAction: "request_changes",
              reviewResponseSummary: "Remove discharge disposition and rerun calibration.",
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-neuro-endpoint",
          title: "Endpoint sensitivity decision",
          messages: messages(
            "neuro-endpoint",
            "demo-turn-neuro-endpoint-1",
            "Do not change the primary endpoint just to rescue calibration. Propose a sensitivity endpoint if clinically valid.",
            "I kept 30-day all-cause readmission as primary and proposed preventable readmission as sensitivity only because it depends on claims-derived labels.",
            178,
          ),
          cards: [
            {
              id: "demo-card-neuro-decision-endpoint",
              type: "decision",
              status: "superseded",
              title: "30-day all-cause readmission endpoint",
              preview: {
                recommendation: "Keep as primary endpoint",
                rationale: "Changing endpoint would conflate model debugging with study design.",
              },
              turnId: "demo-turn-neuro-endpoint-1",
              createdAtOffsetMinutes: 182,
            },
            {
              id: "demo-card-neuro-decision-endpoint-v2",
              type: "decision",
              status: "proposed",
              title: "Preventable-readmission sensitivity endpoint",
              preview: {
                recommendation: "Use as sensitivity analysis only",
                rationale: "More clinically specific but depends on claims-derived labels.",
              },
              turnId: "demo-turn-neuro-endpoint-1",
              createdAtOffsetMinutes: 183,
            },
          ],
          activities: [],
        },
        {
          id: "demo-session-neuro-model-rerun",
          title: "Leakage-controlled rerun",
          messages: messages(
            "neuro-model-rerun",
            "demo-turn-neuro-model-rerun-1",
            "Assume discharge disposition was removed. Summarize the rerun status and what still needs validation.",
            "Calibration improves after removing discharge disposition, but imaging proxy drift still requires temporal validation and site-stratified reporting.",
            186,
          ),
          cards: [
            {
              id: "demo-card-neuro-rerun-status",
              type: "keyValue",
              status: "proposed",
              title: "Leakage-controlled rerun status",
              preview: {
                "Discharge disposition": "removed",
                "Calibration slope": "0.94",
                "Recent-window ECE": "0.031",
                "Remaining risk": "imaging proxy drift",
              },
              turnId: "demo-turn-neuro-model-rerun-1",
              createdAtOffsetMinutes: 190,
            },
          ],
          activities: [
            {
              id: "demo-activity-neuro-tool",
              tone: "tool",
              kind: "tool.progress",
              summary: "Auditing calibration drift",
              payload: {
                toolTitle: "scripts/audit_calibration.ts",
                detail: "Checking feature groups and temporal splits.",
              },
              turnId: "demo-turn-neuro-model-rerun-1",
              sequence: 1,
              createdAtOffsetMinutes: 189,
            },
          ],
        },
        {
          id: "demo-session-neuro-audit-package",
          title: "Model audit package",
          messages: messages(
            "neuro-audit-package",
            "demo-turn-neuro-audit-package-1",
            "Package the model audit so a stroke outcomes researcher can review the endpoint and leakage decisions.",
            "Packaged the audit note, calibration figure, feature table, and endpoint decision. The package distinguishes design choices from model debugging.",
            194,
          ),
          cards: [
            {
              id: "demo-card-neuro-model-audit",
              type: "markdown",
              status: "accepted",
              title: "Model audit summary",
              preview: {
                markdown:
                  "Calibration worsened after imaging proxies. Discharge disposition is leakage and removed; preventable readmission remains sensitivity only.",
              },
              artifacts: [
                artifact(
                  "demo-artifact-neuro-model-audit",
                  "markdown",
                  "reports/model_audit.md",
                  "Model audit markdown",
                  "audit note",
                  "text/markdown",
                ),
              ],
              turnId: "demo-turn-neuro-audit-package-1",
              createdAtOffsetMinutes: 198,
            },
          ],
          activities: [],
          runtimeState: {
            status: "ready",
            providerName: "Codex",
            activeTurnId: null,
            lastError: null,
            updatedAtOffsetMinutes: 199,
          },
        },
      ],
    },
  ],
} satisfies DemoScenario;
