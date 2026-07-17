export type ScoreKey = "recruiter" | "technical" | "accessibility" | "projects" | "security";

export interface PageSignals {
  url: string;
  statusCode: number;
  loadTimeMs: number;
  title: string;
  description: string;
  lang: string;
  h1: string[];
  h2Count: number;
  textLength: number;
  imageCount: number;
  missingAltCount: number;
  linkCount: number;
  projectLinkCount: number;
  hasViewport: boolean;
  hasMain: boolean;
  hasNav: boolean;
  hasContact: boolean;
  hasSkills: boolean;
  hasProjects: boolean;
  hasGithub: boolean;
  hasLinkedin: boolean;
  hasCsp: boolean;
  hasFrameProtection: boolean;
  hasReferrerPolicy: boolean;
  usesHttps: boolean;
}

export interface Finding {
  category: ScoreKey;
  severity: "high" | "medium" | "low" | "positive";
  title: string;
  detail: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  impact: "Fort" | "Moyen" | "Faible";
}

export interface AuditResult {
  id: string;
  url: string;
  hostname: string;
  createdAt: string;
  overallScore: number;
  scores: Record<ScoreKey, number>;
  summary: string;
  verdict: string;
  findings: Finding[];
  recommendations: Recommendation[];
  signals: PageSignals;
  screenshotUrl?: string;
  aiEnhanced: boolean;
}

export interface CreateAuditResponse {
  audit: AuditResult;
  mode: "browser" | "fallback";
}
