export const looksLikeEventIdLabel = (value?: string | null) => {
  const normalized = (value || '').trim();
  return /^[0-9]+$/.test(normalized);
};

export const resolveEventDisplayName = (candidate?: string | null, fallback?: string | null) => {
  const next = (candidate || '').trim();
  const current = (fallback || '').trim();

  if (!next) return current;
  if (!current) return next;

  if (looksLikeEventIdLabel(next) && !looksLikeEventIdLabel(current)) {
    return current;
  }

  return next;
};
