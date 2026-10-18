import { describe, expect, it } from "vite-plus/test";

import { linceiAgentInstructions } from "./agentInstructions.ts";

describe("linceiAgentInstructions", () => {
  it("tells agents who they work with only while Techie mode is off", () => {
    const researcher = linceiAgentInstructions({ techieMode: false, platform: "darwin" });
    const techie = linceiAgentInstructions({ techieMode: true, platform: "darwin" });

    expect(researcher).toContain("<lincei_researcher>");
    expect(techie).not.toContain("<lincei_researcher>");
    // The clinical tooling is the same in both modes.
    expect(researcher.startsWith(techie)).toBe(true);
    expect(techie).toContain("<lincei>");
  });

  it("keeps cards in the study of the conversation's folder", () => {
    // An agent that changes directory before publishing writes to another
    // study, and the board beside the conversation stays empty.
    const instructions = linceiAgentInstructions({ techieMode: true, platform: "linux" });
    expect(instructions).toContain("VITRINE_DATA_DIR");
    expect(instructions).toContain("run the code that publishes from that folder");
  });

  it("tells agents in both modes what a card is and how to read the board", () => {
    // The user talks about "the card" they see; the agent cannot see the board.
    for (const techieMode of [false, true]) {
      const instructions = linceiAgentInstructions({ techieMode, platform: "darwin" });
      expect(instructions).toContain('a "card" is one result on that board');
      expect(instructions).toContain("vitrine.study_context(label)");
    }
  });

  it("sends imaging results to the board and keeps credentialed images away from the model", () => {
    // Pixels an agent reads go to its model provider; Lincei shows a markdown
    // image or a card on the user's machine without the agent seeing it.
    for (const techieMode of [false, true]) {
      const instructions = linceiAgentInstructions({ techieMode, platform: "darwin" });
      expect(instructions).toContain("put imaging results on the board");
      expect(instructions).toContain("vitrine.Picture(");
      expect(instructions).toContain("Never open or view images from credentialed datasets");
      // Images of a credentialed dataset come through the researcher's sign-in, never the agent's.
      expect(instructions).toContain("call lincei_clinical_fetch_images");
      expect(instructions).toContain("`m4 fetch-images` for them");
    }
  });

  it("puts Lincei's programs first in a POSIX shell on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const instructions = linceiAgentInstructions({ techieMode: true, platform });
      expect(instructions).toContain('`export PATH="$LINCEI_CLINICAL_BIN:$PATH";`');
      expect(instructions).not.toContain("PowerShell");
    }
  });

  it("puts Lincei's programs first in both shells Windows agents use", () => {
    const instructions = linceiAgentInstructions({ techieMode: true, platform: "win32" });
    // Codex runs commands in PowerShell.
    expect(instructions).toContain('`$env:Path = "$env:LINCEI_CLINICAL_BIN;$env:Path";`');
    // Claude Code runs them in Git Bash, where PATH holds POSIX paths and a
    // drive letter's colon would split the Windows one in two.
    expect(instructions).toContain('`export PATH="$(cygpath -u "$LINCEI_CLINICAL_BIN"):$PATH";`');
    expect(instructions).not.toContain('export PATH="$LINCEI_CLINICAL_BIN:$PATH"');
    // `python3` on Windows is the Microsoft Store's stand-in.
    expect(instructions).toContain("`python` (not `python3`)");
    expect(instructions).not.toContain("macOS");
  });
});
