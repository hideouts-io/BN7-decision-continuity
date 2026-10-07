import type { BasisChangedFact, BasisComparison, BasisReference, BasisRecordChange } from "./basis-comparison.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { escapeHtml } from "./render.ts";

type Side = "from" | "to";

function references(items: readonly BasisReference[], side: Side, key: string, context: string): string {
  if (items.length === 0) return `<div class="basis-difference-references" data-testid="basis-difference-${key}-${side}-refs"><small>No record in this selected perspective.</small></div>`;
  const endpoint = side === "from" ? "From" : "To";
  return `<details class="basis-difference-references" data-testid="basis-difference-${key}-${side}-refs"><summary data-testid="basis-refs-${side}-${key}-toggle">Inspect ${items.length} exact ${endpoint} records</summary>${items.map((item, index: number): string => `<button type="button" class="basis-reference" data-testid="basis-ref-${side}-${key}-${index}" data-basis-ref-side="${side}" data-basis-ref-kind="${item.kind}" data-basis-ref-id="${escapeHtml(item.id)}" aria-label="Inspect ${endpoint} ${item.kind} ${escapeHtml(item.id)} for ${escapeHtml(context)}">${escapeHtml(item.kind)} · ${escapeHtml(item.id)}</button>`).join("")}</details>`;
}

function endpointCut(inspection: BasisInspection, side: Side): string {
  const event = inspection.event;
  return `<details class="basis-cut-details" data-testid="basis-${side}-cut"><summary>${side === "from" ? "From" : "To"} · exact event cut</summary><p>${event === null ? "Latest recorded state · all decision-related events" : `${escapeHtml(event.label)} · ${escapeHtml(event.id)} · recorded ${escapeHtml(event.recordedAt)}`}</p><dl class="basis-facts"><div><dt>Included canonical event UUIDs · ${inspection.includedEventIds.length}</dt><dd data-testid="basis-${side}-included">${escapeHtml(inspection.includedEventIds.join(", "))}</dd></div><div><dt>Excluded canonical event UUIDs · ${inspection.excludedEventIds.length}</dt><dd data-testid="basis-${side}-excluded">${escapeHtml(inspection.excludedEventIds.join(", ") || "None")}</dd></div></dl></details>`;
}

function recordChange(change: BasisRecordChange): string {
  const kind = change.kind === "deferral" ? "outcome" : change.kind;
  return `<li data-testid="basis-record-change-${change.kind}"><h4>${escapeHtml(change.kind)} records</h4><p>Present in To only · ${change.addedIds.length}</p>${references(change.addedIds.map((id): BasisReference => ({ kind, id })), "to", `records-${change.kind}-added`, `${change.kind} records present in To only`)}<p>Present in From only · ${change.removedIds.length}</p>${references(change.removedIds.map((id): BasisReference => ({ kind, id })), "from", `records-${change.kind}-removed`, `${change.kind} records present in From only`)}</li>`;
}

function changedFactsMarkup(facts: readonly BasisChangedFact[]): string {
  return facts.map((fact): string => `<div data-testid="basis-difference-${fact.key}" data-from-reference-ids="${escapeHtml(fact.fromReferences.map((reference): string => reference.id).join(","))}" data-to-reference-ids="${escapeHtml(fact.toReferences.map((reference): string => reference.id).join(","))}"><dt>${escapeHtml(fact.label)}</dt><dd><div class="basis-value"><small>From</small><p class="basis-value-text">${escapeHtml(fact.fromValue)}</p>${references(fact.fromReferences, "from", fact.key, fact.label)}</div><div class="basis-value"><small>To</small><p class="basis-value-text">${escapeHtml(fact.toValue)}</p>${references(fact.toReferences, "to", fact.key, fact.label)}</div></dd></div>`).join("");
}

function receiptDifferences(comparison: BasisComparison): string {
  const facts = changedFactsMarkup(comparison.receiptChanges);
  return `<section class="basis-block" data-testid="basis-receipt-changes"><h4>Exact source declaration changes</h4><p data-testid="basis-receipt-change-count">${comparison.receiptChanges.length} changed receipt facts across supporting, latest-known and frozen-review captures.</p>${facts.length === 0 ? "<p>No receipt context changes between these selected endpoints.</p>" : `<dl class="basis-differences-list">${facts}</dl>`}<p class="basis-note">Each fact cites its exact endpoint capture. Opaque revisions and declared update times are compared as recorded values; they do not establish comparison direction or upstream freshness. Missing or invalid receipts remain explicit.</p></section>`;
}

/** Explain only the selected cuts; the inspector's inherited latest snapshot is never rendered here. */
export function basisComparisonMarkup(comparison: BasisComparison): string {
  const direction = comparison.direction === "forward" ? "Forward · To contains later recorded events" : comparison.direction === "backward" ? "Backward · To contains an earlier recorded perspective" : "Same recorded perspective";
  const differences = changedFactsMarkup(comparison.changedFacts);
  return `<h3>What changed between these recorded states?</h3><div class="basis-comparison-summary" data-testid="basis-comparison-summary" data-direction="${comparison.direction}"><strong>${direction}</strong><p>${comparison.changedFacts.length} changed basis facts · ${comparison.receiptChanges.length} changed receipt facts · ${comparison.addedEventIds.length} events in To only · ${comparison.removedEventIds.length} events in From only.</p><p>Direction describes the included event sets. Exploring an earlier perspective removes nothing from saved history.</p></div>${receiptDifferences(comparison)}${differences.length === 0 ? "<p>The selected perspectives have the same recorded basis, evidence and review history.</p>" : `<dl class="basis-differences-list">${differences}</dl>`}<details class="basis-block"><summary>Exact review and outcome membership changes · ${comparison.recordChanges.length}</summary>${comparison.recordChanges.length === 0 ? "<p>No record membership changes.</p>" : `<ul class="basis-record-changes">${comparison.recordChanges.map(recordChange).join("")}</ul>`}</details><details class="basis-block" data-testid="basis-preserved-rules"><summary data-testid="basis-preserved-rules-toggle">Original assumptions and explicit rules · preserved at both endpoints</summary><dl class="basis-facts">${comparison.preservedOriginalRules.map((rule): string => `<div><dt>${escapeHtml(rule.label)}</dt><dd>${escapeHtml(rule.value)}${references(rule.references, "from", `rule-${rule.key}`, rule.label)}${references(rule.references, "to", `rule-${rule.key}`, rule.label)}</dd></div>`).join("")}</dl><p class="basis-note">These are the original recorded assumptions. Historical rule versions were not recorded; this comparison does not run current rules against old evidence.</p></details><div class="basis-endpoint-cuts">${endpointCut(comparison.from, "from")}${endpointCut(comparison.to, "to")}</div><p class="basis-note">Every reference opens a preserved record in its selected endpoint. Deferral and review replacement confer no approval. Declarations supply no runtime assurance; consequential outcomes require accountable human review.</p>`;
}
