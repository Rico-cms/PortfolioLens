import { describe, expect, it } from "vitest";
import { analyzePositioningFallback } from "./positioning";
import type { PageSignals } from "./types";

const baseSignals: PageSignals = {
  url: "https://example.dev", statusCode: 200, loadTimeMs: 500, title: "Ada — développeuse full-stack",
  description: "Je construis des produits web pour les équipes métier.", lang: "fr", h1: ["Développeuse full-stack"],
  h2Count: 4, textLength: 2500, imageCount: 2, missingAltCount: 0, linkCount: 12, projectLinkCount: 3,
  hasViewport: true, hasMain: true, hasNav: true, hasContact: true, hasSkills: true, hasProjects: true,
  hasGithub: true, hasLinkedin: true, hasCsp: true, hasFrameProtection: true, hasReferrerPolicy: true, usesHttps: true,
};

describe("analyzePositioningFallback", () => {
  it("compares the declared role with demonstrated SaaS frontend evidence", () => {
    const result = analyzePositioningFallback({
      ...baseSignals,
      headings: ["CRM SaaS", "Dashboard analytique"],
      contentSample: "Application SaaS B2B. Dashboard React et TypeScript pour une équipe commerciale. CRM avec gestion des abonnements.",
      projectSamples: ["Conception d’un dashboard React pour un CRM SaaS B2B utilisé par une équipe commerciale."],
    });
    expect(result.declaredRole).toBe("Développeur full-stack");
    expect(result.demonstratedRole).toBe("Développeur frontend");
    expect(result.primarySector).toBe("SaaS B2B");
    expect(result.expertise).toContain("React");
    expect(result.confidence).toBeGreaterThan(60);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("stays cautious when the portfolio has no sector evidence", () => {
    const result = analyzePositioningFallback({ ...baseSignals, title: "Portfolio personnel", description: "Bienvenue sur mon site.", h1: ["Mes créations"], contentSample: "Bienvenue. À propos. Contact." });
    expect(result.primarySector).toBe("Secteur non déterminé");
    expect(result.confidence).toBeLessThan(50);
  });
});
