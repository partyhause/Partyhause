export function validateBirthDate(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'must be a string';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'must be YYYY-MM-DD';
  const d = new Date(`${value}T00:00:00Z`);
  if (isNaN(d.getTime())) return 'is not a valid date';
  if (d > new Date()) return 'cannot be in the future';
  return null;
}

export function validateInterests(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return 'must be an array';
  for (const v of value) {
    if (typeof v !== 'string') return 'items must be strings';
  }
  return null;
}

export function validateMediaUrl(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'must be a string';
  try {
    new URL(value);
  } catch {
    return 'is not a valid URL';
  }
  return null;
}
