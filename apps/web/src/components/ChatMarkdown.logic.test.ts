import { describe, expect, it } from "vitest";
import { remarkTagInlineCode, type MarkdownAstNode } from "./ChatMarkdown";

describe("remarkTagInlineCode", () => {
  it("tags standalone inline code but never code nested in links", () => {
    const standalone: MarkdownAstNode = { type: "inlineCode" };
    const nestedInLink: MarkdownAstNode = { type: "inlineCode" };
    const nestedInReference: MarkdownAstNode = { type: "inlineCode" };
    const tree: MarkdownAstNode = {
      type: "root",
      children: [
        standalone,
        { type: "link", children: [nestedInLink] },
        { type: "linkReference", children: [nestedInReference] },
      ],
    };

    remarkTagInlineCode()(tree);

    expect(standalone.data?.hProperties).toEqual({ dataInlineCode: "" });
    expect(nestedInLink.data).toBeUndefined();
    expect(nestedInReference.data).toBeUndefined();
  });
});
