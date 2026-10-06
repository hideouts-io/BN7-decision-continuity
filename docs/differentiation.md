# Differentiation hypothesis

Primary documentation reviewed October 6, 2026. This bounded comparison describes documented capabilities, not a complete evaluation of the products, commercial demand or proof of uniqueness.

| Approach | Documented overlap | Proposed Decision Continuity distinction / evidence boundary |
| --- | --- | --- |
| [MADR 4.0 template](https://github.com/adr/madr/blob/4.0.0/template/adr-template.md) | Decision context, alternatives, rationale, responsible people, confirmation and a superseded-by status. Supersession is an established idea. | Our hypothesis concerns executable consistency between two frozen evidence targets, a preserved deferral, an explicit review replacement and independent decision outcomes. The template itself does not specify that runtime contract; this does not establish what surrounding ADR tooling can support. |
| [DataHub impact analysis](https://support.datahub.com/hc/en-us/articles/50281784462363-Generating-Impact-Analysis-and-Lineage-Reports) | Upstream/downstream table and column dependencies, filtered impact views, report exports and programmatic transformation paths. | Our target is a human decision's field/scope/boundary and the unanswered question behind its review, rather than data-model dependency alone. That is a product-focus inference; the article is not an exhaustive account of DataHub governance. |
| [IBM watsonx governance use cases](https://www.ibm.com/docs/en/watsonx/w-and-w/2.3.x?topic=console-creating-use-cases-viewing-models) | The primary documentation's indexed text describes Factsheets associations, risk/applicability assessments, stakeholder approval and configurable lifecycle workflows. | An explicit old-review/new-review handoff tied to immutable captures is our narrowly testable contract. The indexed page does not establish whether configurable IBM workflows already implement it. Direct page retrieval returned HTTP 403; only its indexed primary text was available. |

The hypothesis: when applicability was unresolved, a reviewer can explain exactly what a later declaration clarified, why a separate review replaced the earlier question, and which decision scope remains in force. A replacement must preserve both frozen targets and the prior deferral without implying approval. Technical tests can establish this contract; practitioners must establish whether its clarity is worth the capture and link-maintenance effort.

The distinguishing combination under investigation is one canonical source, independently scoped decision rules, preserved uncertainty, explicit responsible replacement, and reconstructible frozen review context. These components have precedents. No claim that the combination is unique or groundbreaking is established by this comparison.

## Strongest subsequent capability

Recommend a bounded read-only view of what supported one decision at a selected recorded event. The current replacement inspector preserves individual frozen questions but is not general historical replay. Reconstructing the applicable scope, exact evidence, accepted boundary and unresolved reviews at that event would make the central question directly inspectable.

Prerequisites: validated event ordering, an explicit rule for equal timestamps using event references, and pure derivation from preserved records. Current local histories have separate arrays, not a complete globally ordered event log; do not assume timestamps alone establish every intermediate state. Compare the selected event with the latest basis and label the time perspective clearly.

Cheapest useful experiment: a four-event public/synthetic case, with one revision and one later clarification. Ask a person to reconstruct the earlier scope and identify information that was unavailable then, using the current inspector and the proposed view. Measure correct reconstruction, assistance and effort only during an actual session. An automated oracle can verify event derivation but cannot establish comprehension or benefit.

Hypothetical withdrawal analysis requires a defined source-withdrawal contract and multiple justified dependencies. Evidence-gap recommendations require a vocabulary of required evidence and reliable applicability rules. Both are valuable later hypotheses; neither should be inferred from the present three-rule rehearsal or added to this milestone.
