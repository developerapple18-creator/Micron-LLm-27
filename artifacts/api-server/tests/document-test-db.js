// In-memory identity adapter only for processor unit tests; no database connection.
export const documents = new Map();
export const pool = {
  async query(_sql, values) {
    const doc = documents.get(values[0]);
    return {
      rows: doc && doc.row.owner_id === values[1] && doc.row.case_id === values[2] ? [doc.row] : [],
      rowCount: doc ? 1 : 0,
    };
  },
};
