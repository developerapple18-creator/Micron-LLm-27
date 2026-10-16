# Guided clarification — browser QA

## Verdict

**PASS** — the guided-clarification flow completed in a fresh browser context against the existing fail-closed TEMP SQL fixture only. No product code was changed. The fixture was left running in `report` mode.

## Test boundary and safety

- Browser context: fresh `ctx3` / `page3`; fixture case `56dc8a93-6145-4008-94e5-8c46e818da23`, synthetic owner `00000000-0000-4000-8000-000000000111`.
- Every observed browser `/api` and `/__storage` request was routed to `127.0.0.1:19486`. Route audit: 91 requests, 0 paths outside `/api` and `/__storage`, 0 public/history requests.
- The browser XHR `Blob.arrayBuffer()` capture hook preserved the real selected File bytes. Each `test.pdf` upload was 893 bytes, `application/pdf`, SHA-256 `9b5f5c5a500819bc7edcab07873db587279ecf00d8ab23630a869bc6659dcbb2`.
- The fixture's fake provider transport is fail-closed: its `globalThis.fetch` rejects unmocked external hosts/endpoints. Fixture counters `files: 3` and `nativeReads: 5` are synthetic fake-provider/file and `responses/input_tokens` calls, not calls to a real provider. `analysisPosts: 4`; `discussionPosts: 0`; `discussionFiles: 0`.
- Storage contained only the two fixture PDF objects below. No live account, real provider, real storage, public/history state, or report-version mutation was used.

## Case 1 — text-only, one clarification

- Case `2ae71a8d-b0eb-44b0-8658-267953b6ab43`; initial prompt only, no attachment or storage upload.
- Parent operation `61ca6c1f-dc46-4abd-898a-9d14864da500` completed; result hash `d77ee19382b2911d05adb2643854dac0`. Its round-0 input snapshot remained the original single prompt with no clarifications.
- The sole question was `side` / `من تمثل؟`. Claimant/respondent, unknown, and custom were offered; not-applicable was not. Changing claimant to respondent/unknown and custom-answer validation were local UI state only; a blank custom answer blocked Send. The custom answer remained separate from the free-context textbox.
- Returning from Analysis and reloading preserved selected respondent and the unrelated context `سياق إضافي منفصل: أُبرم العقد في ١ أكتوبر.`; neither navigation nor reload added a message POST.
- A double-click on `متابعة التحليل` generated exactly one successor message. Request linked to the parent with `questionIds:["side"]`, `attachmentIds:[]`; respondent answer appeared once. Successor `7e97d12b-1ba0-4a36-b4f1-9aec8cc74dbd` completed with parent link intact and result hash `6b7a2e8a5485aa82b4526441a2ddac24`.
- The completed synthetic report exposed all eight sections. The old question became a compact archived card; the active guided panel disappeared, the saved-report placeholder returned, and both original actions (add evidence / updated analysis) returned without a native intent selector.

## Case 2 — PDF-backed, three clarifications, evidence-save, continuation

- Case `46a68b1e-324b-4342-90be-f66c03b05e4c`; initial prompt `حلّل المستند المرفق، واسألني عما يلزم عن الأطراف والدفع والتسليم.` with `test.pdf`.
- Initial attachment `66131b29-d08c-4cb1-804b-b36881bca510` completed through one fixture storage PUT and attachment-finalize POST. Parent operation `318c43b5-c5fc-4bda-a83e-425d529d7b42` completed; hash `a1af15abe8eb7d4b4d8301873adc2ade`.
- Three IDs and capability flags matched the fixture: `side` allows unknown but not not-applicable; `payment` allows both unknown and not-applicable; `delivery` allows neither. Final answers were side `لا أعلم`, payment `لا ينطبق`, and delivery custom `تم التسليم جزئيًا في 15 أكتوبر 2026`.
- Replacing claimant→respondent→unknown and payment yes→not-applicable kept one answer per question and made no message POST. The expanded review summary listed all three answers and its change buttons navigated to payment/delivery; a temporary payment change to `لا` updated the summary, then restoring `لا ينطبق` preserved the delivery custom answer. These edits/navigation also made no POST.
- Free context stayed in its own composer, separate from the answer values. With the pending clarification, the actions menu offered only `إضافة مستندات أو وقائع` (“save additions without changing the report”); updated-analysis and native intent were absent.
- Save-only evidence flow uploaded a second actual `test.pdf`, attachment `74bace96-b629-405c-b354-be0807cce5e0`, 893-byte `application/pdf`, through fixture PUT + finalize. Clicking `حفظ الإضافات` saved a separate context-plus-file message with `startAnalysis:false` and no clarification metadata. `analysisPosts` stayed at 3; all three selected answers remained available for continuation.
- The continuation used separate context `سياق إضافي منفصل: يرجى مراعاة الملف الثاني.`. Double-clicking Send generated exactly one new message POST with `startAnalysis:true`, no attachment IDs, parent `318c43b5-c5fc-4bda-a83e-425d529d7b42`, and exactly `questionIds:["side","payment","delivery"]`. Each final answer and the context occurred once.
- Successor `717a5d81-80d3-4c21-87a8-2228309be0dd` completed, parent link intact, result hash `4fdab84181f604c1ff0b6b73d7d22725`. The report showed exactly eight sections. The three-question result became a compact archived card, no active guided panel remained, the saved-report placeholder returned, and both original contextual actions were restored.

