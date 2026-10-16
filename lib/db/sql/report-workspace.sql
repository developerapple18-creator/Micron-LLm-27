-- Historical additive workspace migration, retained for compatibility tests.
CREATE TABLE IF NOT EXISTS case_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id),
 request_id uuid NOT NULL, name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT folder_request_owner UNIQUE(owner_id,request_id), CONSTRAINT folder_identity_owner UNIQUE(id,owner_id)
);
CREATE TABLE IF NOT EXISTS case_organization (
 case_id uuid PRIMARY KEY, owner_id uuid NOT NULL, folder_id uuid,
 FOREIGN KEY(case_id,owner_id) REFERENCES cases(id,owner_id),
 FOREIGN KEY(folder_id,owner_id) REFERENCES case_folders(id,owner_id)
);
CREATE INDEX IF NOT EXISTS organization_owner_folder ON case_organization(owner_id,folder_id);
ALTER TABLE case_folders ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE case_organization ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS report_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id),
 case_id uuid NOT NULL REFERENCES cases(id), operation_id uuid NOT NULL REFERENCES case_analysis_operations(id),
 request_id uuid NOT NULL, request_hash text NOT NULL, version_number integer NOT NULL CHECK(version_number>0),
 parent_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('manual','ai_accepted','restore')), report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT report_version_number UNIQUE(operation_id,version_number),
 CONSTRAINT report_version_request UNIQUE(owner_id,operation_id,request_id)
);
CREATE TABLE IF NOT EXISTS report_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES accounts(id),
 case_id uuid NOT NULL REFERENCES cases(id), operation_id uuid NOT NULL REFERENCES case_analysis_operations(id),
 request_id uuid NOT NULL, request_hash text NOT NULL, version_id uuid NOT NULL, section_id text NOT NULL,
 block_index integer NOT NULL CHECK(block_index>=0), kind text NOT NULL CHECK(kind IN ('discuss','revise')),
 instruction text NOT NULL CHECK(length(trim(instruction)) BETWEEN 1 AND 4000),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','running','completed','failed','accepted','rejected')),
 answer text, proposed_text text, source_refs jsonb NOT NULL DEFAULT '[]'::jsonb, spending_reservation jsonb,
 run_token uuid, started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT report_interaction_request UNIQUE(owner_id,operation_id,request_id)
);
CREATE OR REPLACE FUNCTION preserve_report_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Saved report versions are append-only'; END;
$fn$;
DO $block$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='report_versions'::regclass AND tgname='report_versions_immutable') THEN
  CREATE TRIGGER report_versions_immutable BEFORE UPDATE OR DELETE ON report_versions
   FOR EACH ROW EXECUTE FUNCTION preserve_report_version();
 END IF;
END $block$;
