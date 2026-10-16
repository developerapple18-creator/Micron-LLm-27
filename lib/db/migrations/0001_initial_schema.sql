-- Copyright (c) 2026 خالد. All rights reserved for original project code.
-- PostgreSQL schema. Apply with the migration runner; no destructive reset.

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  username text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  password_reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_analysis_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  case_id uuid NOT NULL,
  message_id uuid NOT NULL,
  parent_operation_id uuid,
  input_snapshot jsonb,
  spending_reservation jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  source_registry jsonb NOT NULL,
  failure_code text,
  run_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT analysis_state CHECK (status in ('pending','running','completed','failed')),
  CONSTRAINT analysis_state_payload CHECK ((status='pending' AND result IS NULL AND failure_code IS NULL AND run_token IS NULL AND lease_expires_at IS NULL AND started_at IS NULL AND finished_at IS NULL) OR
    (status='running' AND result IS NULL AND failure_code IS NULL AND run_token IS NOT NULL AND lease_expires_at IS NOT NULL AND started_at IS NOT NULL AND finished_at IS NULL) OR
    (status='completed' AND result IS NOT NULL AND failure_code IS NULL AND run_token IS NULL AND lease_expires_at IS NULL AND started_at IS NOT NULL AND finished_at IS NOT NULL) OR
    (status='failed' AND result IS NULL AND failure_code IS NOT NULL AND run_token IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL))
);

CREATE TABLE case_attachments (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  message_id uuid,
  request_id uuid NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  staging_path text NOT NULL,
  storage_path text NOT NULL,
  generation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE TABLE case_fee_agreements (
  case_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  agreed_amount numeric(14,2),
  terms text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_agreement_nonnegative CHECK (agreed_amount >= 0)
);

CREATE TABLE case_fee_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  received_on date NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_receipt_nonnegative CHECK (amount >= 0)
);

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'قضية جديدة',
  task_type text NOT NULL DEFAULT 'analysis',
  archived_at timestamptz,
  client_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lawyer_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  name text NOT NULL,
  type text,
  mobile text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL,
  published boolean NOT NULL DEFAULT false,
  testing boolean NOT NULL DEFAULT false,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mobile text NOT NULL,
  document_id uuid NOT NULL,
  document_title text NOT NULL,
  document_version integer NOT NULL,
  content_hash text NOT NULL,
  action text NOT NULL,
  audit_id uuid NOT NULL,
  ip text NOT NULL,
  user_agent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  sequence bigserial NOT NULL,
  content text NOT NULL,
  clarification jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  name text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_organization (
  case_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  folder_id uuid,
  pinned boolean NOT NULL DEFAULT false
);

CREATE TABLE report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  case_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  version_number integer NOT NULL,
  parent_id uuid NOT NULL,
  kind text NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_version_kind CHECK (kind in ('manual','ai_accepted','restore')),
  CONSTRAINT report_version_positive CHECK (version_number>0)
);

CREATE TABLE report_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  case_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  version_id uuid NOT NULL,
  section_id text NOT NULL,
  block_index integer NOT NULL,
  kind text NOT NULL,
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'prepared',
  answer text,
  proposed_text text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  spending_reservation jsonb,
  run_token uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_interaction_kind CHECK (kind in ('discuss','revise')),
  CONSTRAINT report_interaction_status CHECK (status in ('prepared','running','completed','failed','accepted','rejected'))
);

