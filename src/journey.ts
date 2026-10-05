import type { DemoState } from "./model.ts";
import { getEvidence, requiresReview } from "./scenario.ts";
import type { Outcome } from "./scenario.ts";

export type JourneyStage = "evidence" | "impact" | "review" | "history";
export type SectionTarget = "decision" | "evidence" | "impact" | "review" | "decision-history";
export type NavigationAction = Readonly<{ label: string; target: SectionTarget }>;
export type Journey = Readonly<{
  stage: JourneyStage;
  status: string;
  title: string;
  description: string;
  next: NavigationAction;
  evidenceStatus: string;
  impactStatus: string;
  reviewStatus: string;
  historyStatus: string;
  reviewGuidance: string;
  reviewNext: NavigationAction;
}>;

export function outcomeLabel(outcome: Outcome): string {
  const labels: Readonly<Record<Outcome, string>> = {
    reaffirm: "Reaffirmed", revise: "Revised", withdraw: "Withdrawn", defer: "Deferred — more evidence needed",
  };
  return labels[outcome];
}

/** Explain the selected human action without recommending an outcome. */
export function outcomeExplanation(outcome: Outcome | ""): string {
  if (outcome === "") return "Choose what your review supports. Reaffirm keeps the approval, revise changes its scope, withdraw removes it, and defer leaves the review open.";
  const explanations: Readonly<Record<Outcome, string>> = {
    reaffirm: "Reaffirm keeps the approval. Explain why it remains justified despite the new request and what limits still apply.",
    revise: "Revise changes the decision scope. Describe the new scope and why the evidence supports it; the original approval stays in history.",
    withdraw: "Withdraw records that the approval no longer applies. Explain the reason and resulting scope. This demo does not revoke real access.",
    defer: "Defer leaves the review open. State what evidence is needed and the interim scope. A later outcome will append to this record.",
  };
  return explanations[outcome];
}

/** Describe the next useful inspection from validated records, never from navigation or guessed completion. */
export function journeyForState(state: DemoState): Journey {
  const affected: boolean = requiresReview(getEvidence(state.selectedEvidenceId));
  const latest = state.outcomes.at(-1);
  const context: Pick<Journey, "evidenceStatus" | "impactStatus" | "reviewStatus" | "historyStatus"> = {
    evidenceStatus: state.selectedEvidenceId === "EV-001" ? "Original selected" : (affected ? "Write request selected" : "Control selected"),
    impactStatus: affected ? "Assumption challenged" : "Original basis supported",
    reviewStatus: latest !== undefined ? outcomeLabel(latest.outcome) : (state.review !== null ? "Awaiting your outcome" : (affected ? "Suggested; not opened" : "Not opened")),
    historyStatus: state.outcomes.length === 0 ? "Original preserved" : `${state.outcomes.length} human ${state.outcomes.length === 1 ? "outcome" : "outcomes"} preserved`,
  };
  if (latest !== undefined && latest.outcome !== "defer") {
    return {
      ...context, stage: "history", status: "Human outcome recorded", title: "Your review has a traceable outcome.",
      description: "Inspect the original approval, reviewed evidence, and your reasoning together. Changing the selected comparison does not overwrite this outcome.",
      next: { label: "Inspect decision history", target: "decision-history" },
      reviewGuidance: `${outcomeLabel(latest.outcome)} is recorded for EV-002. This demonstration keeps a final outcome intact; start a new session to rehearse another choice.`,
      reviewNext: { label: "Inspect the recorded outcome", target: "decision-history" },
    };
  }
  if (state.review !== null) {
    if (!affected) {
      return {
        ...context, stage: "evidence", status: "Review still open", title: "An unchanged comparison does not close an open review.",
        description: "REV-001 concerns the write request in EV-002. Load that version again to continue the review; the selected control and earlier records remain preserved.",
        next: { label: "Return to reviewed evidence", target: "evidence" },
        reviewGuidance: "The review of EV-002 is still open. The current comparison does not resolve it. Select the write-access request to resume the outcome form.",
        reviewNext: { label: "Select the reviewed version", target: "evidence" },
      };
    }
    return {
      ...context, stage: "review", status: latest === undefined ? "Human review open" : "Deferred review",
      title: latest === undefined ? "The evidence is ready. You decide what follows." : "More evidence is needed before a final outcome.",
      description: latest === undefined
        ? "Act as the designated synthetic reviewer. Choose an outcome, explain the limits of the evidence, and state the scope or next step. Opening the review has not changed the decision."
        : "Your deferral remains in history. Continue only when you can explain the next outcome; a later record will append without replacing the deferral.",
      next: { label: latest === undefined ? "Record a human outcome" : "Continue the open review", target: "review" },
      reviewGuidance: "Morgan Lee is the fixed synthetic reviewer. Assess what the request establishes, what is unobserved, and what further evidence you need. The app does not choose an outcome.",
      reviewNext: { label: "Reinspect the evidence link", target: "impact" },
    };
  }
  if (affected) {
    return {
      ...context, stage: "impact", status: "Review suggested", title: "A changed request affects the original approval.",
      description: "The added write request challenges the read-only assumption. Trace the explicit link before opening a review. A request does not establish granted access or runtime activity.",
      next: { label: "Explore the evidence link", target: "impact" },
      reviewGuidance: "EV-002 adds a write request linked to the original approval. Inspect why it matters, then open the assigned review. Opening it records no decision outcome.",
      reviewNext: { label: "Inspect why this is linked", target: "impact" },
    };
  }
  if (state.selectedEvidenceId === "EV-003") {
    return {
      ...context, stage: "evidence", status: "No relevant change", title: "A new version can leave the decision basis unchanged.",
      description: "The control has a new version label with the same permission content. This comparison creates no review. Try the changed request to inspect a reason for reassessment.",
      next: { label: "Compare the changed request", target: "evidence" },
      reviewGuidance: "The selected permission content matches the original basis, so this narrow rule suggests no review. Choose the write-access example to explore the changed case.",
      reviewNext: { label: "Choose the changed comparison", target: "evidence" },
    };
  }
  return {
    ...context, stage: "evidence", status: "Start with the original decision", title: "Understand what was approved—and why.",
    description: "The assistant was approved for read-only summarization. Inspect that approval, then compare the unchanged control and the later write request. Every outcome is a person's responsibility.",
    next: { label: "Inspect original approval", target: "decision" },
    reviewGuidance: "No incoming version has been selected. Choose a comparison first to understand whether the original approval needs reassessment.",
    reviewNext: { label: "Choose a comparison", target: "evidence" },
  };
}
