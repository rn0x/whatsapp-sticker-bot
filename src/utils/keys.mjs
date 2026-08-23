// تحويل أسماء الأعمدة snake_case من SQLite إلى camelCase في طبقة الـ repositories.
// الإبقاء على JSON المضمّنة كما هي.

export function camelizeKey(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function rowToCamel(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camelizeKey(k)] = v;
  return out;
}

export function rowsToCamel(rows) {
  return rows.map(rowToCamel);
}

export function snakeCaseKey(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}