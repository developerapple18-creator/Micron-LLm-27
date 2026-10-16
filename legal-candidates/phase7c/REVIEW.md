# Phase 7C — Owner review of legal instruction candidates

**Not activated. No real model requests. No legal source verification.**

## Baselines and activation

All five supplied approved documents and their original manifest remain untouched.
The application still imports core 0.2, task prompt 0.1 and schema 0.1. Neither the
candidate instructions nor the candidate context builder are imported by routes.
Journey 1.0 and contract 0.1 remain specifications, not extra runtime prompts.
No schema change is necessary for the observed classification or repetition issues.

## Exact changes

Full versioned candidate documents are alongside this review; the companion
`exact-differences.diff` records every change against the approved documents.

| Candidate | Change and reason |
|---|---|
| Core 0.3 | Candidate status/version and footer; adds a unit-basis/efficient-presentation subsection before delivery review. Separate sourced statements from inference, consolidate general caveats while retaining locally material conditions. Other shared safety, evidence, confidentiality and procedural rules are retained. |
| Task prompt 0.2 | Candidate status/version; adds report-precision guidance before update instructions. Improve title grammar, distinguish basis per unit, reduce repeated recital, preserve strongest defense, conditional conclusions, admission-severability and validity-versus-proof distinctions. Other existing instructions are retained. |
| Input-only candidate | No prompt edit. Keep `lawyer_message` unchanged, add its explicit source binding, and omit the duplicate complete message from `source_registry`. Keep source ID, basis and message binding. Offline builder only. |

Core-only, prompt-only and input-only variants are evaluated separately.
There is no combined active request and no change to model, reasoning, tools,
output cap, deadline or output contract.

## What the offline checks establish

- Approved hashes unchanged; actual saved Phase 7A result unchanged on disk and
  in development storage, and still valid under the original contract.
- The Phase 7A report remains the review baseline, not an edited candidate output.
  Its known mixed-basis units are detected by a narrow review check.
- Independent manually authored fictional report, clarification and blocked
  fixtures exercise the original contract.
- Negative fixtures exercise missing sections, unknown sources, unsupported
  documentary classification, extra branches, fabricated reading/citation,
  inconsistent balance, omitted counterargument/conditions and exact repetition.
- Candidate input still contains the original lawyer message and a traceable
  source binding. Candidate requests keep the original response format/settings.

These checks are deliberately fixture-specific. They are NOT a legal reasoning
engine or a semantic certification of arbitrary Arabic output.

## Tradeoffs and unproven benefits

The core and prompt candidates are **longer inputs**, not proven input-token
optimizations. They aim to improve classification and reduce redundant output;
that benefit has not been measured with a real model. Input-only deduplication
reduces serialized bytes, not a measured token count or latency.

Risks: excessive brevity could remove material qualifications; splitting bases
could increase paragraph count; consolidated caveats could make an isolated
conclusion overconfident; source-text deduplication could affect the model's
ability to connect statements to references; admission-specific guidance might
overemphasize the baseline dispute. Human and actual model evaluation remain
necessary. No arbitrary paragraph/word ceiling is imposed.

The next proposed paid test is streaming-only with baseline instructions. It
does not authorize any of these candidates or prove their output quality.
