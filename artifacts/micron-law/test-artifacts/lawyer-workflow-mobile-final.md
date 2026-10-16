# Lawyer workflow mobile verification (synthetic fixture)

Run: mobile viewport 390x844, production frontend at `http://localhost`, fixture at `127.0.0.1:19486`. All frontend `/api` and `/__storage` requests were intercepted and sent only to the synthetic fixture. No real users, external providers, public database writes, or application-code changes were used. Large source PDFs/DOCX remain under `/tmp/fixture-large-doc` and are not part of this artifact.

## Binary upload forwarding used

The page init hook wrapped `XMLHttpRequest.open/send`; for Blob/File bodies it awaited `body.arrayBuffer()`, stored the resulting byte array on `window.__fixtureUploadBytes` keyed by URL, and then invoked the original `send` with the original Blob. The `/__storage` PUT route required captured non-empty bytes and forwarded `Buffer.from(captured.bytes)` to the fixture, retaining the browser `Content-Type` and removing `host`/`content-length`. Observed actual payloads: PDF 893 bytes (`application/pdf`); DOCX 9563 bytes (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).

## Verified

- Normal PDF+DOCX upload reached READY; the in-flight status blocker was visible with send disabled. DOCX UI states Word text is supported while embedded images/stamps are not guaranteed readable. The saved eight-section synthetic report citation names both `PDF: test.pdf` and `DOCX: test.docx`.
- Saved-report question `هل فحصت تقرير الخبير؟` returned the synthetic missing-expert-report answer and invoice-page coverage caveat. One question was bound to original operation/version `186f382a-3b64-47c0-9d8b-a540a78f154b`.
- Reload and drawer navigation back to the primary case preserved the Q/A and produced no POST. The original UI POST body was not captured at send time; the saved request ID/body fields were reconstructed from application send code and fixture state. Two concurrent identical fixture replays returned the same message ID/request ID; no second question/generation resulted.
- Evidence-only update saved an additional 893-byte PDF and facts with `startAnalysis:false,newAnalysis:false`; it did not start analysis. Explicitly selecting new analysis then created a second, distinct completed operation. The original result hash remained `53e1bd2f6c04f333d47e36d160f13a5a`; original PDF/DOCX IDs `0a18b0ea-c966-462c-b078-0d70bbe4b0eb` (generation 3) and `3bb7930e-7d0b-4b61-a8bb-3b348cd468e6` (generation 4) remained READY. The composer reset to report-question mode after the explicit analysis send.
- The answer CTA switched to evidence-only mode with an actionable note.
- Lost-finalize test forwarded completion to the fixture (HTTP 200, status READY), then aborted the browser acknowledgment. Exactly one PUT was recorded for that attachment; UI settled without a blocker or red alert.
- A tiny synthetic unsupported PNG showed an explicit rejection and remove recovery control; removing it cleared the blocker/alert.
- Fresh clarification case `038b8013-4bda-47b4-b70f-c60cb7229b87` used a real PDF and native background clarification. Selecting `المدعى عليه`, switching fixture mode to report, and sending the answer produced a child report operation linked to parent `5f3f3bde-de51-4946-9f0c-c587092d6d4e`; its request explicitly linked only `questionIds:["side"]` and sent no attachment IDs, reusing the saved PDF.

## Final fixture snapshot and gaps

Final fixture counts: files 7, analysis posts 4, discussion posts 1, discussion files 0, native reads 11; report-version mutation list empty. Primary operations: original `186f382a-3b64-47c0-9d8b-a540a78f154b` hash `53e1bd2f6c04f333d47e36d160f13a5a`, new analysis `9eacce66-cdd6-4bae-b1b6-47990d27f4ec` hash `4db9eaf15bb039774108e75df0f61e37`.

Fixture public before/after fingerprints matched, including sequence (`last_value=91`, `is_called=true`); initial public baseline also matched final public state. The lost-finalize follow-up case GET occurred, and the UI cleared ambiguity, but the captured response body was truncated before the attachment ID, so the GET's exact READY payload was not independently confirmed. The report citation included both source files rather than DOCX alone. No browser automation script file was saved; this run note records the harness and evidence.