## Responsive checks on the live three-question composer

| Viewport | Measured document/body width | Result |
| --- | ---: | --- |
| 320×844 | 320 / 320 | No horizontal overflow; custom answer, free-context field, and enabled Send had visible in-viewport bounds. |
| 390×844 | 390 / 390 | No horizontal overflow; all three answers, review summary, separate context, and Send remained visible. |
| 390×640 | 390 / 390 | No horizontal overflow; panel was internally scrollable, while custom answer, context, and enabled Send remained in the viewport. The review was denser at this height but usable. |

## Final fixture fingerprints

All before/after public fingerprints matched:

| Table/state | Count or value | Hash |
| --- | ---: | --- |
| `cases` | 85 | `ad0936730596a076504bf008b689feeb` |
| `case_attachments` | 115 | `da6be63fc20706dfeab276af406ddbad` |
| `case_messages` | 101 | `fdf35e95bef6e59149d9602e29289ffc` |
| `case_analysis_operations` | 57 | `281067d677954f73e35543b6add2ccf1` |
| `case_organization` | 2 | `f23407b600b7d9ea19e4db5743c13989` |
| `report_versions` | 5 | `1a24765d444c4552d6f3606d17e9879e` |
| `report_interactions` | 9 | `4a42579fe1ab681e06638301236b3e6c` |
| `case_folders` | 10 | `1f868f870777fdd80c43c313b3e15969` |
| sequence | `last_value=101`, `is_called=true` | unchanged |

Fixture originals: `66131b29-d08c-4cb1-804b-b36881bca510` (generation 2, ready) and `74bace96-b629-405c-b354-be0807cce5e0` (generation 4, ready). Fixture `versions:[]`, `questions:[]`. Final mode set returned HTTP 200 with `{mode:"report"}`; fixture was not restarted.

## Screenshot evidence IDs

`i4wcsl` (text-only reload persistence), `95z07i` (text-only eight-section report), `uj1x6t` (three-question PDF case), `zls90c` (final answers plus separate context), `c4wgq6` (320×844), `wai8l3` (390×640), `x3h2bx` (pending evidence-only menu), `a43g7x` (saved evidence with answers retained), `s4flxq` (three-question eight-section report), and `lue3hh` (post-report actions restored).

Non-blocking environment noise: shared inactive browser pages logged Vite Fast Refresh invalidation and 404 resource messages; the tested `page3` flows completed, and no corresponding error appeared in the active case UI.

## Targeted follow-up — updated-analysis root, offline recovery, short viewports

- Reused the same `page3` and fixture on the completed PDF case; no new fixture or journey was started. Set fixture mode to `clarification-many`, explicitly selected `إصدار تحليل محدّث`, and submitted one synthetic root prompt. This added exactly one message POST (`newAnalysis:true`, `startAnalysis:true`) and one mock analysis post (message posts 5→6; analysis posts 4→5). No continuation was sent.
- The new root `9c5f7e80-aef8-45b2-8fb3-f8f38069d52a` completed with `parent_operation_id:null`. Its three-question clarification appeared beside the composer and was resumed. The previous report operation `717a5d81-80d3-4c21-87a8-2228309be0dd` remained completed with the same hash `4fdab84181f604c1ff0b6b73d7d22725`; fixture versions remained `[]`. The prior archived clarification and report card stayed visible alongside the current-root clarification.
- Set the unsent draft to side `لا أعلم`, payment `لا ينطبق`, delivery custom `إجابة محفوظة عند انقطاع الاتصال`, and separate context `سياق محفوظ عند العودة`. The review summary listed all three values. Send remained enabled but was never clicked.
- Offline toggle: `navigator.onLine:false`; the current delivery question, all answers, review, custom text, and context remained present. Route calls stayed at 97; message POSTs stayed at 6 and analysis posts at 5.
- Reconnect: `navigator.onLine:true`. The online refetch and explicit reload were read-only GETs (nine GETs before reload and nine during reload). After reload, the current question remained `ما حالة التسليم؟`; all three exact answers and the separate context were restored. Message POSTs remained 6 and analysis posts remained 5.
- At 390×500, document/body width stayed 390. The nested panel scroller was bounded (`overflow-y:auto`, client height 170, scroll height 418); scrolling exposed all three review rows while the composer remained visible. At 320×844, document/body width stayed 320 and the nested scroller remained bounded (`clientHeight:248`, `scrollHeight:466`). Custom/context/Send/Attach retained accessible names; the answer-option targets measured at least 44×44, and Send/Attach measured 44×44.
- Final audit: old report hash and empty versions list unchanged; public fingerprints still matched both before/after and the prior baseline. Fixture mode was restored to `report` with HTTP 200 and the fixture was left running.
- Test-harness note: one wait for the new operation's status label timed out because the UI had already moved to a clarification state; the visible new card plus fixture stats confirmed the root completed, and Resume opened the current root. No product failure resulted.

Follow-up screenshots: `kd8g01` (updated-analysis action), `mdwjxm` (new instruction while old report remains), `ep1uhy` (resumed current-root clarification beside old report), `qm2u0k` (unsent exact recovery draft), `8i2gdo` (offline), `u2j1t4` (reconnected), `562gbu` (online reload persistence), `n4feay` (390×500 scrolled review), and `eyl9b6` (320×844 review and composer).
