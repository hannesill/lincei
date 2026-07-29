import { describe, expect, it } from "vitest";

import {
  resolveInlineCodeFileLinkMeta,
  resolveMarkdownFileLinkMeta,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
} from "./markdown-links";

describe("rewriteMarkdownFileUriHref", () => {
  it("rewrites file uri hrefs into direct path hrefs", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/julius/project/src/main.ts#L42")).toBe(
      "/Users/julius/project/src/main.ts#L42",
    );
  });

  it("preserves encoded octets so file paths are decoded only once later", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/julius/project/file%2520name.md")).toBe(
      "/Users/julius/project/file%2520name.md",
    );
  });

  it("normalizes file uri hrefs for windows drive paths", () => {
    expect(
      rewriteMarkdownFileUriHref(
        "file:///D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69");
  });

  it("unwraps angle-bracketed file uri hrefs", () => {
    expect(
      rewriteMarkdownFileUriHref(" <file:///D:/Programme/t3code/apps/web/src/markdown-links.ts> "),
    ).toBe("D:/Programme/t3code/apps/web/src/markdown-links.ts");
  });
});

describe("resolveMarkdownFileLinkTarget", () => {
  it("resolves absolute posix file paths", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/julius/project/AGENTS.md")).toBe(
      "/Users/julius/project/AGENTS.md",
    );
  });

  it("resolves relative file paths against cwd", () => {
    expect(resolveMarkdownFileLinkTarget("src/processRunner.ts:71", "/Users/julius/project")).toBe(
      "/Users/julius/project/src/processRunner.ts:71",
    );
  });

  it("does not treat filename line references as external schemes", () => {
    expect(resolveMarkdownFileLinkTarget("script.ts:10", "/Users/julius/project")).toBe(
      "/Users/julius/project/script.ts:10",
    );
  });

  it("resolves bare file names against cwd", () => {
    expect(resolveMarkdownFileLinkTarget("AGENTS.md", "/Users/julius/project")).toBe(
      "/Users/julius/project/AGENTS.md",
    );
  });

  it("maps #L line anchors to editor line suffixes", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/julius/project/src/main.ts#L42C7")).toBe(
      "/Users/julius/project/src/main.ts:42:7",
    );
  });

  it("ignores external urls", () => {
    expect(resolveMarkdownFileLinkTarget("https://example.com/docs")).toBeNull();
  });

  it("does not double-decode file URLs", () => {
    expect(resolveMarkdownFileLinkTarget("file:///Users/julius/project/file%2520name.md")).toBe(
      "/Users/julius/project/file%20name.md",
    );
  });

  it("formats tooltip display paths relative to the cwd when possible", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "file:///C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts#L501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toMatchObject({
      displayPath: "t3code/apps/web/src/session-logic.ts:501",
    });
  });

  it("formats tooltip display paths relative to the cwd for slash-prefixed windows paths", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toMatchObject({
      displayPath:
        "t3code/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
    });
  });

  it("normalizes slash-prefixed windows drive paths before resolving", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "/D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx:69");
  });

  it("resolves angle-bracketed windows drive paths", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "</D:/Programme/t3code/apps/web/src/components/ChatMarkdown.tsx:1>",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/ChatMarkdown.tsx:1");
  });

  it("does not treat app routes as file links", () => {
    expect(resolveMarkdownFileLinkTarget("/chat/settings")).toBeNull();
  });
});

describe("resolveInlineCodeFileLinkMeta", () => {
  const cwd = "/Users/hannesill/Developer/lincei";

  it("links relative, absolute, and Windows file paths", () => {
    expect(resolveInlineCodeFileLinkMeta("apps/web/src/main.ts:71", cwd)).toMatchObject({
      targetPath: `${cwd}/apps/web/src/main.ts:71`,
      basename: "main.ts",
      line: 71,
    });
    expect(resolveInlineCodeFileLinkMeta("/usr/local/bin/tool")).toMatchObject({
      targetPath: "/usr/local/bin/tool",
    });
    expect(
      resolveInlineCodeFileLinkMeta("C:\\Users\\researcher\\lincei\\src\\main.ts"),
    ).toMatchObject({
      basename: "main.ts",
    });
  });

  it("links explicit dot paths and conventional extensionless line references", () => {
    expect(resolveInlineCodeFileLinkMeta("./scripts/deploy", cwd)).toMatchObject({
      basename: "deploy",
    });
    expect(resolveInlineCodeFileLinkMeta("Makefile:12", cwd)).toMatchObject({
      targetPath: `${cwd}/Makefile:12`,
      line: 12,
    });
    expect(resolveInlineCodeFileLinkMeta("Makefile:12")).toBeNull();
  });

  it("rejects ambiguous name-position forms", () => {
    for (const candidate of ["error:1", "TODO:12", "exit:0", "port:3000", "http:80"]) {
      expect(resolveInlineCodeFileLinkMeta(candidate, cwd)).toBeNull();
    }
  });

  it("rejects hosts, ports, and version-shaped segments", () => {
    for (const candidate of [
      "127.0.0.1:3000",
      "localhost:3000",
      "example.com/index.html",
      "example.uk/index.html",
      "v1.2.3/changelog.md",
      "1.2.3/changelog.md",
    ]) {
      expect(resolveInlineCodeFileLinkMeta(candidate, cwd)).toBeNull();
    }
  });

  it("keeps legitimate file suffixes that resemble host labels", () => {
    expect(resolveInlineCodeFileLinkMeta("script.ts:10", cwd)).not.toBeNull();
    expect(resolveInlineCodeFileLinkMeta("src/setup.sh:3", cwd)).not.toBeNull();
    expect(resolveInlineCodeFileLinkMeta("Makefile.in:12", cwd)).not.toBeNull();
    expect(resolveInlineCodeFileLinkMeta("conf.d/nginx.conf", cwd)).not.toBeNull();
  });

  it("rejects commands, globs, refs, directories, and external URLs", () => {
    for (const candidate of [
      "git worktree list --porcelain",
      "node.meta",
      "bun install",
      "src/**/*.ts",
      "origin/main",
      "apps/web",
      "https://example.com/docs.html",
    ]) {
      expect(resolveInlineCodeFileLinkMeta(candidate, cwd)).toBeNull();
    }
  });

  it("requires cwd for relative paths", () => {
    expect(resolveInlineCodeFileLinkMeta("apps/web/src/main.ts")).toBeNull();
  });

  it("keeps POSIX workspace containment case-sensitive", () => {
    expect(
      resolveMarkdownFileLinkMeta("/Users/Foo/project/src/main.ts", "/users/foo/project"),
    ).toMatchObject({
      workspaceRelativePath: null,
    });
    expect(
      resolveMarkdownFileLinkMeta(
        "C:/Users/Researcher/Lincei/src/main.ts",
        "c:/users/researcher/lincei",
      ),
    ).toMatchObject({
      workspaceRelativePath: "src/main.ts",
    });
  });
});
