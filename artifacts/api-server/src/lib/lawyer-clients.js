import { pool } from '@workspace/db';
import {
  CreateLawyerClientBody,
  UpdateLawyerClientBody,
  SetLawyerClientPinBody,
} from '@workspace/api-zod';
import { caseView, validated } from './case-access.js';
import { HttpError } from './security.js';
const fields = (i) => {
  const name = i.name.trim(),
    email = (i.email ?? '').trim();
  if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw new HttpError(400, 'أدخل اسم الموكل وبريدًا إلكترونيًا صحيحًا إن وجد.');
  return [
    name,
    i.type ?? null,
    (i.mobile ?? '').trim(),
    email,
    (i.reference ?? '').trim(),
    i.notes ?? '',
  ];
};
export const clientView = (r) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  mobile: r.mobile,
  email: r.email,
  reference: r.reference,
  notes: r.notes,
  pinned: r.pinned ?? false,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export async function listClients(owner) {
  const { rows } = await pool.query(
    'SELECT * FROM lawyer_clients WHERE owner_id=$1 ORDER BY name,id',
    [owner],
  );
  return rows.map(clientView);
}
export async function getClient(owner, id) {
  // Each query is owner-scoped, including the joined organization table.
  const { rows } = await pool.query('SELECT * FROM lawyer_clients WHERE owner_id=$1 AND id=$2', [
    owner,
    id,
  ]);
  if (!rows[0]) throw new HttpError(404, 'الموكل غير موجود.');
  const { rows: cases } = await pool.query(
    `SELECT c.*,o.folder_id,COALESCE(o.pinned,false) AS pinned,l.name AS client_name FROM cases c
    LEFT JOIN case_organization o ON o.case_id=c.id AND o.owner_id=c.owner_id
    JOIN lawyer_clients l ON l.id=c.client_id AND l.owner_id=c.owner_id
    WHERE c.owner_id=$1 AND c.client_id=$2 ORDER BY c.updated_at DESC,c.id`,
    [owner, id],
  );
  return { client: clientView(rows[0]), cases: cases.map(caseView) };
}
export async function createClient(owner, raw) {
  const i = validated(CreateLawyerClientBody, raw),
    values = fields(i);
  const { rows } = await pool.query(
    `INSERT INTO lawyer_clients(owner_id,request_id,name,type,mobile,email,reference,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,request_id) DO UPDATE SET request_id=excluded.request_id RETURNING *`,
    [owner, i.requestId, ...values],
  );
  // A requestId never silently creates a second record on transport replay.
  return clientView(rows[0]);
}
export async function editClient(owner, id, raw) {
  const values = fields(validated(UpdateLawyerClientBody, raw));
  const { rows } = await pool.query(
    `UPDATE lawyer_clients SET name=$3,type=$4,mobile=$5,email=$6,reference=$7,notes=$8,updated_at=now()
    WHERE owner_id=$1 AND id=$2 RETURNING *`,
    [owner, id, ...values],
  );
  if (!rows[0]) throw new HttpError(404, 'الموكل غير موجود.');
  return clientView(rows[0]);
}
export async function pinClient(owner, id, raw) {
  const { pinned } = validated(SetLawyerClientPinBody, raw);
  const { rows } = await pool.query(
    `UPDATE lawyer_clients SET pinned=$3,updated_at=now()
    WHERE owner_id=$1 AND id=$2 RETURNING *`,
    [owner, id, pinned],
  );
  if (!rows[0]) throw new HttpError(404, 'الموكل غير موجود.');
  return clientView(rows[0]);
}
