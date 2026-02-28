function decodeHtmlEntities(value: string): string {
  const htmlEntityMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    nbsp: " "
  };

  return value.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match, entity: string) => htmlEntityMap[entity] ?? match);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(decodeHtmlEntities(value));
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export { decodeHtmlEntities, normalizeWhitespace, sanitizeText };
