"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, rowsOf } from "../lib/api";
import { championshipListPath, linkedSets } from "../lib/championship-sets";
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
  IconButton,
} from "./ui";
import { Icon } from "./shell";

export function QuestionBank() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const [championship, setChampionship] = useState("");
  const [filterKey, setFilterKey] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removeMessage, setRemoveMessage] = useState("");
  // Selection belongs to the rows on screen; a new page or filter starts fresh.
  useEffect(() => setSelected([]), [page, search, label, championship]);
  const labels = useLoad<unknown>("/questions/labels", revision);
  const championships = useLoad<unknown>(championshipListPath(), revision);
  const setNames = new Map(
    rowsOf(labels.data).map((row) => [String(row.label_id), row.label_name]),
  );
  // A championship's questions are those in its linked sets. null means no set restriction.
  const championshipRow = rowsOf(championships.data).find(
    (row) => String(row.champ_id) === championship,
  );
  const championshipSets = championshipRow
    ? (() => {
        const { ids, names } = linkedSets(championshipRow);
        const byName = rowsOf(labels.data)
          .filter((row) => names.includes(String(row.label_name)))
          .map((row) => String(row.label_id));
        return [...new Set([...ids, ...byName])];
      })()
    : [];
  const scopeReady =
    !championship || (!championships.loading && !labels.loading);
  const scope: string[] | null = !championship
    ? label
      ? [label]
      : null
    : label
      ? championshipSets.includes(label)
        ? [label]
        : []
      : championshipSets;
  // One set or none: the API filters and paginates. Several: fetched per set and merged below.
  const single = scopeReady && (scope === null || scope.length === 1);
  const query = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(search ? { search } : {}),
    ...(scope?.length === 1 ? { labelId: scope[0] } : {}),
  });
  const singleLoad = useLoad<{ questions: Row[]; total: number }>(
    single ? `/questions/?${query}` : null,
    revision,
  );
  const scopeKey = scopeReady && scope && scope.length > 1 ? scope.join(",") : "";
  const [merged, setMerged] = useState<{
    key: string;
    rows: Row[];
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!scopeKey) return;
    const controller = new AbortController();
    const key = `${scopeKey}|${search}|${revision}`;
    setMerged(null);
    Promise.all(
      scopeKey.split(",").map(async (labelId) => {
        const all: Row[] = [];
        for (let next = 1; ; next++) {
          const result = await api<{ questions: Row[]; total: number }>(
            `/questions/?${new URLSearchParams({ labelId, page: String(next), limit: "100", ...(search ? { search } : {}) })}`,
            { signal: controller.signal },
          );
          all.push(...result.questions);
          if (!result.questions.length || all.length >= Number(result.total))
            return all;
        }
      }),
    )
      .then((lists) => {
        const rows = [
          ...new Map(
            lists.flat().map((row) => [String(row.question_id), row]),
          ).values(),
        ].sort((a, b) => Number(a.question_id) - Number(b.question_id));
        setMerged({ key, rows, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setMerged({ key, rows: [], error: errorText(e) });
      });
    return () => controller.abort();
  }, [scopeKey, search, revision]);
  const mergedReady =
    merged?.key === `${scopeKey}|${search}|${revision}` ? merged : null;
  const data = !scopeReady
    ? null
    : single
      ? singleLoad.data
      : scopeKey
        ? mergedReady && {
            questions: mergedReady.rows.slice((page - 1) * 20, page * 20),
            total: mergedReady.rows.length,
          }
        : { questions: [], total: 0 };
  const loading = !scopeReady || (single ? singleLoad.loading : !!scopeKey && !mergedReady);
  const error =
    (championship && championships.error) ||
    (single ? singleLoad.error : mergedReady?.error || "");
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
    setSearch(String(form.get("search") || "").trim());
    setLabel(String(form.get("label") || ""));
    setChampionship(String(form.get("championship") || ""));
    setPage(1);
    setRemoveMessage("");
    setRemoveError("");
  }
  function resetFilters() {
    setSearch("");
    setLabel("");
    setChampionship("");
    setPage(1);
    setRemoveMessage("");
    setRemoveError("");
    setFilterKey((v) => v + 1);
  }
  const filtered = !!(search || label || championship);

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
        <form className="filter-bar" onSubmit={filter} key={filterKey}>
          <label>
            Question text
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Search questions"
            />
          </label>
          <label>
            Championship ID
            <select
              name="championship"
              defaultValue={championship}
              key={championships.loading ? "loading" : "ready"}
            >
              <option value="">
                {championships.loading ? "Loading championships…" : "All championships"}
              </option>
              {rowsOf(championships.data).map((row) => (
                <option key={String(row.champ_id)} value={String(row.champ_id)}>
                  #{String(row.champ_id)} · {String(row.champ_name)}
                </option>
              ))}
            </select>
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
          <Button
            type="button"
            variant="secondary"
            disabled={!filtered}
            onClick={resetFilters}
          >
            Reset filters
          </Button>
        </form>
        {labels.error && <Notice kind="error">{labels.error}</Notice>}
        {championships.error && !championship && (
          <Notice kind="error">
            Championships could not be loaded: {championships.error}
          </Notice>
        )}
        {championship && scopeReady && !error && scope?.length === 0 && (
          <Notice kind="info">
            {championshipRow
              ? label
                ? "The selected question set is not used by this championship."
                : "This championship has no linked question sets."
              : "This championship is no longer in your list."}
          </Notice>
        )}
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
              searchable={false}
              serial
              serialStart={(page - 1) * 20 + 1}
              emptyMessage={
                filtered ? "No questions match these filters" : undefined
              }
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
              actionsFirst
              actions={(row) => (
                <>
                  <IconButton
                    label="Edit question"
                    icon={<Icon name="edit" />}
                    href={`/questions/${encodeURIComponent(String(row.question_id))}/edit`}
                  />
                  <IconButton
                    label="Delete question"
                    variant="danger"
                    icon={<Icon name="trash" />}
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
                  />
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
          {id && loaded ? (
            <QuestionEditForm
              id={id}
              question={loaded}
              onSaved={() => router.push("/questions")}
            />
          ) : (
            <Form
              key="new"
              fields={questionFields}
              submitLabel="Add question"
              onSubmit={async (values) => {
                await api("/questions/", { method: "POST", body: values });
                router.push("/questions");
              }}
            />
          )}
        </Card>
      )}
    </>
  );
}

// Shared by the Edit Question page and the Question Sets edit dialog.
export function QuestionEditForm({
  id,
  question,
  onSaved,
  secondaryAction,
}: {
  id: string;
  question: Row;
  onSaved: () => void;
  secondaryAction?: ReactNode;
}) {
  const initial: Record<string, unknown> = {
    labelId: question.label_id,
    questionText: question.question_text,
    questionImage: question.question_image,
    option1Text: question.option1_text,
    option2Text: question.option2_text,
    option3Text: question.option3_text,
    option4Text: question.option4_text,
    option1Img: question.option1_img,
    option2Img: question.option2_img,
    option3Img: question.option3_img,
    option4Img: question.option4_img,
    correctAnswer: question.correct_answer,
    totalCoins: question.total_coins,
    expectedTimeSeconds: question.expected_time_sec,
  };
  return (
    <Form
      key={id}
      fields={questionFields}
      initial={initial}
      submitLabel="Save question"
      secondaryAction={secondaryAction}
      onSubmit={async (values) => {
        await api(`/questions/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: values,
        });
        onSaved();
      }}
    />
  );
}
