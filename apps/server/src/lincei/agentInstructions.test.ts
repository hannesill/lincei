import { describe, expect, it } from "vite-plus/test";

import { LINCEI_CLINICAL_INSTRUCTIONS, linceiAgentInstructions } from "./agentInstructions.ts";

describe("linceiAgentInstructions", () => {
  it("tells agents who they work with only while Techie mode is off", () => {
    const researcher = linceiAgentInstructions({ techieMode: false });
    const techie = linceiAgentInstructions({ techieMode: true });

    expect(researcher).toContain("<lincei_researcher>");
    expect(techie).not.toContain("<lincei_researcher>");
    // The clinical tooling is the same in both modes.
    expect(researcher.startsWith(techie)).toBe(true);
    expect(techie).toContain("<lincei_clinical_research>");
  });

  it("defaults to researcher mode before the stored mode is known", () => {
    expect(LINCEI_CLINICAL_INSTRUCTIONS).toBe(linceiAgentInstructions({ techieMode: false }));
  });

  it("keeps cards in the study of the conversation's folder", () => {
    // An agent that changes directory before publishing writes to another
    // study, and the board beside the conversation stays empty.
    const instructions = linceiAgentInstructions({ techieMode: true });
    expect(instructions).toContain("VITRINE_DATA_DIR");
    expect(instructions).toContain("do not `cd` elsewhere");
  });
});
