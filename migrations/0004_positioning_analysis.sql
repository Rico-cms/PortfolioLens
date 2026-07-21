ALTER TABLE audit_observations ADD COLUMN declared_role TEXT;
ALTER TABLE audit_observations ADD COLUMN demonstrated_role TEXT;
ALTER TABLE audit_observations ADD COLUMN primary_sector TEXT;
ALTER TABLE audit_observations ADD COLUMN secondary_sectors TEXT;
ALTER TABLE audit_observations ADD COLUMN alignment_score INTEGER;
ALTER TABLE audit_observations ADD COLUMN positioning_confidence INTEGER;
ALTER TABLE audit_observations ADD COLUMN positioning_expertise TEXT;
ALTER TABLE audit_observations ADD COLUMN positioning_source TEXT;
ALTER TABLE audit_observations ADD COLUMN positioning_evidence_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_observations_primary_sector
  ON audit_observations(primary_sector, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_observations_demonstrated_role
  ON audit_observations(demonstrated_role, created_at DESC);
