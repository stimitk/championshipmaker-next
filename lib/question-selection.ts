import { api, asId } from "./api";
import type { Row } from "./types";

// A set stores the questions switched off for live quizzes, so questions added later are included by default.
export function excludedQuestionIds(set: Row | undefined): string[] {
  const value = set?.excluded_question_ids ?? set?.excludedQuestionIds;
  const ids = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
}

export function saveExcludedQuestions(setId: string, ids: string[]) {
  return api(`/questions/labels/${encodeURIComponent(setId)}`, {
    method: "PUT",
    body: { excludedQuestionIds: ids.map(asId) },
  });
}
