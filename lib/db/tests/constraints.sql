-- Run only in an isolated test database after all migrations. No retained test data.
BEGIN;
CREATE FUNCTION pg_temp.expect_failure(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE caught boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE; END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'Expected SQLSTATE % for %', expected_state, statement; END IF;
END;
$$;

INSERT INTO accounts (id, role, username, name, password_hash) VALUES
 ('00000000-0000-0000-0000-000000000001', 'lawyer', 'sql-test-one', 'Test one', 'test-only'),
 ('00000000-0000-0000-0000-000000000002', 'lawyer', 'sql-test-two', 'Test two', 'test-only');
INSERT INTO cases (id, owner_id, request_id) VALUES
 ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', gen_random_uuid()),
 ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', gen_random_uuid());
INSERT INTO case_messages (id, case_id, owner_id, request_id, content) VALUES
 ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SQL test'),
 ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SQL test');

SELECT pg_temp.expect_failure($test$
 INSERT INTO case_analysis_operations (owner_id, case_id, message_id, source_registry)
 VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '{}')
$test$, '23503');
SELECT pg_temp.expect_failure($test$
 INSERT INTO case_analysis_operations (owner_id, case_id, message_id, status, source_registry)
 VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', 'completed', '{}')
$test$, '23514');
INSERT INTO case_analysis_operations (id, owner_id, case_id, message_id, source_registry)
 VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '{}');
SELECT pg_temp.expect_failure($test$
 INSERT INTO case_analysis_operations (owner_id, case_id, message_id, source_registry)
 VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000022', '{}')
$test$, '23505');
SELECT pg_temp.expect_failure($test$
 INSERT INTO case_fee_agreements (case_id, owner_id, agreed_amount)
 VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', -1)
$test$, '23514');
SELECT pg_temp.expect_failure($test$
 INSERT INTO case_fee_agreements (case_id, owner_id, agreed_amount)
 VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', 100)
$test$, '23503');

INSERT INTO report_versions (id, owner_id, case_id, operation_id, request_id, request_hash, version_number, parent_id, kind, report)
 VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', gen_random_uuid(), 'test', 1, gen_random_uuid(), 'manual', '{}');
SELECT pg_temp.expect_failure($test$
 UPDATE report_versions SET report = '{"modified":true}' WHERE id = '00000000-0000-0000-0000-000000000041'
$test$, 'P0001');
SELECT pg_temp.expect_failure($test$
 DELETE FROM report_versions WHERE id = '00000000-0000-0000-0000-000000000041'
$test$, 'P0001');

INSERT INTO audit_events (id, action, ip, user_agent)
 VALUES ('00000000-0000-0000-0000-000000000051', 'sql-test', '127.0.0.1', 'test');
SELECT pg_temp.expect_failure($test$
 UPDATE audit_events SET action = 'modified' WHERE id = '00000000-0000-0000-0000-000000000051'
$test$, 'P0001');
INSERT INTO legal_documents (id, kind, title, content, version, content_hash, published)
 VALUES ('00000000-0000-0000-0000-000000000061', 'sql-test', 'Test', 'Test', 1, 'test', true);
INSERT INTO legal_acceptances (id, user_id, mobile, document_id, document_title, document_version, content_hash, action, audit_id, ip, user_agent)
 VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', 'test', '00000000-0000-0000-0000-000000000061', 'Test', 1, 'test', 'accept', '00000000-0000-0000-0000-000000000051', '127.0.0.1', 'test');
SELECT pg_temp.expect_failure($test$
 DELETE FROM legal_acceptances WHERE id = '00000000-0000-0000-0000-000000000071'
$test$, 'P0001');
SELECT pg_temp.expect_failure($test$
 UPDATE legal_documents SET content = 'modified' WHERE id = '00000000-0000-0000-0000-000000000061'
$test$, 'P0001');
SELECT pg_temp.expect_failure($test$
 INSERT INTO case_folders (owner_id, request_id, name) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), '')
$test$, '23514');
ROLLBACK;
