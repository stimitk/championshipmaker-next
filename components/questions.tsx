"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, rowsOf } from "../lib/api";
import { questionFields } from "../lib/resources";
import {
  excludedQuestionIds,
  saveExcludedQuestions,
} from "../lib/question-selection";
import type { Row } from "../lib/types";
import {
  DataTable,
  Form,
  Heading,
  Loading,
  Notice,
  Retry,
  useLoad,
  Card,
  Button,
  ConfirmModal,
} from "./ui";

export function QuestionBank() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removeMessage, setRemoveMessage] = useState("");
  // Selection belongs to the rows on screen; a new page or filter starts fresh.
  useEffect(() => setSelected([]), [page, search, label]);
  const query = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(search ? { search } : {}),
    ...(label ? { labelId: label } : {}),
  });
  const { data, loading, error } = useLoad<{ questions: Row[]; total: number }>(
    `/questions/?${query}`,
    revision,
  );
  const labels = useLoad<unknown>("/questions/labels", revision);
  const setNames = new Map(
    rowsOf(labels.data).map((row) => [String(row.label_id), row.label_name]),
  );
  const labelName = String(setNames.get(label) || "this question set");
  const rows: Row[] = (data?.questions || []).map((row) => ({
    ...row,
    label_name:
      row.label_id === null || row.label_id === undefined || row.label_id === ""
        ? null
        : (row.label_name ?? setNames.get(String(row.label_id)) ?? row.label_id),
  }));
  const shownIds = new Set(
    rows.map((row) => String(row.question_id)),
  );
  const removable = selected.filter((id) => shownIds.has(id));

  async function removeFromSet() {
    if (!label || !removable.length || removing) return;
    setRemoving(true);
    setRemoveError("");
    setRemoveMessage("");
    const failed: string[] = [];
    let lastError: unknown;
    // Clear only the set link; the question itself stays in the bank.
    for (const id of removable) {
      try {
        await api(`/questions/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: { labelId: null },
        });
      } catch (e) {
        failed.push(id);
        lastError = e;
      }
    }
    const removed = removable.length - failed.length;
    // Drop removed questions from the set's live-quiz exclusions so its counts stay accurate.
    const excluded = excludedQuestionIds(
      rowsOf(labels.data).find((row) => String(row.label_id) === label),
    );
    const pruned = excluded.filter(
      (id) => !removable.includes(id) || failed.includes(id),
    );
    if (pruned.length !== excluded.length)
      await saveExcludedQuestions(label, pruned).catch(() => {});
    setRemoving(false);
    setConfirming(false);
    if (removed)
      setRemoveMessage(
        `${removed} ${removed === 1 ? "question" : "questions"} removed from ${labelName}. ${removed === 1 ? "It is" : "They are"} still in the Question Bank.`,
      );
    if (failed.length)
      setRemoveError(
        `${failed.length} ${failed.length === 1 ? "question" : "questions"} could not be removed: ${errorText(lastError)}`,
      );
    setRevision((v) => v + 1);
    if (failed.length) setSelected(failed);
  }

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSearch(String(form.get("search") || ""));
    setLabel(String(form.get("label") || ""));
    setPage(1);
    setRemoveMessage("");
    setRemoveError("");
  }

  return (
    <>
      <Heading
        title="Question Bank"
        action={
          <Button href="/questions/new">
            New Question
          </Button>
        }
      />
      <Card>
        <form className="filter-bar" onSubmit={filter}>
          <label>
            Question text
            <input type="search" name="search" placeholder="Search questions" />
          </label>
          <label>
            Question set
            <select
              name="label"
              defaultValue={label}
              key={labels.loading ? "loading" : "ready"}
            >
              <option value="">All question sets</option>
              {rowsOf(labels.data).map((row) => (
                <option key={String(row.label_id)} value={String(row.label_id)}>
                  {String(row.label_name)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Filter</Button>
        </form>
        {labels.error && <Notice kind="error">{labels.error}</Notice>}
        {removeMessage && <Notice kind="success">{removeMessage}</Notice>}
        {removeError && <Notice kind="error">{removeError}</Notice>}
        {label ? (
          <div className="selection-bar" role="group" aria-label="Selected questions">
            <span role="status">
              {removable.length
                ? `${removable.length} selected`
                : `Select questions to remove them from ${labelName}.`}
            </span>
            {removable.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={!removable.length || removing}
              onClick={() => setConfirming(true)}
            >
              Remove from set
            </Button>
          </div>
        ) : (
          <p className="muted">
            Filter by a question set to select questions and remove them from
            that set.
          </p>
        )}
        {error ? (
          <Retry error={error} onRetry={() => setRevision((v) => v + 1)} />
        ) : (
          <>
            <DataTable
              rows={rows}
              loading={loading}
              selection={
                label
                  ? {
                      selected,
                      onChange: setSelected,
                      rowId: (row) => String(row.question_id),
                      rowLabel: (row) =>
                        `question ${String(row.question_id)}`,
                    }
                  : undefined
              }
              columns={[
                ["question_text", "Question"],
                ["label_name", "Question set"],
                ["option1_text", "Option 1"],
                ["option2_text", "Option 2"],
                ["option3_text", "Option 3"],
                ["option4_text", "Option 4"],
                ["correct_answer", "Correct"],
                ["total_coins", "Coins"],
              ]}
              actions={(row) => (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    href={`/questions/${encodeURIComponent(String(row.question_id))}/edit`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (!confirm("Are you sure you want to delete this question?"))
                        return;
                      try {
                        await api(`/questions/${encodeURIComponent(String(row.question_id))}`, {
                          method: "DELETE",
                        });
                        setRevision((v) => v + 1);
                      } catch (e) {
                        alert(errorText(e));
                      }
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
            {data && data.total > 20 && (
              <div className="pagination">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {Math.ceil(data.total / 20)} ({data.total} total)
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <ConfirmModal
        isOpen={confirming}
        onClose={() => {
          if (!removing) setConfirming(false);
        }}
        onConfirm={removeFromSet}
        loading={removing}
        isDangerous
        title="Remove from question set?"
        confirmLabel={`Remove ${removable.length} ${removable.length === 1 ? "question" : "questions"}`}
        message={
          <p>
            {removable.length === 1 ? "This question" : `These ${removable.length} questions`}{" "}
            will no longer be part of <strong>{labelName}</strong> or
            championships that use it. {removable.length === 1 ? "It stays" : "They stay"} in
            the Question Bank and can be added to a set again by editing.
          </p>
        }
      />
    </>
  );
}

export function QuestionEditor({ id }: { id?: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Row | null>(null);
  const [lookup, setLookup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    api<{ questions: Row[] }>(`/questions/?${new URLSearchParams({ limit: "100", page: "1" })}`, {
      signal: controller.signal,
    })
      .then((data) => {
        const found = data.questions.find((row) => String(row.question_id) === id);
        if (found) setLoaded(found);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id]);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setLoaded(null);
    try {
      const query = new URLSearchParams({
        limit: "100",
        page: "1",
        ...(lookup ? { search: lookup } : {}),
      });
      const data = await api<{ questions: Row[] }>(`/questions/?${query}`);
      const found = data.questions.find((row) => String(row.question_id) === id);
      if (!found)
        throw new Error(
          "Question not found. Try searching a word from the question, or return to the question bank.",
        );
      setLoaded(found);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const initial: Record<string, unknown> = loaded
    ? {
        labelId: loaded.label_id,
        questionText: loaded.question_text,
        questionImage: loaded.question_image,
        option1Text: loaded.option1_text,
        option2Text: loaded.option2_text,
        option3Text: loaded.option3_text,
        option4Text: loaded.option4_text,
        option1Img: loaded.option1_img,
        option2Img: loaded.option2_img,
        option3Img: loaded.option3_img,
        option4Img: loaded.option4_img,
        correctAnswer: loaded.correct_answer,
        totalCoins: loaded.total_coins,
        expectedTimeSeconds: loaded.expected_time_sec,
      }
    : {};

  const fields = id
    ? questionFields.filter((f) => f.name !== "expectedTimeSeconds")
    : questionFields;

  return (
    <>
      <Heading title={id ? "Edit Question" : "New Question"} />
      {id && !loaded && (
        <Card>
          <p>
            Load the question before editing. You can narrow the lookup with a
            word from its text.
          </p>
          <form className="filter-bar" onSubmit={load}>
            <label>
              Question text
              <input
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="Optional search text"
              />
            </label>
            <Button type="submit" loading={busy} disabled={busy}>
              Load question
            </Button>
          </form>
          {error && <Notice kind="error">{error}</Notice>}
        </Card>
      )}
      {(!id || loaded) && (
        <Card>
          <Form
            key={id || "new"}
            fields={fields}
            initial={initial}
            submitLabel={id ? "Save question" : "Add question"}
            onSubmit={async (values) => {
              await api(
                id ? `/questions/${encodeURIComponent(id)}` : "/questions/",
                { method: id ? "PUT" : "POST", body: values },
              );
              router.push("/questions");
            }}
          />
        </Card>
      )}
    </>
  );
}
