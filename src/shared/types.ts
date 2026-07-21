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

export type AnalyticsEventName = "page_view" | "audit_started" | "audit_completed" | "consent_granted";

export interface AnalyticsEventPayload {
  event: AnalyticsEventName;
  visitorId: string;
  sessionId: string;
  path: string;
  referrerHost?: string;
  locale?: string;
}

export interface AdminDashboardData {
  generatedAt: string;
  periodDays: number;
  totals: {
    pageViews: number;
    uniqueVisitors: number;
    sessions: number;
    audits: number;
    conversionRate: number;
    averageScore: number;
  };
  scoreAverages: Record<ScoreKey, number>;
  trend: Array<{ day: string; pageViews: number; audits: number }>;
  commonIssues: Array<{ key: string; label: string; count: number; percentage: number }>;
  devices: Array<{ label: string; count: number; percentage: number }>;
  countries: Array<{ label: string; count: number; percentage: number }>;
  recentAudits: Array<{
    id: string;
    hostname: string;
    url: string;
    overallScore: number;
    previousScore: number | null;
    scoreDelta: number | null;
    analysisCount: number;
    reportAvailable: boolean;
    createdAt: string;
  }>;
}
