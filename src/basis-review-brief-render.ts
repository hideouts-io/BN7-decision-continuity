import type { BasisChangedFact, BasisReference, BasisRecordChange } from "./basis-comparison.ts";
import type { BasisReviewBrief, BasisReviewBriefFact, BasisReviewBriefSection } from "./basis-review-brief.ts";
import { escapeHtml } from "./render.ts";

type Side = "from" | "to";

function references(items: readonly BasisReference[], side: Side, key: string, context: string): string {
  const endpoint = side === "from" ? "From" : "To";
  if (items.length === 0) return '<p class="basis-brief-absence">No individual record reference in this selected cut.</p>';
  return `<details class="basis-brief-references"><summary data-testid="${escapeHtml(key)}-toggle">Inspect ${items.length} exact ${endpoint} records</summary>${items.map((item, index: number): string => `<button type="button" class="basis-reference" data-testid="${escapeHtml(key)}-${index}" data-basis-ref-side="${side}" data-basis-ref-kind="${item.kind}" data-basis-ref-id="${escapeHtml(item.id)}" aria-label="Inspect ${endpoint} ${item.kind} ${escapeHtml(item.id)} for ${escapeHtml(context)}">${escapeHtml(item.kind)} · ${escapeHtml(item.id)}</button>`).join("")}</details>`;
}

function headline(section: BasisReviewBriefSection, side: Side): BasisReviewBriefFact {
  const key = section.key === "decision" ? "active-scope" : section.key === "evidence" ? "known-declaration" : section.key === "questions" ? "questions-state" : "pending-review";
  const fact = section[side].find((item): boolean => item.key === key);
  if (fact === undefined) throw new ReferenceError(`The ${section.key} review brief is missing its exact ${side} ${key} summary.`);
  return fact;
}

function endpointFacts(section: BasisReviewBriefSection, side: Side): string {
  return `<section class="basis-brief-endpoint"><h5>${side === "from" ? "From" : "To"} selected state</h5><dl class="basis-brief-facts">${section[side].map((fact): string => `<div data-testid="basis-brief-${section.key}-${side}-${escapeHtml(fact.key)}" data-reference-ids="${escapeHtml(fact.references.map((item): string => item.id).join(","))}"><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}${references(fact.references, side, `basis-brief-ref-${section.key}-${side}-${fact.key}`, fact.label)}</dd></div>`).join("")}</dl></section>`;
}

function changes(section: BasisReviewBriefSection): string {
  if (section.changes.length === 0) return '<p class="basis-brief-absence">No changed facts between these selected cuts in this section.</p>';
  return `<dl class="basis-differences-list basis-brief-changes">${section.changes.map((fact: BasisChangedFact): string => `<div data-testid="basis-brief-${section.key}-change-${escapeHtml(fact.key)}" data-from-reference-ids="${escapeHtml(fact.fromReferences.map((item): string => item.id).join(","))}" data-to-reference-ids="${escapeHtml(fact.toReferences.map((item): string => item.id).join(","))}"><dt>${escapeHtml(fact.label)}</dt><dd><div class="basis-value"><small>From</small><p class="basis-value-text">${escapeHtml(fact.fromValue)}</p>${references(fact.fromReferences, "from", `basis-brief-change-ref-${section.key}-from-${fact.key}`, fact.label)}</div><div class="basis-value"><small>To</small><p class="basis-value-text">${escapeHtml(fact.toValue)}</p>${references(fact.toReferences, "to", `basis-brief-change-ref-${section.key}-to-${fact.key}`, fact.label)}</div></dd></div>`).join("")}</dl>`;
}

function recordChanges(section: BasisReviewBriefSection): string {
  if (section.recordChanges.length === 0) return "";
  return `<h5>Exact record membership changes</h5><ul class="basis-brief-records">${section.recordChanges.map((change: BasisRecordChange): string => {
    const kind = change.kind === "deferral" ? "outcome" : change.kind;
    return `<li data-testid="basis-brief-${section.key}-records-${change.kind}"><strong>${escapeHtml(change.kind)} records</strong><p>Present in To only · ${change.addedIds.length}</p>${references(change.addedIds.map((id): BasisReference => ({ kind, id })), "to", `basis-brief-record-ref-${section.key}-to-${change.kind}`, `${change.kind} records present in To only`)}<p>Present in From only · ${change.removedIds.length}</p>${references(change.removedIds.map((id): BasisReference => ({ kind, id })), "from", `basis-brief-record-ref-${section.key}-from-${change.kind}`, `${change.kind} records present in From only`)}</li>`;
  }).join("")}</ul>`;
}

function sectionMarkup(section: BasisReviewBriefSection): string {
  const from = headline(section, "from"), to = headline(section, "to");
  return `<article class="basis-brief-card" data-testid="basis-brief-${section.key}"><div class="basis-brief-card-heading"><h4>${escapeHtml(section.title)}</h4><span data-testid="basis-brief-${section.key}-change-count">${section.changes.length} changed facts</span></div><dl class="basis-brief-pair"><div><dt>From</dt><dd data-testid="basis-brief-${section.key}-from-summary">${escapeHtml(from.value)}</dd></div><div><dt>To</dt><dd data-testid="basis-brief-${section.key}-to-summary">${escapeHtml(to.value)}</dd></div></dl><details class="basis-brief-detail" data-testid="basis-brief-${section.key}-details"><summary data-testid="basis-brief-${section.key}-summary">Inspect all ${section.from.length + section.to.length} endpoint facts and ${section.changes.length} changes${section.recordChanges.length === 0 ? "" : ` · ${section.recordChanges.length} record groups`}</summary><div class="basis-brief-endpoints">${endpointFacts(section, "from")}${endpointFacts(section, "to")}</div><h5>Record-supported changes</h5>${changes(section)}${recordChanges(section)}</details></article>`;
}

/** Share one bounded, read-only explanation across live workspaces and frozen packet inspection. */
export function basisReviewBriefMarkup(brief: BasisReviewBrief): string {
  const direction = brief.direction === "forward" ? "Forward · To includes additional recorded events" : brief.direction === "backward" ? "Backward · To contains an earlier recorded cut" : "Same recorded cut";
  return `<div class="basis-brief-heading"><div><p class="eyebrow">Selected comparison / review brief</p><h3 id="basis-brief-title">This comparison, at a glance.</h3></div><p data-testid="basis-brief-direction" data-direction="${brief.direction}">${direction}</p></div><p class="basis-brief-introduction">Four record-supported views of the selected From and To states. Open a section for every fact, change and exact reference. Question satisfaction does not approve a decision; declarations do not establish runtime behavior.</p><div class="basis-brief-grid">${brief.sections.map(sectionMarkup).join("")}</div><details class="basis-brief-limits" data-testid="basis-brief-limitations"><summary>Interpretation limits · human responsibility remains</summary><ul>${brief.limitations.map((item): string => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`;
}
