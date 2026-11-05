import { rowsOf } from "./api";
import { portal } from "./portal";
import type { Row } from "./types";

/** Championships visible to this portal: the teacher's own, or the active feed for admins. */
export function championshipListPath() {
  return portal.kind === "teacher"
    ? "/teacher/championships"
    : "/championships/feed";
}

function list(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string" || typeof value === "number"
      ? String(value).split(",")
      : [];
  return values.map((v) => String(v).trim()).filter(Boolean);
}

/** Question sets linked to a championship, read from the record itself or its game modes, as IDs and/or names. */
export function linkedSets(row: Row) {
  const sources = [row, ...rowsOf(row.modes)];
  return {
    ids: [
      ...new Set(
        sources.flatMap((s) => list(s.label_ids ?? s.labelIds ?? s.label_id)),
      ),
    ],
    names: [
      ...new Set(sources.flatMap((s) => list(s.label_names ?? s.label_name))),
    ],
  };
}

export function usesSet(championship: Row, set: Row) {
  const { ids, names } = linkedSets(championship);
  return (
    ids.includes(String(set.label_id)) || names.includes(String(set.label_name))
  );
}
