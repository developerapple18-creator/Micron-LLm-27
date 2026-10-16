-- Apply to development after schema creation. No startup or production DDL.
CREATE OR REPLACE FUNCTION protect_published_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published THEN
    RAISE EXCEPTION 'Published legal documents are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS published_document_immutable ON legal_documents;
CREATE TRIGGER published_document_immutable BEFORE UPDATE OR DELETE ON legal_documents
FOR EACH ROW EXECUTE FUNCTION protect_published_document();

CREATE OR REPLACE FUNCTION protect_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit and acceptance evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS acceptance_immutable ON legal_acceptances;
CREATE TRIGGER acceptance_immutable BEFORE UPDATE OR DELETE ON legal_acceptances
FOR EACH ROW EXECUTE FUNCTION protect_evidence();
DROP TRIGGER IF EXISTS audit_immutable ON audit_events;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION protect_evidence();
