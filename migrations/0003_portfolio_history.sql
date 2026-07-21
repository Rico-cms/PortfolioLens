ALTER TABLE audit_observations ADD COLUMN hostname TEXT;
ALTER TABLE audit_observations ADD COLUMN portfolio_url TEXT;
ALTER TABLE audit_observations ADD COLUMN status_code INTEGER;
ALTER TABLE audit_observations ADD COLUMN title TEXT;
ALTER TABLE audit_observations ADD COLUMN description_length INTEGER;
ALTER TABLE audit_observations ADD COLUMN text_length INTEGER;
ALTER TABLE audit_observations ADD COLUMN h1_count INTEGER;
ALTER TABLE audit_observations ADD COLUMN h2_count INTEGER;
ALTER TABLE audit_observations ADD COLUMN has_viewport INTEGER;
ALTER TABLE audit_observations ADD COLUMN has_main INTEGER;
ALTER TABLE audit_observations ADD COLUMN has_nav INTEGER;
ALTER TABLE audit_observations ADD COLUMN has_skills INTEGER;
ALTER TABLE audit_observations ADD COLUMN link_count INTEGER;

UPDATE audit_observations
SET
  hostname = (SELECT audits.hostname FROM audits WHERE audits.id = audit_observations.audit_id),
  portfolio_url = (SELECT audits.url FROM audits WHERE audits.id = audit_observations.audit_id),
  status_code = (SELECT CAST(json_extract(audits.result_json, '$.signals.statusCode') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  title = (SELECT json_extract(audits.result_json, '$.signals.title') FROM audits WHERE audits.id = audit_observations.audit_id),
  description_length = (SELECT length(COALESCE(json_extract(audits.result_json, '$.signals.description'), '')) FROM audits WHERE audits.id = audit_observations.audit_id),
  text_length = (SELECT CAST(json_extract(audits.result_json, '$.signals.textLength') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  h1_count = (SELECT json_array_length(json_extract(audits.result_json, '$.signals.h1')) FROM audits WHERE audits.id = audit_observations.audit_id),
  h2_count = (SELECT CAST(json_extract(audits.result_json, '$.signals.h2Count') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  has_viewport = (SELECT CAST(json_extract(audits.result_json, '$.signals.hasViewport') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  has_main = (SELECT CAST(json_extract(audits.result_json, '$.signals.hasMain') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  has_nav = (SELECT CAST(json_extract(audits.result_json, '$.signals.hasNav') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  has_skills = (SELECT CAST(json_extract(audits.result_json, '$.signals.hasSkills') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id),
  link_count = (SELECT CAST(json_extract(audits.result_json, '$.signals.linkCount') AS INTEGER) FROM audits WHERE audits.id = audit_observations.audit_id)
WHERE EXISTS (SELECT 1 FROM audits WHERE audits.id = audit_observations.audit_id);

CREATE INDEX IF NOT EXISTS idx_audit_observations_hostname_created
  ON audit_observations(hostname, created_at DESC);
