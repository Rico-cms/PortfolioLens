CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('page_view', 'audit_started', 'audit_completed', 'consent_granted')),
  path TEXT NOT NULL,
  referrer_host TEXT,
  country_code TEXT,
  device_type TEXT NOT NULL,
  locale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events(visitor_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_observations (
  audit_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  overall_score INTEGER NOT NULL,
  recruiter_score INTEGER NOT NULL,
  technical_score INTEGER NOT NULL,
  accessibility_score INTEGER NOT NULL,
  projects_score INTEGER NOT NULL,
  security_score INTEGER NOT NULL,
  has_contact INTEGER NOT NULL,
  has_github INTEGER NOT NULL,
  has_linkedin INTEGER NOT NULL,
  has_projects INTEGER NOT NULL,
  project_link_count INTEGER NOT NULL,
  has_csp INTEGER NOT NULL,
  has_frame_protection INTEGER NOT NULL,
  has_referrer_policy INTEGER NOT NULL,
  has_lang INTEGER NOT NULL,
  missing_alt_count INTEGER NOT NULL,
  image_count INTEGER NOT NULL,
  load_time_ms INTEGER NOT NULL,
  uses_https INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_observations_created_at ON audit_observations(created_at DESC);

INSERT OR IGNORE INTO audit_observations (
  audit_id, created_at, overall_score, recruiter_score, technical_score,
  accessibility_score, projects_score, security_score, has_contact,
  has_github, has_linkedin, has_projects, project_link_count, has_csp,
  has_frame_protection, has_referrer_policy, has_lang, missing_alt_count,
  image_count, load_time_ms, uses_https
)
SELECT
  id,
  created_at,
  overall_score,
  COALESCE(CAST(json_extract(result_json, '$.scores.recruiter') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.scores.technical') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.scores.accessibility') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.scores.projects') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.scores.security') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasContact') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasGithub') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasLinkedin') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasProjects') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.projectLinkCount') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasCsp') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasFrameProtection') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.hasReferrerPolicy') AS INTEGER), 0),
  CASE WHEN COALESCE(json_extract(result_json, '$.signals.lang'), '') <> '' THEN 1 ELSE 0 END,
  COALESCE(CAST(json_extract(result_json, '$.signals.missingAltCount') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.imageCount') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.loadTimeMs') AS INTEGER), 0),
  COALESCE(CAST(json_extract(result_json, '$.signals.usesHttps') AS INTEGER), 0)
FROM audits;
