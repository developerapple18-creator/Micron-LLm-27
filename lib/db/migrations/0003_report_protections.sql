-- Preserve constraints from the historical report-workspace SQL migration.
ALTER TABLE case_folders ADD CONSTRAINT folder_name_length
  CHECK (length(trim(name)) BETWEEN 1 AND 100);
ALTER TABLE report_interactions ADD CONSTRAINT interaction_block_nonnegative
  CHECK (block_index >= 0);
ALTER TABLE report_interactions ADD CONSTRAINT interaction_instruction_length
  CHECK (length(trim(instruction)) BETWEEN 1 AND 4000);

CREATE OR REPLACE FUNCTION preserve_report_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Saved report versions are append-only'; END;
$fn$;
CREATE TRIGGER report_versions_immutable BEFORE UPDATE OR DELETE ON report_versions
  FOR EACH ROW EXECUTE FUNCTION preserve_report_version();
