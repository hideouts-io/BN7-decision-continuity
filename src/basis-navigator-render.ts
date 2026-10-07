import type { BasisNavigator, BasisNavigatorEndpoint, BasisNavigatorNode } from "./basis-navigator.ts";
import type { BasisEvent } from "./basis-events.ts";
import type { BasisReference } from "./basis-comparison.ts";
import { escapeHtml } from "./render.ts";

type Side = "from" | "to";
const kindLabels: Readonly<Record<BasisEvent["kind"], string>> = {
  original: "Original basis", capture: "Evidence capture", review: "Human review", outcome: "Decision outcome",
  replacement: "Replacement + review · atomic", requirement: "Evidence question", resolution: "Human evidence response",
};

function membership(endpoint: BasisNavigatorEndpoint, included: boolean, selected: boolean): string {
  const state = endpoint.status === "unavailable" ? "perspective unavailable" : included ? "included" : "outside this perspective";
  return `${selected ? "selected · " : ""}${state}`;
}
function recordReferences(event: BasisEvent): readonly BasisReference[] {
  if (event.kind === "original") return [{ kind: "source-event", id: event.id }, ...event.memberIds.filter((id): boolean => id !== event.id).map((id): BasisReference => ({ kind: "decision", id }))];
  if (event.kind === "capture") return [{ kind: "source-event", id: event.id }];
  if (event.kind === "replacement") return [{ kind: "replacement", id: event.id }, ...event.memberIds.filter((id): boolean => id !== event.id).map((id): BasisReference => ({ kind: "review", id }))];
  return [{ kind: event.kind, id: event.id }];
}
function openRecords(node: BasisNavigatorNode, side: Side, endpoint: BasisNavigatorEndpoint): string {
  const included = side === "from" ? node.fromIncluded : node.toIncluded;
  if (endpoint.status !== "available" || !included) return "";
  return recordReferences(node.event).map((reference, index: number): string => `<button type="button" class="basis-reference" id="basis-nav-open-${side}-${node.event.id}-${index}" data-testid="basis-nav-open-${side}-${node.event.id}-${index}" data-basis-ref-side="${side}" data-basis-ref-kind="${reference.kind}" data-basis-ref-id="${escapeHtml(reference.id)}" aria-label="Open ${side === "from" ? "From" : "To"} ${reference.kind} ${escapeHtml(reference.id)}">Open ${side === "from" ? "From" : "To"} ${reference.kind} record →</button>`).join("");
}
function nodeMarkup(node: BasisNavigatorNode, navigator: BasisNavigator): string {
  const event = node.event, fromState = navigator.from.status === "unavailable" ? "unavailable" : node.fromIncluded ? "included" : "excluded";
  const toState = navigator.to.status === "unavailable" ? "unavailable" : node.toIncluded ? "included" : "excluded";
  const predecessors = event.predecessorIds.map((id): string => {
    const predecessor = navigator.groups.flatMap((group): readonly BasisNavigatorNode[] => group.nodes).find((item): boolean => item.event.id === id);
    if (predecessor === undefined) throw new ReferenceError(`The event navigator requires exact predecessor ${id}.`);
    return `<li>${escapeHtml(predecessor.event.label)}<code>${escapeHtml(id)}</code></li>`;
  }).join("");
  return `<li class="basis-nav-node" id="basis-nav-event-${event.id}" data-testid="basis-nav-event-${event.id}" data-event-id="${escapeHtml(event.id)}" data-kind="${event.kind}" data-from-state="${fromState}" data-to-state="${toState}" data-from-selected="${node.fromSelected}" data-to-selected="${node.toSelected}"><p class="basis-nav-kind">${kindLabels[event.kind]}</p><h5>${escapeHtml(event.label)}</h5><div class="basis-nav-membership"><span>From: ${escapeHtml(membership(navigator.from, node.fromIncluded, node.fromSelected))}</span><span>To: ${escapeHtml(membership(navigator.to, node.toIncluded, node.toSelected))}</span></div><div class="basis-nav-actions">${(["from", "to"] as const).map((side): string => `<button type="button" class="basis-nav-select" id="basis-nav-${side}-${event.id}" data-testid="basis-nav-${side}-${event.id}" data-basis-nav-side="${side}" data-basis-nav-event-id="${escapeHtml(event.id)}" aria-pressed="${side === "from" ? node.fromSelected : node.toSelected}" aria-label="Set ${side === "from" ? "From" : "To"} to ${escapeHtml(event.label)} ${escapeHtml(event.id)}">Set ${side === "from" ? "From" : "To"}</button>`).join("")}</div>${node.ambiguousWith.length === 0 ? "" : '<p class="basis-nav-ambiguity">Same recorded time without a proven order. Selecting this event cannot establish a historical endpoint; Latest remains available.</p>'}<details id="basis-nav-details-${event.id}"><summary id="basis-nav-details-toggle-${event.id}" data-testid="basis-nav-details-${event.id}">Exact records &amp; causal predecessors</summary><dl class="basis-facts"><div><dt>Canonical event UUID</dt><dd>${escapeHtml(event.id)}</dd></div><div><dt>Recorded · UTC</dt><dd>${escapeHtml(event.recordedAt)}</dd></div><div><dt>Atomic member UUIDs</dt><dd>${escapeHtml(event.memberIds.join(", "))}</dd></div><div><dt>Unordered same-time peers</dt><dd>${escapeHtml(node.ambiguousWith.join(", ") || "None")}</dd></div></dl><p class="basis-nav-edge-label">Direct recorded predecessors</p>${predecessors.length === 0 ? '<p class="basis-note">No preceding recorded dependency.</p>' : `<ul class="basis-nav-predecessors">${predecessors}</ul>`}<div class="basis-nav-open-records">${openRecords(node, "from", navigator.from)}${openRecords(node, "to", navigator.to)}</div></details></li>`;
}
function latest(endpoint: BasisNavigatorEndpoint, side: Side): string {
  const selected = endpoint.requestedId === "latest";
  return `<button type="button" class="basis-nav-select" id="basis-nav-${side}-latest" data-testid="basis-nav-${side}-latest" data-basis-nav-side="${side}" data-basis-nav-event-id="latest" aria-pressed="${selected}">Set ${side === "from" ? "From" : "To"} to Latest</button>`;
}

