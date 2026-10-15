export const CLUE_LABELS: Record<string, string> = {
  fuzzy_history: 'Fuzzy History Match',
  keyword: 'Keyword Match',
  bai_code: 'BAI Transaction Code',
  subcategory_text: 'Sub-Category Text',
  category_text: 'Category Text',
}

/**
 * Returns a human-readable list of clue names from a score breakdown dictionary.
 * Example: {"fuzzy_history": 90, "subcategory_text": 40} -> "Fuzzy History Match, Sub-Category Text"
 */
export function formatClueLabels(scoreBreakdown?: Record<string, number> | null): string {
  if (!scoreBreakdown || Object.keys(scoreBreakdown).length === 0) return ''
  return Object.keys(scoreBreakdown)
    .map((key) => CLUE_LABELS[key] || key)
    .join(', ')
}
