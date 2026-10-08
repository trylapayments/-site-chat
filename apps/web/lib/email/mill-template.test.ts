import { expect, it } from "vitest";
import { millEmailHtml } from "./mill-template";
it("escapes visitor content and links, uses Mill assets and footer", () => {
  const html = millEmailHtml({
    title: '<script>alert("x")</script>',
    paragraphs: ["<img src=x onerror=bad>"],
    preformatted: "Visitor: <unsafe>",
    button: { label: "Open", href: "https://app.mill.chat/app/test?x=1&y=2" },
  });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<unsafe>");
  expect(html).toContain("&lt;unsafe&gt;");
  expect(html).toContain("/brand/mill-logo.png");
  expect(html).toContain("Mill Standard, Inc.");
  expect(html).toContain("x=1&amp;y=2");
});
it("does not emit unsafe links", () => {
  expect(
    millEmailHtml({
      title: "Hello",
      paragraphs: [],
      button: { label: "Open", href: "javascript:bad()" },
    }),
  ).not.toContain("javascript:");
});
