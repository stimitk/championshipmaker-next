"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isRichColumn, plainRichText } from "../../lib/rich-text";
import type { Row } from "../../lib/types";
import { RichText } from "../rich-text-editor";
import { StatusBadge } from "./badge";
import { display } from "./form-controls";
import { SkeletonTable } from "./skeleton";
import { EmptyState } from "./empty-state";

export interface DataTableProps {
  rows: Row[];
  columns: [string, string][];
  actions?: (row: Row) => ReactNode;
  /** Show the Actions column before the data columns instead of last. */
  actionsFirst?: boolean;
  /** Show a leading "Sr. No." column numbering the rows as displayed. */
  serial?: boolean;
  /** Number of the first row, e.g. to continue numbering across pages. */
  serialStart?: number;
  statusKind?: "teacher" | "default";
  loading?: boolean;
  emptyMessage?: string;
  searchPlaceholder?: string;
  /** Show the built-in search box; turn off when the page has its own search. */
  searchable?: boolean;
  selection?: {
    selected: string[];
    onChange: (ids: string[]) => void;
    rowId: (row: Row) => string;
    rowLabel?: (row: Row) => string;
  };
}

function SelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="row-select"
      aria-label="Select all shown rows"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function DataTable({
  rows,
  columns,
  actions,
  actionsFirst = false,
  serial = false,
  serialStart = 1,
  statusKind,
  loading = false,
  emptyMessage,
  searchPlaceholder = "Search…",
  searchable = true,
  selection,
}: DataTableProps) {
  const [search, setSearch] = useState("");

  const extraColumns = (actions ? 1 : 0) + (selection ? 1 : 0) + (serial ? 1 : 0);

  if (loading) {
    return (
      <SkeletonTable
        rows={5}
        columns={columns.length + extraColumns}
      />
    );
  }

  const filtered = rows.filter((row) =>
    columns.some(([key]) =>
      (isRichColumn(key) ? plainRichText(row[key]) : display(row[key]))
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  const shownIds = selection ? filtered.map(selection.rowId) : [];
  const shownSelected = selection
    ? shownIds.filter((id) => selection.selected.includes(id)).length
    : 0;

  return (
    <>
      {searchable && (
      <div className="table-toolbar">
        <label>
          Search records
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        <span>
          {filtered.length} {filtered.length === 1 ? "record" : "records"}
        </span>
      </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {serial && (
                <th scope="col" className="serial-cell">
                  Sr. No.
                </th>
              )}
              {selection && (
                <th scope="col" className="select-cell">
                  <SelectAll
                    checked={shownIds.length > 0 && shownSelected === shownIds.length}
                    indeterminate={shownSelected > 0 && shownSelected < shownIds.length}
                    onChange={(checked) =>
                      selection.onChange(
                        checked
                          ? [...new Set([...selection.selected, ...shownIds])]
                          : selection.selected.filter((id) => !shownIds.includes(id)),
                      )
                    }
                  />
                </th>
              )}
              {actions && actionsFirst && <th scope="col">Actions</th>}
              {columns.map(([key, label]) => (
                <th key={key} scope="col">
                  {label}
                </th>
              ))}
              {actions && !actionsFirst && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((row, i) => (
                <tr
                  key={String(
                    row.question_id ||
                      row.champ_id ||
                      row.teacher_id ||
                      row.institute_id ||
                      row.company_id ||
                      row.id ||
                      i,
                  )}
                  className={
                    selection?.selected.includes(selection.rowId(row))
                      ? "is-selected"
                      : undefined
                  }
                >
                  {serial && (
                    <td className="serial-cell">{serialStart + i}</td>
                  )}
                  {selection && (
                    <td className="select-cell">
                      <input
                        type="checkbox"
                        className="row-select"
                        aria-label={`Select ${selection.rowLabel?.(row) || "row"}`}
                        checked={selection.selected.includes(selection.rowId(row))}
                        onChange={(event) => {
                          const id = selection.rowId(row);
                          selection.onChange(
                            event.target.checked
                              ? [...selection.selected, id]
                              : selection.selected.filter((value) => value !== id),
                          );
                        }}
                      />
                    </td>
                  )}
                  {actions && actionsFirst && (
                    <td>
                      <div className="row-actions">{actions(row)}</div>
                    </td>
                  )}
                  {columns.map(([key]) => (
                    <td key={key}>
                      {key === "status" ? (
                        <StatusBadge status={row[key]} kind={statusKind} />
                      ) : isRichColumn(key) ? (
                        <>
                          <RichText value={row[key]} />
                          {(() => {
                            const imageKey =
                              key === "question_text"
                                ? "question_image"
                                : key === "questionText"
                                  ? "questionImage"
                                  : key
                                      .replace(/_text$/, "_img")
                                      .replace(/Text$/, "Img");
                            // Only question and option text have an image beside them.
                            const src =
                              imageKey === key ? "" : String(row[imageKey] || "");
                            return /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(
                              src,
                            ) ? (
                              <img
                                className="question-table-image"
                                src={src}
                                alt="Attached question or answer image"
                                loading="lazy"
                              />
                            ) : null;
                          })()}
                        </>
                      ) : (
                        display(row[key])
                      )}
                    </td>
                  ))}
                  {actions && !actionsFirst && (
                    <td>
                      <div className="row-actions">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length + extraColumns}
                  className="empty"
                >
                  {search ? (
                    <EmptyState
                      title="No matching records"
                      description="Try another search term or clear the filter."
                    />
                  ) : (
                    <EmptyState
                      title={emptyMessage || "No records yet"}
                      description="When records are created, they will appear here."
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
