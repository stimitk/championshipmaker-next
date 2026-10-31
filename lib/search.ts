// Every whitespace-separated term must appear, so "chem organic" finds "Organic Chemistry".
export function matchesSearch(text: unknown, query: string): boolean {
  const haystack = String(text ?? "").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
