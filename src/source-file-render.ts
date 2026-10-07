import { escapeHtml } from "./render.ts";
import { sourceFileArtifacts, sourceFileReceipt } from "./source-file.ts";
import type { SourceFileArtifact, previewSourceFile } from "./source-file.ts";
import type { SharedState } from "./shared-model.ts";
import type { ClarificationState } from "./clarification-model.ts";

type SourceFilePreview = ReturnType<typeof previewSourceFile>;

function facts(entries: readonly (readonly [string, string])[]): string {
  return `<dl class="shared-facts">${entries.map(([label, value]): string => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function artifactFacts(artifact: SourceFileArtifact): string {
  return facts([["Artifact format", `Synthetic source file v${artifact.artifactSchemaVersion}`], ["Canonical source UUID", artifact.sourceId], ["Declared source reference · not fetched", artifact.sourceReference], ["Declared revision · opaque identifier", artifact.revision], ["Declared source updated · UTC", artifact.sourceUpdatedAt], ["Declared captured · UTC", artifact.capturedAt], ["Requested permissions", artifact.requestedPermissions.join(", ")], ["Declared granted · independent", artifact.grantedPermissions.join(", ")], ["Declared deployment context", artifact.environment], ["Runtime", artifact.observedActivity], ["Provenance", artifact.provenance], ["Synthetic note", artifact.note]]);
}

function changeMarkup(id: string, label: string, values: readonly string[]): string {
  return `<div><dt>${label}</dt><dd data-testid="${id}">${values.length === 0 ? "None" : values.map(escapeHtml).join(", ")}</dd></div>`;
}

/** Candidate comparisons show prospective rule results without creating evidence, reviews or outcomes. */
export function sourceFilePreviewMarkup(preview: SourceFilePreview, state: SharedState | ClarificationState, checkedAt: string): string {
  const latest = state.sources.at(-1);
  if (latest === undefined || latest.id !== preview.sourceEventId || latest.evidence.id !== preview.evidenceId) throw new ReferenceError("The source candidate comparison requires its exact latest saved capture.");
  const status = preview.payloadStatus === "changed" ? "Monitored fields changed" : "Monitored fields unchanged";
  const labels = { affected: "Prospective · affected", unchanged: "Prospective · no relevant change", unresolved: "Prospective · applicability unresolved", inactive: "Prospective · withdrawn decision" } as const;
  return `<div class="source-file-preview-heading"><div><p class="eyebrow">Candidate only · nothing saved</p><h3>${status}</h3></div><span class="shared-status" data-testid="source-file-payload-status" data-status="${preview.payloadStatus}">${preview.payloadStatus}</span></div>
    <p class="history-meta">A new source revision can have unchanged monitored fields. Identity and notes do not execute dependency rules. An unchanged rule result supplies no safety or approval conclusion.</p>
    <div data-testid="source-file-preview-facts">${artifactFacts(preview.artifact)}${facts([["Compared latest source event", preview.sourceEventId], ["Compared latest evidence UUID", preview.evidenceId], ["Latest saved capture · UTC", latest.evidence.capturedAt], ["Latest saved recording · UTC", latest.recordedAt], ["Candidate checked locally · UTC", checkedAt], ["Recording boundary", "No new recording time or evidence UUID exists until explicit capture."]])}</div>
    <dl class="source-file-diff" aria-label="Candidate field changes">${changeMarkup("source-file-requested-added", "Requested · added", preview.changes.requestedAdded)}${changeMarkup("source-file-requested-removed", "Requested · removed", preview.changes.requestedRemoved)}${changeMarkup("source-file-granted-added", "Declared granted · added", preview.changes.grantedAdded)}${changeMarkup("source-file-granted-removed", "Declared granted · removed", preview.changes.grantedRemoved)}<div><dt>Declared context</dt><dd data-testid="source-file-environment-change">${escapeHtml(latest.evidence.environment)} → ${escapeHtml(preview.artifact.environment)}${preview.changes.environmentChanged ? " · changed" : " · unchanged"}</dd></div></dl>
    <section class="source-file-impacts" aria-label="Prospective decision impacts">${preview.impacts.map((impact, index: number): string => `<article class="source-file-impact shared-${impact.status}" data-testid="source-file-preview-decision-${index}" data-decision-id="${impact.decisionId}"><h4>${escapeHtml(impact.title)}</h4><span class="shared-status" data-testid="source-file-preview-status-${index}" data-status="${impact.status}">${labels[impact.status]}</span><p>${escapeHtml(impact.explanation)}</p></article>`).join("")}</section>
    <details class="source-file-artifact"><summary data-testid="source-file-artifact-toggle">Inspect the complete candidate receipt</summary><pre>${escapeHtml(sourceFileReceipt(preview.artifact))}</pre></details>
    <p class="history-meta">Declared timestamps and revision labels are consistency-checked, not authenticated. Revision labels do not establish causal order. The source reference is displayed as text and never fetched.</p>`;
}

/** Read-only receipts preserve the local artifact contract; older manual notes supply no revision metadata. */
export function sourceFileHistoryMarkup(state: SharedState | ClarificationState): string {
  const records = sourceFileArtifacts(state);
  if (records.length === 0) return "<p>No source-file receipt has been captured. Earlier manually entered notes remain intact; they contain no structured source revision or update-time facts.</p>";
  return `<p class="history-meta">${records.length} source-file receipt${records.length === 1 ? "" : "s"} preserved in existing evidence notes. Importing a history does not authenticate these declarations; intake validates the marked receipt contract again.</p><ol class="source-file-receipts">${records.map((record, index: number): string => `<li data-testid="source-file-receipt-${index}" data-source-event-id="${record.sourceEventId}" data-evidence-id="${record.evidenceId}"><h4>${escapeHtml(record.artifact.revision)}</h4><p class="history-meta">${escapeHtml(record.artifact.sourceReference)} · Runtime Not observed.</p><details><summary data-testid="source-file-receipt-toggle-${index}">Inspect source declarations and exact saved references</summary>${artifactFacts(record.artifact)}${facts([["Preserved source event UUID", record.sourceEventId], ["Preserved evidence UUID", record.evidenceId], ["Recorded locally · UTC", record.recordedAt]])}<pre>${escapeHtml(sourceFileReceipt(record.artifact))}</pre></details></li>`).join("")}</ol><p class="history-meta">Receipts establish inspectable declared identity and byte-preserving history, not source authenticity, runtime behavior or a decision outcome. Unmarked earlier notes retain their original meaning.</p>`;
}
