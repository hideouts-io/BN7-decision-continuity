import { COMPARISON_PACKET_NOTICE } from "./comparison-packet.ts";
import type { ComparisonPacketInspection } from "./comparison-packet.ts";
import { escapeHtml } from "./render.ts";

/** Describe frozen endpoints and archive limits without treating declarations as authenticated evidence. */
export function comparisonPacketMetadataMarkup(inspection: ComparisonPacketInspection): string {
  const packet = inspection.packet, record = inspection.comparison.from.historical.record;
  const endpoint = (side: "from" | "to"): string => {
    const selected = packet[side], event = inspection.comparison[side].event;
    if (selected.selection === "frozen-latest") return `Frozen latest within exported cut · ${selected.includedEventIds.length} included canonical events`;
    if (event === null) throw new ReferenceError(`The ${side} packet endpoint is missing its selected recorded event.`);
    return `${event.label} · ${selected.eventId} · recorded ${event.recordedAt}`;
  };
  const journal = packet.packetSchemaVersion === 2
    ? `<div><dt>Included clarification journal</dt><dd data-testid="packet-journal-counts">${packet.clarification.requirements.length} requirements · ${packet.clarification.resolutions.length} human responses</dd></div><div><dt>Continuation envelope UUID</dt><dd data-testid="packet-continuation-id">${escapeHtml(packet.clarification.id)}</dd></div><div><dt>Envelope created · UTC</dt><dd data-testid="packet-continuation-created-at">${escapeHtml(packet.clarification.createdAt)}</dd></div>`
    : "";
  const journalBoundary = packet.packetSchemaVersion === 2
    ? "Evidence questions and human responses are included only inside the selected cuts. The continuation envelope timestamp is metadata; it does not prove a question existed earlier. A satisfied requirement supplies no approval or decision change."
    : "The v7 evidence-requirement journal is excluded from this v1 packet.";
  return `<p class="eyebrow">02 / Validated included records</p><h2 id="packet-result-title">${escapeHtml(record.decision.title)}</h2><dl class="basis-facts"><div><dt>Packet contract</dt><dd data-testid="packet-contract">Selected comparison · v${packet.packetSchemaVersion}</dd></div><div><dt>Created · UTC</dt><dd data-testid="packet-created-at">${escapeHtml(packet.createdAt)}</dd></div><div><dt>Decision UUID</dt><dd data-testid="packet-decision-id">${escapeHtml(packet.decisionId)}</dd></div><div><dt>Source history UUID</dt><dd data-testid="packet-history-id">${escapeHtml(inspection.archive.id)}</dd></div><div><dt>From endpoint</dt><dd data-testid="packet-from-endpoint">${escapeHtml(endpoint("from"))}</dd></div><div><dt>To endpoint</dt><dd data-testid="packet-to-endpoint">${escapeHtml(endpoint("to"))}</dd></div><div><dt>Included archive</dt><dd data-testid="packet-record-counts">${inspection.archive.originalDecisions.length} decision · ${inspection.archive.sources.length} captures · ${inspection.archive.reviews.length} reviews · ${inspection.archive.outcomes.length} outcomes · ${inspection.archive.replacements.length} replacements</dd></div>${journal}</dl><p class="packet-boundary" data-testid="packet-boundary">${escapeHtml(COMPARISON_PACKET_NOTICE)}</p><p class="basis-note">This explanation is derived again from validated records. Event cuts and excluded-event lists refer only to the included packet archive; omitted upstream records are not proved absent. A frozen latest endpoint does not refresh a live or saved workspace. Other decisions and records outside both selected cuts are excluded. ${journalBoundary} Historical rule versions were not recorded. An assigned fictional code does not authenticate a person or demonstrate practitioner participation.</p>`;
}
