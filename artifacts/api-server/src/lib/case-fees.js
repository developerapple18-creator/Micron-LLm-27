import { pool } from '@workspace/db';
import {
  SaveCaseFeeAgreementBody,
  CreateCaseFeeReceiptBody,
  UpdateCaseFeeReceiptBody,
} from '@workspace/api-zod';
import { ownedCase, validated } from './case-access.js';
import { HttpError } from './security.js';
// Money remains PostgreSQL NUMERIC and decimal strings throughout. No floating-point balance arithmetic.
async function feeView(c, owner, id) {
  const { rows: agreements } = await c.query(
    `SELECT a.*,
    COALESCE((SELECT SUM(amount) FROM case_fee_receipts WHERE case_id=$1 AND owner_id=$2),0)::text AS received_amount,
    (a.agreed_amount-COALESCE((SELECT SUM(amount) FROM case_fee_receipts WHERE case_id=$1 AND owner_id=$2),0))::text AS outstanding_amount
    FROM (SELECT $1::uuid AS case_id) k LEFT JOIN case_fee_agreements a ON a.case_id=k.case_id AND a.owner_id=$2`,
    [id, owner],
  );
  const { rows } = await c.query(
    `SELECT id,amount::text,received_on::text,notes FROM case_fee_receipts WHERE case_id=$1 AND owner_id=$2 ORDER BY received_on,created_at,id`,
    [id, owner],
  );
  const a = agreements[0];
  return {
    currency: 'SAR',
    agreedAmount: a.agreed_amount ?? null,
    terms: a.terms ?? '',
    notes: a.notes ?? '',
    receivedAmount: a.received_amount,
    outstandingAmount: a.outstanding_amount ?? null,
    receipts: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      receivedOn: r.received_on,
      notes: r.notes,
    })),
  };
}
async function transaction(owner, id, mutation) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Serializes receipts and agreement changes so totals in each response are coherent.
    await ownedCase(id, owner, c, true);
    const result = await mutation(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function getFees(owner, id) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await ownedCase(id, owner, c);
    const result = await feeView(c, owner, id);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function saveAgreement(owner, id, raw) {
  const i = validated(SaveCaseFeeAgreementBody, raw);
  return transaction(owner, id, async (c) => {
    await c.query(
      `INSERT INTO case_fee_agreements(case_id,owner_id,agreed_amount,terms,notes) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(case_id) DO UPDATE SET agreed_amount=excluded.agreed_amount,terms=excluded.terms,notes=excluded.notes,updated_at=now()
      WHERE case_fee_agreements.owner_id=$2`,
      [id, owner, i.agreedAmount, i.terms ?? '', i.notes ?? ''],
    );
    return feeView(c, owner, id);
  });
}
function validCalendarDate(s) {
  const parsed = new Date(s);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number(s.slice(0, 4)) < 1 ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== s
  )
    throw new HttpError(400, 'أدخل تاريخ استلام صحيحًا.');
}
export async function createReceipt(owner, id, raw) {
  const i = validated(CreateCaseFeeReceiptBody, raw);
  validCalendarDate(i.receivedOn);
  return transaction(owner, id, async (c) => {
    await c.query(
      `INSERT INTO case_fee_receipts(case_id,owner_id,request_id,amount,received_on,notes) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(owner_id,case_id,request_id) DO NOTHING`,
      [id, owner, i.requestId, i.amount, i.receivedOn, i.notes ?? ''],
    );
    return feeView(c, owner, id);
  });
}
export async function editReceipt(owner, id, receiptId, raw) {
  const i = validated(UpdateCaseFeeReceiptBody, raw);
  validCalendarDate(i.receivedOn);
  return transaction(owner, id, async (c) => {
    const r = await c.query(
      `UPDATE case_fee_receipts SET amount=$4,received_on=$5,notes=$6,updated_at=now()
      WHERE case_id=$1 AND owner_id=$2 AND id=$3 RETURNING id`,
      [id, owner, receiptId, i.amount, i.receivedOn, i.notes ?? ''],
    );
    if (!r.rowCount) throw new HttpError(404, 'سجل الدفعة غير موجود.');
    return feeView(c, owner, id);
  });
}
