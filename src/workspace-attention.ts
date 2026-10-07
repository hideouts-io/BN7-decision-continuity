import type { SharedBasis, SharedHistory, SharedImpact, SharedReview } from "./shared-model.ts";
import { sharedBasis, sharedImpact, sharedPendingReview } from "./shared-model.ts";
import { escapeHtml, getElement } from "./render.ts";

export type AttentionItem = Readonly<{
  decisionId: string;
  title: string;
  basis: SharedBasis | null;
  impact: SharedImpact;
  pending: SharedReview | null;
  deferred: boolean;
  latestAlreadyReviewed: boolean;
}>;
export type WorkspaceAttention = Readonly<{
  evidenceId: string;
  sourceEventId: string;
  questions: number;
  pendingReviews: number;
  outcomes: number;
  items: readonly AttentionItem[];
}>;

/** Project validated current records without sorting, altering history or treating a rule result as assurance. */
export function workspaceAttention(state: SharedHistory): WorkspaceAttention {
  const latest = state.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("An attention overview requires a preserved source capture.");
  const items: readonly AttentionItem[] = state.originalDecisions.map((record): AttentionItem => {
    const id = record.decision.id, basis = sharedBasis(state, id), pending = sharedPendingReview(state, id);
    return {
      decisionId: id, title: record.decision.title, basis,
      impact: sharedImpact(state, record, basis, latest.evidence), pending,
      deferred: pending !== null && state.outcomes.filter((item): boolean => item.reviewId === pending.id).at(-1)?.outcome === "defer",
      latestAlreadyReviewed: state.reviews.some((review): boolean => review.decisionId === id && review.sourceEventId === latest.id && state.outcomes.some((item): boolean => item.reviewId === review.id && item.outcome !== "defer")),
    };
  });
  return { evidenceId: latest.evidence.id, sourceEventId: latest.id, questions: items.filter((item): boolean => item.impact.status === "affected" || item.impact.status === "unresolved").length, pendingReviews: items.filter((item): boolean => item.pending !== null).length, outcomes: state.outcomes.length, items };
}

function reviewMarkup(item: AttentionItem): string {
  const review = item.pending;
  if (review === null) return `<p class="attention-review" data-testid="attention-review-${item.decisionId}">${item.latestAlreadyReviewed ? "This exact latest capture already has a terminal outcome. Preserve it; capture later evidence before another review." : "No pending human review. Inspect the rule context before explicitly opening one."}</p>`;
  return `<div class="attention-review" data-testid="attention-review-${item.decisionId}"><strong>${item.deferred ? "Deferred · still pending" : "Pending human review"}</strong><p>Assigned ${escapeHtml(review.actor)} · frozen revision ${escapeHtml(review.basis.revision)} · ${escapeHtml(review.trigger)} at opening</p><details><summary>Exact review references</summary><p>Review <code>${escapeHtml(review.id)}</code><br />Target evidence <code>${escapeHtml(review.evidenceId)}</code><br />Target source event <code>${escapeHtml(review.sourceEventId)}</code></p></details><p>Later captures do not retarget this review.</p></div>`;
}

/** Render current-rule questions and frozen review obligations as separate, inspectable facts. */
export function renderWorkspaceAttention(state: SharedHistory): void {
  const overview = workspaceAttention(state);
  const labels: Readonly<Record<SharedImpact["status"], string>> = { affected: "Boundary needs reassessment", unresolved: "Applicability unresolved", unchanged: "No relevant change under this rule", inactive: "Withdrawn decision" };
  getElement("workspace-attention").innerHTML = `<dl class="attention-metrics"><div><dt>Decision paths</dt><dd>${overview.items.length}</dd></div><div><dt>Current rule questions</dt><dd data-testid="attention-questions">${overview.questions}</dd></div><div><dt>Pending human reviews</dt><dd data-testid="attention-pending">${overview.pendingReviews}</dd></div><div><dt>Recorded outcomes</dt><dd>${overview.outcomes}</dd></div></dl><details class="attention-source"><summary>Latest comparison references</summary><p>Evidence <code>${escapeHtml(overview.evidenceId)}</code><br />Source event <code>${escapeHtml(overview.sourceEventId)}</code></p><p>Counts describe the current rules and stored records. They do not establish safety, approval or runtime behavior.</p></details><div class="attention-list">${overview.items.map((item): string => `<article class="attention-item" data-testid="attention-item-${item.decisionId}"><div class="attention-item-heading"><h3>${escapeHtml(item.title)}</h3><span class="status ${item.impact.status}" data-testid="attention-impact-${item.decisionId}">${labels[item.impact.status]}</span></div><p>${escapeHtml(item.impact.explanation)}</p><p class="history-meta">Current basis ${escapeHtml(item.basis?.revision ?? "withdrawn")} · exact scope and references in the inspector</p>${reviewMarkup(item)}<div class="attention-actions"><button type="button" class="btn secondary compact" data-attention-decision="${escapeHtml(item.decisionId)}" data-testid="attention-inspect-${item.decisionId}">Inspect decision basis</button><button type="button" class="btn secondary compact" data-attention-review="${escapeHtml(item.decisionId)}" data-testid="attention-review-action-${item.decisionId}">Go to human review</button></div></article>`).join("")}</div>`;
}
