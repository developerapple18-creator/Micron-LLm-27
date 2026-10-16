import Ajv from 'ajv';
import approvedFormat from '../../../../lib/legal-contracts/case-analysis.schema.json';
export const sectionOrder = [
  'summary',
  'facts',
  'characterization',
  'evidence',
  'position',
  'legal_basis',
  'risks',
  'conclusions',
];
const schemaValidate = new Ajv({ strict: true, allErrors: true }).compile(approvedFormat.schema);
/** Initial, text-only contract: no documentary, legal-source or attachment inputs. */
export function analysisContractErrors(value, sourceIds, documentIds = []) {
  if (!schemaValidate(value)) return ['schema_invalid'];
  const v = value;
  const errors = [];
  const nonempty = (s) => s.trim().length > 0;
  const require = (condition, name) => {
    if (!condition) errors.push(name);
  };
  for (const kind of ['clarification', 'report', 'blocked']) {
    require(kind === v.kind ? v[kind] !== null : v[kind] === null, `branch_${kind}`);
  }
  if (errors.length) return errors;
  if (v.kind === 'report' && v.report) {
    const r = v.report;
    require(nonempty(r.title), 'report_title');
    require(JSON.stringify(r.sections.map((s) => s.section_id)) ===
      JSON.stringify(sectionOrder), 'eight_ordered_sections');
    require(r.change_summary === null, 'initial_change_summary');
    for (const s of r.sections) {
      require(s.blocks.length > 0, 'empty_section');
      for (const b of s.blocks) {
        require(nonempty(b.text), 'empty_block');
        require(b.source_refs.every((id) => sourceIds.includes(id)), 'unknown_source');
        require(b.basis !== 'legal_source' &&
          (b.basis !== 'documented' ||
            b.source_refs.some((id) => documentIds.includes(id))), 'unsupported_source_basis');
      }
    }
    for (const a of r.alerts) {
      require((a.attachment_id === null || documentIds.includes(a.attachment_id)) &&
        nonempty(a.message), 'invalid_alert');
    }
  } else if (v.kind === 'clarification' && v.clarification) {
    const c = v.clarification;
    require(nonempty(c.context), 'clarification_context');
    require(c.questions.length >= 1 && c.questions.length <= 3, 'question_count');
    require(new Set(c.questions.map((q) => q.id)).size ===
      c.questions.length, 'question_duplicate');
    for (const q of c.questions)
      require(nonempty(q.id) &&
        nonempty(q.question) &&
        q.options.every(nonempty), 'empty_question');
  } else if (v.kind === 'blocked' && v.blocked) {
    require(nonempty(v.blocked.message) &&
      v.blocked.needed.length > 0 &&
      v.blocked.needed.every(nonempty), 'blocked_content');
  }
  return errors;
}
