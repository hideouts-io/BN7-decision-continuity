import type { BasisReceiptContext, BasisReceiptRole } from "./basis-receipts.ts";
import { escapeHtml } from "./render.ts";

type Side = "from" | "to";
type Fact = readonly [string, string, string];

function roleLabel(role: BasisReceiptRole): string {
  if (role === "support") return "Active decision's supporting capture";
  if (role === "known") return "Latest capture known at this endpoint";
  return "Pending review's frozen target";
}

function facts(prefix: string, entries: readonly Fact[]): string {
  return `<dl class="basis-facts">${entries.map(([key, label, value]): string => `<div><dt>${escapeHtml(label)}</dt><dd data-testid="${prefix}-${key}">${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function exactCapture(context: Exclude<BasisReceiptContext, { status: "absent" }>, side: Side, prefix: string): string {
  const capture = context.capture, evidence = capture.evidence;
  const endpoint = side === "from" ? "From" : "To";
  return `${facts(prefix, [
    ["source", "Canonical source UUID", evidence.sourceId], ["source-event", "Exact source event UUID", capture.id],
    ["evidence", "Exact evidence UUID", evidence.id], ["captured-at", "Declared capture time · UTC", evidence.capturedAt],
    ["recorded-at", "Capture recorded · UTC", capture.recordedAt],
  ])}<div class="basis-difference-references"><button type="button" class="basis-reference" data-testid="${prefix}-source-event-ref" data-basis-ref-side="${side}" data-basis-ref-kind="source-event" data-basis-ref-id="${escapeHtml(capture.id)}" aria-label="Inspect ${endpoint} ${escapeHtml(roleLabel(context.role))} source event ${escapeHtml(capture.id)}">Inspect the exact source event</button><button type="button" class="basis-reference" data-testid="${prefix}-evidence-ref" data-basis-ref-side="${side}" data-basis-ref-kind="evidence" data-basis-ref-id="${escapeHtml(evidence.id)}" aria-label="Inspect ${endpoint} ${escapeHtml(roleLabel(context.role))} evidence ${escapeHtml(evidence.id)}">Inspect the exact evidence</button></div>`;
}

function declaration(context: Extract<BasisReceiptContext, { status: "declared" }>, prefix: string): string {
  const artifact = context.artifact;
  return facts(prefix, [
    ["reference", "Declared source reference · never fetched", artifact.sourceReference],
    ["revision", "Declared revision · opaque label", artifact.revision], ["updated-at", "Declared source update · UTC", artifact.sourceUpdatedAt],
    ["requested", "Requested access", artifact.requestedPermissions.join(", ")], ["granted", "Declared granted access", artifact.grantedPermissions.join(", ")],
    ["environment", "Declared deployment context", artifact.environment], ["provenance", "Provenance", artifact.provenance],
    ["runtime", "Runtime", artifact.observedActivity], ["note", "Preserved declaration note", artifact.note],
  ]);
}

function receipt(context: BasisReceiptContext, side: Side): string {
  const prefix = `basis-receipt-${side}-${context.role}`;
  const title = roleLabel(context.role);
  const heading = `<h4>${escapeHtml(title)}</h4><p data-testid="${prefix}-status">${escapeHtml(context.status === "declared" ? "Declared receipt · exact capture validated" : context.status === "manual" ? "Unmarked capture · receipt metadata not recorded" : context.status === "invalid" ? "Invalid reserved receipt · declaration unavailable" : "No capture for this role")}</p><p class="basis-note" data-testid="${prefix}-message">${escapeHtml(context.message)}</p>`;
  const details = context.status === "absent" ? "" : `<details><summary data-testid="${prefix}-toggle">Inspect exact capture${context.status === "declared" ? " and source declaration" : ""}</summary>${exactCapture(context, side, prefix)}${context.status === "declared" ? declaration(context, prefix) : ""}</details>`;
  return `<article class="basis-block" data-testid="${prefix}" data-status="${context.status}" data-source-event-id="${escapeHtml(context.capture?.id ?? "")}" data-evidence-id="${escapeHtml(context.capture?.evidence.id ?? "")}">${heading}${details}</article>`;
}

function supportStatus(contexts: readonly BasisReceiptContext[]): string {
  const support = contexts.find((context): boolean => context.role === "support"), known = contexts.find((context): boolean => context.role === "known");
  if (support === undefined || known === undefined) throw new ReferenceError("Source receipt context requires exact supporting and latest-known roles.");
  if (support.capture === null) return "The decision is withdrawn at this endpoint; no active supporting capture remains. Earlier evidence is preserved below.";
  if (known.capture === null) throw new ReferenceError("A recorded decision endpoint requires its latest known capture.");
  return support.capture.id === known.capture.id
    ? "The active decision is supported by the latest capture known at this endpoint. This relationship supplies no source authentication or runtime assurance."
    : "The active supporting capture differs from the latest capture known at this endpoint. Later known evidence does not replace the decision's recorded support or a pending review's frozen target.";
}

/** Present exact role-bound receipts; absent, unmarked and invalid metadata never borrow another capture's declaration. */
export function basisReceiptContextsMarkup(contexts: readonly BasisReceiptContext[], side: Side): string {
  return `<section class="basis-block" data-testid="basis-receipts-${side}" aria-label="${side === "from" ? "From" : "To"} source receipt context"><h4>Source declarations at this recorded endpoint</h4><p class="basis-note" data-testid="basis-receipt-${side}-support-status">${escapeHtml(supportStatus(contexts))}</p>${contexts.map((context): string => receipt(context, side)).join("")}<p class="basis-note">Receipt validity means agreement with its exact enclosing evidence. Revision labels and times are declarations; they do not authenticate a source, prove stream order, fetch upstream data or observe runtime activity.</p></section>`;
}
