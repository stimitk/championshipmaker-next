"use client";
import { useEffect, useState } from "react";
import { api, errorText, rowsOf } from "../lib/api";
import { championshipListPath, usesSet } from "../lib/championship-sets";
import { portal } from "../lib/portal";
import {
  excludedQuestionIds,
  saveExcludedQuestions,
} from "../lib/question-selection";
import { questionFields } from "../lib/resources";
import { matchesSearch } from "../lib/search";
import type { Row } from "../lib/types";
import dynamic from "next/dynamic";
import {
  DataTable,
  Form,
  Heading,
  Loading,
  Notice,
  Retry,
  useLoad,
  IconButton,
  Modal,
  EmptyState,
} from "./ui";
import { Icon } from "./shell";
import { QuestionEditForm } from "./questions";
import { ChampionshipSummary } from "./championships";

const BulkImport = dynamic(
  () => import("./bulk-import").then((m) => ({ default: m.BulkImport })),
  { loading: () => <Loading text="Loading bulk import…" />, ssr: false }
);

const QuestionSetWizard = dynamic(
  () =>
    import("./question-set-wizard").then((m) => ({
      default: m.QuestionSetWizard,
    })),
  { loading: () => <Loading text="Loading wizard…" />, ssr: false }
);

export function QuestionSets({
  create = false,
  importFirst = false,
}: {
  create?: boolean;
  importFirst?: boolean;
}) {
  const [labelsRevision, setLabelsRevision] = useState(0);
  const [questionsRevision, setQuestionsRevision] = useState(0);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(create);
  const [tab, setTab] = useState<"questions" | "manual" | "import">(
    importFirst ? "import" : "questions",
  );
  const [importing, setImporting] = useState(false);
  const [questionMessage, setQuestionMessage] = useState("");
  const [page, setPage] = useState(1);
  const [setSearch, setSetSearch] = useState("");
  // Unsaved live-quiz selection for the open set; null means it matches what is saved.
  const [draftExcluded, setDraftExcluded] = useState<string[] | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const labels = useLoad<unknown>("/questions/labels", labelsRevision);
  const sets = rowsOf(labels.data);
  useEffect(() => {
    if (!selected && sets.length) setSelected(String(sets[0].label_id));
  }, [labels.data, selected]);
  const current = sets.find((row) => String(row.label_id) === selected);
  const championships = useLoad<unknown>(championshipListPath(), labelsRevision);
  const linkedChampionships = current
    ? rowsOf(championships.data).filter((row) => usesSet(row, current))
    : [];
  const visibleSets = sets.filter((row) =>
    matchesSearch(row.label_name, setSearch),
  );
  const savedExcluded = excludedQuestionIds(current);
  const excluded = draftExcluded ?? savedExcluded;
  const selectionDirty = draftExcluded !== null;
  function chooseSet(id: string) {
    if (
      selectionDirty &&
      !confirm("Discard your unsaved live quiz selection for this set?")
    )
      return;
    setDraftExcluded(null);
    setSelectionError("");
    setSelectionMessage("");
    setEditMessage("");
    setSelected(id);
    setPage(1);
  }
  async function saveSelection() {
    if (!draftExcluded || savingSelection) return;
    setSavingSelection(true);
    setSelectionError("");
    setSelectionMessage("");
    try {
      await saveExcludedQuestions(selected, draftExcluded);
      setSelectionMessage(
        draftExcluded.length
          ? `Saved. ${draftExcluded.length} ${draftExcluded.length === 1 ? "question is" : "questions are"} left out of live quizzes.`
          : "Saved. Every question in this set is included in live quizzes.",
      );
      setDraftExcluded(null);
      setLabelsRevision((v) => v + 1);
    } catch (error) {
      setSelectionError(errorText(error));
    } finally {
      setSavingSelection(false);
    }
  }
  const questions = useLoad<{ questions: Row[]; total: number }>(
    selected
      ? `/questions/?${new URLSearchParams({ labelId: selected, page: String(page), limit: "20" })}`
      : null,
    questionsRevision,
  );
  const refresh = () => setQuestionsRevision((v) => v + 1);
  if (creating)
    return (
      <QuestionSetWizard
        onCancel={() => {
          setCreating(false);
          setLabelsRevision((v) => v + 1);
          refresh();
        }}
        onComplete={(id) => {
          setDraftExcluded(null);
          setSelected(id);
          setPage(1);
          setTab("questions");
          setQuestionMessage("Question set is ready.");
          setCreating(false);
          setLabelsRevision((v) => v + 1);
          refresh();
        }}
      />
    );
  return (
    <>
      <Heading
        title="Question Sets"
        description="Create a set, then add questions individually or import them from a file."
        action={
          <button disabled={importing} onClick={() => setCreating(!creating)}>
            {creating ? "Close new set" : "Add new question set"}
          </button>
        }
      />
      <div className="question-sets-workspace">
        <section className="paper question-set-list" aria-label="Question sets">
          {labels.loading ? (
            <Loading />
          ) : labels.error ? (
            <Retry
              error={labels.error}
              onRetry={() => setLabelsRevision((v) => v + 1)}
            />
          ) : sets.length ? (
            <>
              <div className="question-set-list-header">
                <div className="question-set-list-title">
                  <h2>Your question sets</h2>
                  <span className="set-search-count" role="status">
                    {setSearch
                      ? `${visibleSets.length} of ${sets.length} sets`
                      : `${sets.length} ${sets.length === 1 ? "set" : "sets"}`}
                  </span>
                </div>
                <label className="set-search">
                  <span className="sr-only">Search question sets</span>
                  <input
                    type="search"
                    value={setSearch}
                    onChange={(event) => setSetSearch(event.target.value)}
                    placeholder="Search question sets"
                  />
                </label>
              </div>
              {visibleSets.length ? (
                <fieldset className="set-picker-group" disabled={importing}>
                  <legend className="sr-only">Choose a question set</legend>
                  {visibleSets.map((row) => {
                    const id = String(row.label_id);
                    return (
                      <label
                        key={id}
                        className={
                          selected === id ? "set-picker selected" : "set-picker"
                        }
                      >
                        <input
                          type="radio"
                          name="question-set"
                          value={id}
                          checked={selected === id}
                          onChange={() => chooseSet(id)}
                        />
                        <span>{String(row.label_name)}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="muted set-search-empty">
                  No question sets match “{setSearch}”.{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSetSearch("")}
                  >
                    Clear search
                  </button>
                </p>
              )}
            </>
          ) : (
            <>
              <h2>Your question sets</h2>
              <p className="muted">Create a question set to get started.</p>
            </>
          )}
        </section>
        <section className="paper question-set-content">
          {!selected ? (
            <Notice kind="info">
              Choose a question set or create a new one to add questions.
            </Notice>
          ) : (
            <>
              <h2>{String(current?.label_name || "Question set")}</h2>
              <section
                className="set-championships"
                aria-label="Championship details for this set"
              >
                <h3>Championship Details</h3>
                {portal.kind === "admin" && (
                  <p className="muted">Only active championships are listed.</p>
                )}
                {championships.loading ? (
                  <Loading />
                ) : championships.error ? (
                  <Retry
                    error={championships.error}
                    onRetry={() => setLabelsRevision((v) => v + 1)}
                  />
                ) : linkedChampionships.length ? (
                  linkedChampionships.map((row) => (
                    <LinkedChampionship key={String(row.champ_id)} row={row} />
                  ))
                ) : (
                  <EmptyState
                    title="No championships use this set yet"
                    description="Select this set when creating a championship and its details will appear here."
                  />
                )}
              </section>
              <div
                className="set-view-switch"
                role="group"
                aria-label="Question set actions"
              >
                {(
                  [
                    ["questions", "Questions"],
                    ["manual", "Add question"],
                    ["import", "Import questions"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={tab === value ? "small" : "small secondary"}
                    aria-pressed={tab === value}
                    disabled={importing}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "questions" &&
                (questions.loading ? (
                  <Loading />
                ) : questions.error ? (
                  <Retry error={questions.error} onRetry={refresh} />
                ) : (
                  <>
                    <div className="selection-bar" role="group" aria-label="Live quiz selection">
                      <span role="status">
                        {(() => {
                          const total = Number(questions.data?.total || 0);
                          const included = Math.max(0, total - excluded.length);
                          return `${included} of ${total} questions included in live quizzes${selectionDirty ? " · unsaved changes" : ""}`;
                        })()}
                      </span>
                      {selectionDirty && (
                        <button
                          type="button"
                          className="small secondary"
                          disabled={savingSelection}
                          onClick={() => {
                            setDraftExcluded(null);
                            setSelectionError("");
                          }}
                        >
                          Discard changes
                        </button>
                      )}
                      <button
                        type="button"
                        className="small"
                        disabled={!selectionDirty || savingSelection}
                        onClick={saveSelection}
                      >
                        {savingSelection ? "Saving…" : "Save selection"}
                      </button>
                    </div>
                    <p className="muted live-selection-hint">
                      Unchecked questions stay in this set and the Question
                      Bank, but are left out when a championship using this
                      set goes live.
                    </p>
                    {selectionError && (
                      <Notice kind="error">{selectionError}</Notice>
                    )}
                    {selectionMessage && (
                      <Notice kind="success">{selectionMessage}</Notice>
                    )}
                    {editMessage && (
                      <Notice kind="success">{editMessage}</Notice>
                    )}
                    <div className="live-selection">
                    <DataTable
                      rows={questions.data?.questions || []}
                      selection={{
                        selected: (questions.data?.questions || [])
                          .map((row) => String(row.question_id))
                          .filter((id) => !excluded.includes(id)),
                        // The table only toggles rows on this page, so other pages keep their state.
                        onChange: (included) => {
                          const shown = (questions.data?.questions || []).map(
                            (row) => String(row.question_id),
                          );
                          const next = [
                            ...excluded.filter((id) => !shown.includes(id)),
                            ...shown.filter((id) => !included.includes(id)),
                          ].sort();
                          setSelectionMessage("");
                          setDraftExcluded(
                            next.join() === [...savedExcluded].sort().join()
                              ? null
                              : next,
                          );
                        },
                        rowId: (row) => String(row.question_id),
                        rowLabel: (row) =>
                          `question ${String(row.question_id)} for live quizzes`,
                      }}
                      actionsFirst
                      actions={(row) => (
                        <IconButton
                          label="Edit question"
                          icon={<Icon name="edit" />}
                          onClick={() => {
                            setEditMessage("");
                            setEditing(row);
                          }}
                        />
                      )}
                      columns={[
                        ["question_text", "Question"],
                        ["option1_text", "Option 1"],
                        ["option2_text", "Option 2"],
                        ["option3_text", "Option 3"],
                        ["option4_text", "Option 4"],
                        ["expected_time_sec", "Expected time (sec)"],
                        ["total_coins", "Coins"],
                      ]}
                    />
                    </div>
                    <div className="pagination">
                      <button
                        className="secondary"
                        disabled={page === 1}
                        onClick={() => setPage((v) => v - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {page} · {questions.data?.total || 0} questions
                      </span>
                      <button
                        className="secondary"
                        disabled={
                          page * 20 >= Number(questions.data?.total || 0)
                        }
                        onClick={() => setPage((v) => v + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ))}
              {tab === "manual" && questionMessage && (
                <Notice kind="success">{questionMessage}</Notice>
              )}
              {tab === "manual" && (
                <Form
                  key={`manual-${selected}-${questionsRevision}`}
                  fields={questionFields.filter(
                    (field) => field.name !== "labelId",
                  )}
                  submitLabel="Add to question set"
                  secondaryAction={
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setTab("questions")}
                    >
                      View questions
                    </button>
                  }
                  onSubmit={async (body) => {
                    await api("/questions/", {
                      method: "POST",
                      body: {
                        ...body,
                        labelId: /^\d+$/.test(selected)
                          ? Number(selected)
                          : selected,
                      },
                    });
                    setQuestionMessage("Question added to this set.");
                    refresh();
                  }}
                />
              )}
              {tab === "import" && (
                <BulkImport
                  key={selected}
                  setId={selected}
                  setName={String(current?.label_name || "this question set")}
                  embedded
                  onImported={refresh}
                  onBusyChange={setImporting}
                />
              )}
            </>
          )}
        </section>
      </div>
      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit question"
        width={880}
      >
        {editing && (
          <QuestionEditForm
            id={String(editing.question_id)}
            question={editing}
            secondaryAction={
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            }
            onSaved={() => {
              setEditing(null);
              setEditMessage("Question updated.");
              refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}

/** One linked championship, using its full record (with game settings) once loaded. */
function LinkedChampionship({ row }: { row: Row }) {
  const details = useLoad<Row>(
    `/championships/${encodeURIComponent(String(row.champ_id))}`,
  );
  return (
    <div className="set-championship">
      <ChampionshipSummary data={{ ...row, ...details.data }} />
    </div>
  );
}