CREATE TABLE sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE TABLE verification_challenges (
  session_id text PRIMARY KEY,
  mobile text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  challenge_id uuid,
  purpose text NOT NULL DEFAULT 'registration',
  code_mode text NOT NULL DEFAULT 'legacy',
  code_digest text,
  account_id uuid,
  password_tag text,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attempt_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 1,
  resets_at timestamptz NOT NULL
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  ip text NOT NULL,
  user_agent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create supporting unique indexes before composite foreign keys.
CREATE UNIQUE INDEX account_role_username ON accounts (role, username);
CREATE UNIQUE INDEX analysis_originating_message ON case_analysis_operations (message_id);
CREATE UNIQUE INDEX analysis_one_child ON case_analysis_operations (parent_operation_id) WHERE failure_code IS DISTINCT FROM 'context_changed';
CREATE UNIQUE INDEX analysis_identity_case_owner ON case_analysis_operations (id, case_id, owner_id);
CREATE UNIQUE INDEX analysis_one_active_per_case ON case_analysis_operations (case_id) WHERE status in ('pending','running');
CREATE INDEX analysis_owner_case ON case_analysis_operations (owner_id, case_id);
CREATE UNIQUE INDEX attachment_submission_request ON case_attachments (case_id, request_id);
CREATE UNIQUE INDEX attachment_storage_reference ON case_attachments (storage_path);
CREATE INDEX attachments_case_message ON case_attachments (case_id, message_id);
CREATE UNIQUE INDEX fee_receipt_request ON case_fee_receipts (owner_id, case_id, request_id);
CREATE UNIQUE INDEX case_creation_request ON cases (owner_id, request_id);
CREATE UNIQUE INDEX case_identity_owner ON cases (id, owner_id);
CREATE INDEX cases_owner_updated ON cases (owner_id, updated_at);
CREATE UNIQUE INDEX lawyer_clients_identity_owner ON lawyer_clients (id, owner_id);
CREATE UNIQUE INDEX lawyer_clients_request_owner ON lawyer_clients (owner_id, request_id);
CREATE UNIQUE INDEX legal_kind_version ON legal_documents (kind, version);
CREATE UNIQUE INDEX message_submission_request ON case_messages (case_id, request_id);
CREATE UNIQUE INDEX message_identity_case_owner ON case_messages (id, case_id, owner_id);
CREATE UNIQUE INDEX folder_request_owner ON case_folders (owner_id, request_id);
CREATE UNIQUE INDEX folder_identity_owner ON case_folders (id, owner_id);
CREATE INDEX organization_owner_folder ON case_organization (owner_id, folder_id);
CREATE UNIQUE INDEX report_version_number ON report_versions (operation_id, version_number);
CREATE UNIQUE INDEX report_version_request ON report_versions (owner_id, operation_id, request_id);
CREATE UNIQUE INDEX report_interaction_request ON report_interactions (owner_id, operation_id, request_id);

ALTER TABLE case_analysis_operations ADD CONSTRAINT analysis_owned_case FOREIGN KEY (case_id, owner_id) REFERENCES cases (id, owner_id);
ALTER TABLE case_analysis_operations ADD CONSTRAINT analysis_owned_message FOREIGN KEY (message_id, case_id, owner_id) REFERENCES case_messages (id, case_id, owner_id);
ALTER TABLE case_analysis_operations ADD CONSTRAINT analysis_owned_parent FOREIGN KEY (parent_operation_id, case_id, owner_id) REFERENCES case_analysis_operations (id, case_id, owner_id);
ALTER TABLE case_attachments ADD FOREIGN KEY (case_id) REFERENCES cases (id);
ALTER TABLE case_attachments ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE case_attachments ADD FOREIGN KEY (message_id) REFERENCES case_messages (id);
ALTER TABLE case_fee_agreements ADD FOREIGN KEY (case_id, owner_id) REFERENCES cases (id, owner_id);
ALTER TABLE case_fee_receipts ADD FOREIGN KEY (case_id, owner_id) REFERENCES cases (id, owner_id);
ALTER TABLE cases ADD FOREIGN KEY (client_id, owner_id) REFERENCES lawyer_clients (id, owner_id);
ALTER TABLE cases ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE lawyer_clients ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE legal_acceptances ADD FOREIGN KEY (user_id) REFERENCES accounts (id);
ALTER TABLE legal_acceptances ADD FOREIGN KEY (document_id) REFERENCES legal_documents (id);
ALTER TABLE legal_acceptances ADD FOREIGN KEY (audit_id) REFERENCES audit_events (id);
ALTER TABLE case_messages ADD FOREIGN KEY (case_id) REFERENCES cases (id);
ALTER TABLE case_messages ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE case_folders ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE case_organization ADD FOREIGN KEY (case_id, owner_id) REFERENCES cases (id, owner_id);
ALTER TABLE case_organization ADD FOREIGN KEY (folder_id, owner_id) REFERENCES case_folders (id, owner_id);
ALTER TABLE report_versions ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE report_versions ADD FOREIGN KEY (case_id) REFERENCES cases (id);
ALTER TABLE report_versions ADD FOREIGN KEY (operation_id) REFERENCES case_analysis_operations (id);
ALTER TABLE report_interactions ADD FOREIGN KEY (owner_id) REFERENCES accounts (id);
ALTER TABLE report_interactions ADD FOREIGN KEY (case_id) REFERENCES cases (id);
ALTER TABLE report_interactions ADD FOREIGN KEY (operation_id) REFERENCES case_analysis_operations (id);
