import { describe, expect, it } from "vitest";
import { scoreSignals } from "./scoring";
import type { PageSignals } from "./types";

const strongSignals: PageSignals = {
  url: "https://example.com", statusCode: 200, loadTimeMs: 600, title: "Ada — développeuse full-stack à Abidjan",
  description: "Je transforme des problèmes métier complexes en produits web rapides, accessibles et mesurables pour des équipes ambitieuses.",
  lang: "fr", h1: ["Des produits utiles, construits avec soin"], h2Count: 4, textLength: 2400,
  imageCount: 5, missingAltCount: 0, linkCount: 14, projectLinkCount: 5, hasViewport: true,
  hasMain: true, hasNav: true, hasContact: true, hasSkills: true, hasProjects: true, hasGithub: true,
  hasLinkedin: true, hasCsp: true, hasFrameProtection: true, hasReferrerPolicy: true, usesHttps: true,
};

describe("scoreSignals", () => {
  it("rewards a complete and verifiable portfolio", () => {
    const result = scoreSignals(strongSignals);
    expect(result.overallScore).toBeGreaterThanOrEqual(90);
    expect(result.scores.accessibility).toBe(100);
  });

  it("surfaces critical gaps", () => {
    const result = scoreSignals({ ...strongSignals, hasContact: false, hasProjects: false, usesHttps: false, missingAltCount: 5 });
    expect(result.overallScore).toBeLessThan(80);
    expect(result.findings.some((finding) => finding.severity === "high")).toBe(true);
  });
});
