"use client";
import { useRef, useState } from "react";
import { api, errorText, rowsOf } from "../lib/api";
import { championshipListPath } from "../lib/championship-sets";
import type { Row } from "../lib/types";
import {
  Button,
  Card,
  DataTable,
  Heading,
  IconButton,
  Loading,
  Modal,
  Notice,
  Retry,
  useLoad,
} from "./ui";
import { Icon } from "./shell";
import { ChampionshipSummary } from "./championships";
import { RichText } from "./rich-text-editor";

type Report = Row & {
  status?: "pending" | "verified" | "rejected";
  rewarded_at?: string | null;
  reward_coins?: number | null;
};

const statusText = (report: Report) =>
  report.rewarded_at
    ? report.reward_coins
      ? `Rewarded ${report.reward_coins} coins`
      : "Rewarded"
    : report.status === "verified"
      ? "Verified · awaiting reward"
      : report.status === "rejected"
        ? "Rejected"
        : "Pending review";

const dateTime = (value: unknown) => {
  const date = new Date(String(value ?? ""));
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "";
};

export function WrongQuestions() {
  const [championship, setChampionship] = useState("");
  const [viewing, setViewing] = useState<Row | null>(null);
  const [revision, setRevision] = useState(0);
  const championships = useLoad<unknown>(championshipListPath());
  const errors = useLoad<unknown>(
    `/questions/analytics/frequent-errors${championship ? `?${new URLSearchParams({ championshipId: championship })}` : ""}`,
    revision,
  );
  // Filtered here too, in case the server returns rows for every championship.
  const rows = rowsOf(errors.data).filter(
    (row) =>
      !championship ||
      row.champ_id === undefined ||
      String(row.champ_id) === championship,
  );
  const reportedIds = [
    ...new Set(
      rows
        .map((row) => row.champ_id)
        .filter((id) => id !== undefined && id !== null)
        .map(String),
    ),
  ];
  // Details for the chosen championship, or the only one the reports belong to.
  const detailsId =
    championship || (reportedIds.length === 1 ? reportedIds[0] : "");
  const championshipOptions = rowsOf(championships.data);
  return (
    <>
      <Heading
        title="Wrong Questions"
        description="Questions students most often answer incorrectly or report. Review reports and reward students when a question is confirmed wrong."
      />
      {championshipOptions.length > 1 && (
        <Card style={{ marginBottom: 20 }}>
          <div className="filter-bar" style={{ marginBottom: 0 }}>
            <label>
              Championship
              <select
                value={championship}
                onChange={(event) => setChampionship(event.target.value)}
              >
                <option value="">All championships</option>
                {championshipOptions.map((row) => (
                  <option key={String(row.champ_id)} value={String(row.champ_id)}>
                    #{String(row.champ_id)} · {String(row.champ_name)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={!championship}
              onClick={() => setChampionship("")}
            >
              Show all
            </Button>
          </div>
        </Card>
      )}
      <Card className="analytics-details">
        <h2 style={{ margin: "0 0 4px" }}>Championship Details</h2>
        {detailsId ? (
          <SelectedChampionship
            key={detailsId}
            id={detailsId}
            fallback={championshipOptions.find(
              (row) => String(row.champ_id) === detailsId,
            )}
          />
        ) : (
          <p className="muted">
            Showing wrong questions from all championships. Choose a
            championship above to see its details.
          </p>
        )}
      </Card>
      <Card>
        {errors.error ? (
          <Retry error={errors.error} onRetry={() => setRevision((v) => v + 1)} />
        ) : (
          <DataTable
            rows={rows}
            loading={errors.loading}
            serial
            searchPlaceholder="Search questions…"
            emptyMessage="No wrong questions yet"
            columns={[
              ["question_text", "Question"],
              ["champ_id", "Championship ID"],
              ["champ_name", "Championship"],
              ["error_count", "Incorrect answers"],
              ["report_count", "Reports"],
            ]}
            actionsFirst
            actions={(row) => (
              <IconButton
                label="View reports"
                icon={<Icon name="eye" />}
                onClick={() => setViewing(row)}
              />
            )}
          />
        )}
      </Card>
      <Modal
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        title="Question reports"
        width={980}
      >
        {viewing && (
          <ReportsPanel
            question={viewing}
            championshipId={
              championship ||
              (viewing.champ_id === undefined ? "" : String(viewing.champ_id))
            }
            onChanged={() => setRevision((v) => v + 1)}
          />
        )}
      </Modal>
    </>
  );
}

function SelectedChampionship({ id, fallback }: { id: string; fallback?: Row }) {
  const details = useLoad<Row>(`/championships/${encodeURIComponent(id)}`);
  if (details.loading && !fallback) return <Loading />;
  if (details.error && !fallback) return <Notice kind="error">{details.error}</Notice>;
  return <ChampionshipSummary data={{ ...fallback, ...details.data }} />;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ReportsPanel({
  question,
  championshipId,
  onChanged,
}: {
  question: Row;
  championshipId: string;
  onChanged: () => void;
}) {
  const id = encodeURIComponent(String(question.question_id));
  const scope: Record<string, string> = championshipId ? { championshipId } : {};
  const [revision, setRevision] = useState(0);
  const reports = useLoad<{ reports: Report[]; total: number }>(
    `/questions/${id}/reports?${new URLSearchParams(scope)}`,
    revision,
  );
  const [confirming, setConfirming] = useState<
    "incorrect" | "correct" | "award" | null
  >(null);
  const [coins, setCoins] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Reused when an award is retried so the server can recognise a repeat and pay once.
  const awardKey = useRef<string | null>(null);

  const list = reports.data?.reports || [];
  const total = Number(reports.data?.total ?? list.length);
  const pending = list.filter((r) => (r.status || "pending") === "pending");
  const eligible = list.filter((r) => r.status === "verified" && !r.rewarded_at);
  const rewarded = list.filter((r) => r.rewarded_at);
  const amount = Number(coins);
  const amountValid = Number.isInteger(amount) && amount >= 1 && amount <= 1000;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      setConfirming(null);
      setRevision((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const verify = (verdict: "incorrect" | "correct") =>
    run(async () => {
      await api(`/questions/${id}/reports/verification`, {
        method: "PUT",
        body: { ...scope, verdict },
      });
      return verdict === "incorrect"
        ? "Question confirmed as incorrect. You can now award bonus coins to the students who reported it."
        : "Question marked as correct. The reports were rejected and no coins will be awarded.";
    });

  const award = () =>
    run(async () => {
      awardKey.current ??= newKey();
      const result = await api<{
        awarded?: unknown[];
        skipped?: number;
        totalCoins?: number;
      }>(`/questions/${id}/rewards`, {
        method: "POST",
        body: { ...scope, coins: amount, idempotencyKey: awardKey.current },
      });
      awardKey.current = null;
      const count = Array.isArray(result.awarded) ? result.awarded.length : 0;
      const skipped = Number(result.skipped || 0);
      return `Awarded ${amount} coins to ${count} ${count === 1 ? "student" : "students"}${result.totalCoins ? ` (${result.totalCoins} coins in total)` : ""}.${skipped ? ` ${skipped} already rewarded ${skipped === 1 ? "student was" : "students were"} skipped.` : ""}`;
    });

  return (
    <div className="reports-panel">
      <div className="reports-question">
        <span className="muted">Question #{String(question.question_id)}</span>
        <RichText value={question.question_text} />
      </div>
      {reports.loading ? (
        <Loading />
      ) : reports.error ? (
        <Retry error={reports.error} onRetry={() => setRevision((v) => v + 1)} />
      ) : (
        <>
          <p className="reports-summary" role="status">
            <strong>{total}</strong>{" "}
            {total === 1 ? "student has" : "students have"} reported this
            question
            {championshipId ? ` in championship #${championshipId}` : ""}.
            {rewarded.length > 0 && ` ${rewarded.length} rewarded so far.`}
          </p>
          {message && <Notice kind="success">{message}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          <DataTable
            rows={list.map((r) => ({
              ...r,
              reported_on: dateTime(r.reported_at),
              report_status: statusText(r),
            }))}
            serial
            searchable={list.length > 10}
            emptyMessage="No reports for this question"
            columns={[
              ["user_name", "Student"],
              ["email", "Email"],
              ["champ_id", "Championship ID"],
              ["reported_on", "Reported"],
              ["report_status", "Report status"],
            ]}
          />
          {pending.length > 0 && (
            <section className="reports-step">
              <h3>1. Verify the question</h3>
              <p className="muted">
                Check the question and its answer. Coins can only be awarded
                after you confirm the question is actually incorrect.
              </p>
              {confirming === "incorrect" || confirming === "correct" ? (
                <Notice kind="info">
                  {confirming === "incorrect"
                    ? `Confirm this question is incorrect? ${pending.length} pending ${pending.length === 1 ? "report" : "reports"} will be verified.`
                    : `Mark this question as correct? ${pending.length} pending ${pending.length === 1 ? "report" : "reports"} will be rejected.`}
                  <div className="form-actions">
                    <Button
                      size="sm"
                      loading={busy}
                      onClick={() => verify(confirming)}
                    >
                      {confirming === "incorrect"
                        ? "Yes, question is incorrect"
                        : "Yes, question is correct"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </Notice>
              ) : (
                <div className="form-actions">
                  <Button size="sm" onClick={() => setConfirming("incorrect")}>
                    Confirm question is incorrect
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming("correct")}
                  >
                    Question is correct
                  </Button>
                </div>
              )}
            </section>
          )}
          {eligible.length > 0 && (
            <section className="reports-step">
              <h3>{pending.length ? "2. " : ""}Award bonus coins</h3>
              <p className="muted">
                {eligible.length} verified{" "}
                {eligible.length === 1 ? "student has" : "students have"} not
                been rewarded yet. Each student can be rewarded only once for
                this question.
              </p>
              <div className="filter-bar reports-award">
                <label>
                  Coins per student
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={coins}
                    disabled={busy}
                    onChange={(event) => {
                      setCoins(event.target.value);
                      setConfirming(null);
                      awardKey.current = null;
                    }}
                  />
                </label>
                <Button
                  disabled={!amountValid || busy || confirming === "award"}
                  onClick={() => setConfirming("award")}
                >
                  Award to {eligible.length}{" "}
                  {eligible.length === 1 ? "student" : "students"}
                </Button>
              </div>
              {!amountValid && (
                <p className="attachment-error">
                  Enter a whole number of coins from 1 to 1000.
                </p>
              )}
              {confirming === "award" && amountValid && (
                <Notice kind="info">
                  Award {amount} coins each to {eligible.length}{" "}
                  {eligible.length === 1 ? "student" : "students"} (
                  {amount * eligible.length} coins in total)? Coins are added
                  to their balances immediately and cannot be taken back here.
                  <div className="form-actions">
                    <Button size="sm" loading={busy} onClick={award}>
                      Award coins
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </Notice>
              )}
            </section>
          )}
          {!pending.length && !eligible.length && list.length > 0 && (
            <p className="muted reports-step">
              {rewarded.length
                ? "Every verified student has been rewarded for this question."
                : "These reports were rejected, so no coins can be awarded."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