function endpointSummary(endpoint: BasisNavigatorEndpoint, navigator: BasisNavigator): string {
  if (endpoint.requestedId === "latest") return `Latest · ${navigator.groups.reduce((count: number, group): number => count + group.nodes.length, 0)} recorded events`;
  if (endpoint.canonicalEventId === null) return "Requested event unavailable; no perspective substituted";
  const node = navigator.groups.flatMap((group): readonly BasisNavigatorNode[] => group.nodes).find((item): boolean => item.event.id === endpoint.canonicalEventId);
  if (node === undefined) throw new ReferenceError("A navigator endpoint requires its exact selected event card.");
  return `${node.event.label}${endpoint.status === "unavailable" ? " · ambiguous recorded time; perspective unavailable" : ""}`;
}

/** A compact recorded-event map exposes causal facts; card position within one time bucket establishes no order. */
export function basisNavigatorMarkup(navigator: BasisNavigator): string {
  return `<div class="basis-nav-heading"><div><p class="eyebrow">Explore the recorded sequence</p><h3 id="basis-navigator-title">Follow a change. Choose two perspectives.</h3></div><div class="basis-nav-actions">${latest(navigator.from, "from")}${latest(navigator.to, "to")}</div></div><p id="basis-navigator-help" class="basis-note">This map contains all recorded events for the selected decision; From / To labels show perspective membership. Same-time card positions do not prove causal order. Open exact records through an endpoint that includes them. Nothing is saved.</p><div class="basis-nav-status" aria-live="polite"><p data-testid="basis-nav-from-status">From · ${escapeHtml(endpointSummary(navigator.from, navigator))}</p><p data-testid="basis-nav-to-status">To · ${escapeHtml(endpointSummary(navigator.to, navigator))}</p></div><details id="basis-nav-selection-details" class="basis-nav-selection-details"><summary id="basis-nav-selection-details-toggle" data-testid="basis-nav-selection-details-toggle">Exact selected perspectives</summary><dl class="basis-facts">${(["from", "to"] as const).map((side): string => `<div><dt>${side === "from" ? "From" : "To"} requested selection</dt><dd>${escapeHtml(navigator[side].requestedId)}</dd></div><div><dt>${side === "from" ? "From" : "To"} recorded perspective</dt><dd>${escapeHtml(navigator[side].message)}</dd></div>`).join("")}</dl></details><div id="basis-nav-scroll" data-testid="basis-nav-scroll" class="basis-nav-scroll" tabindex="0" role="region" aria-label="Recorded event cards" aria-describedby="basis-navigator-help">${navigator.groups.map((group, index: number): string => `<section class="basis-nav-group" data-testid="basis-nav-group-${index}" aria-labelledby="basis-nav-group-title-${index}"><h4 id="basis-nav-group-title-${index}"><time datetime="${escapeHtml(group.recordedAt)}">${escapeHtml(group.recordedAt)}</time>${group.nodes.length > 1 ? '<span>Same recorded instant · inspect causal references</span>' : ""}</h4><ul class="basis-nav-nodes">${group.nodes.map((node): string => nodeMarkup(node, navigator)).join("")}</ul></section>`).join("")}</div>`;
}
