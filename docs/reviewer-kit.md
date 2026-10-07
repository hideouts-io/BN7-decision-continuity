# Decision Continuity reviewer kit

**Current October 6, 2026. No reviewers have been contacted, interviewed, or secured.** This synthetic critique does not establish demand, customer results, assurance, or a relationship with any candidate.

## Explain the product

Decision Continuity preserves evidence and assumptions behind decisions. Explicitly linked source changes prompt a responsible person's reassessment, reasoned outcome, and inspection of original and later records. A person decides the outcome.

The fictional team approved an assistant for a limited, read-only task. A later manifest requests write access. A request does not establish granted access or observed behavior.

This is a **guided comprehension and usability test**. Buttons such as “Load unchanged control” and labels such as “No relevant change” reveal the scenario. Successful completion does not demonstrate independent change detection or measure a false-alarm rate.

The next-step card, highlighted workflow stage, permission guide, and expandable evidence path also provide assistance within the product. Observe which aids the participant uses and whether they can explain the reasoning beyond those labels. Navigation itself records no outcome. Ask what they expect next before directing them; use the README for the current run-through rather than duplicate instructions here.

## Prepare and preserve each session

1. Follow the [README](../README.md) to run and rehearse the demonstration; read its storage limitations.
2. Select **New session** before each participant or rehearsal. It creates a fresh synthetic workflow and preserves existing sessions. Use **Demo session** to resume one later; **Existing demo** retains the earlier workflow history. Use **Enter a version** instead when critiquing manual source capture; it creates a separate v2 session without changing the preset workflow. Session IDs contain no participant identity. There is no deletion or reset action.
3. After the tasks, select **Export history** and preserve that session's JSON privately. The session ID identifies the record; the export time and filename distinguish saved copies. It contains synthetic decision history, not interview feedback. Resume the local record through **Demo session**, or use the README recovery instructions to inspect and explicitly restore its export in a fresh browser context without replacing existing history.
4. Ask for a practitioner who has performed assessments or reassessments. Review the invitation below yourself; no contact or booking requests have been submitted.
5. When someone agrees, explain the 20-minute format and ask permission for anonymized notes. Obtain separate consent for recording. Keep contact details, correspondence, raw feedback, and confidential examples outside this public repository.

The `?session=UUID` URL selects a record in the same browser profile and origin. It does not share data with a reviewer, another browser, or another machine. After human agreement, run the critique using your local demonstration or screen sharing. Sessions improve repeatability and preserve rehearsal history; they do not establish practitioner demand, authentic reviewer identity, or operational impact. See the README for storage limitations.

Prepare a fresh packet using the README command. `source-cards.html` is the participant handout; `observations.md` is a blank facilitator worksheet kept outside the public checkout. The HTML needs no server or connection when opened locally. `sources.json` and the preparation manifest retain the input fields and their source/hash context. Record each browser session UUID beside the applicable task and export filename. Do not fill participant, consent or scoring fields during automated rehearsal.

## Run a 20-minute critique

| Time | What I do | What I record |
| --- | --- | --- |
| 0–3 min | Ask about current reassessment work before explaining the product. Request a general example without client identifiers. | Trigger, current tools, frequency, and accountable owner. |
| 3–5 min | Explain the product above. Say: “Please think aloud; anything confusing is useful feedback.” Show the original decision. | Understanding of scope and original basis. |
| 5–13 min | Give the three tasks below. Observe before explaining controls. | Time, navigation, interpretation, errors, and assistance. |
| 13–18 min | Ask the follow-up questions and compare with the participant's current process. | Missing context, overlap, and added work. |
| 18–20 min | Recap and ask for corrections. Discuss whether a bounded later trial is appropriate. | Corrections and any agreed next step. |

If someone gets stuck, ask “What would you expect here?” Record the problem before helping. Mark assistance; do not imply a preferred outcome.

## Three participant tasks

Read the quoted task; keep the setup and observations for yourself. The interface labels remain visible, so explanations must show reasoning beyond repeating them.

### 1. Inspect an incoming version

**Task:** “You are responsible for this approval. Inspect the incoming source version and explain whether you would review the approval now. What supports your answer?”

**Setup:** Load unchanged control, EV-003, against original EV-001. **Observe:** Can the participant explain the comparison behind “No relevant change,” distinguish a new version from a relevant change, and see that no review is created? Record any contextual reason they would still investigate. This checks comprehension and the demonstrated control behavior, not blinded detection.

### 2. Explain another version's implications

**Task:** “Inspect this next version. Explain what it means for the approval, what the evidence establishes, and what you still need to know before deciding.”

**Setup:** Load write-access request, EV-002. Do not explain the affected assumption first. **Observe:** Can the participant trace EV-001/EV-002 to ASM-001 and DEC-001, inspect the original rationale, distinguish requested/granted/observed permissions, and find REV-001 and its responsible reviewer?

### 3. Leave an accountable outcome

**Task:** “Act as the designated fictional reviewer. Record the outcome you consider supported and explain its limits. Then show how another person could reconstruct the original approval and your review.”

**Setup:** Open assigned review. The person chooses **Outcome**, fills **Review rationale** and **Resulting decision scope or next step**, then selects **Record human outcome**. Reaffirm, revise, withdraw, and defer are available; do not steer the choice.

**Observe:** Are rationale, actor, time, and evidence versions understandable? Is the original decision preserved? Deferring leaves the review open so a later outcome can be appended; a terminal outcome cannot be overwritten. Neither recording nor exporting changes a real assistant's permissions.

## Optional manual-capture critique

After a preset rehearsal, use a new version-entry session to replace task 2's preset load with the participant entering a fictional manifest. Use the README for controls and constraints. Ask: “Record this synthetic source version with enough context for another reviewer to interpret it. Explain what changed, which assumption is affected, and what remains unknown.” Supply the fictional fields separately from product interpretation; do not imply the outcome they should choose.

The prepared handout supplies **Source A** for unchanged permission fields, **Source B** for a requested-write change with read-only declared grants, and **Source C** for a grant-only change. Those meanings are facilitator setup; the cards themselves show source fields without a recommended decision. Use B for the complete capture → review → outcome → history task. Use A or C in separate version-entry sessions when time permits: only one immutable entry is available per session, and neither case satisfies the current request-based review trigger. Ask what further assessment the grant-only case warrants. The visible application guidance still makes this a guided critique.

Observe capture time, independent request/grant selection, usefulness of the required note, and whether the saved snapshot can be reconstructed in review/history/export. Record validation errors and assistance. If time is limited, schedule capture critique separately rather than rush the three tasks. A grant-only change can expose the narrow trigger's limits; ask what assessment would still be required.

The increment's hypothesis is that explicit source capture improves reassessment continuity at an acceptable maintenance cost. Favor further expansion only when practitioners can reconstruct the basis and identify recurring work where capture/link maintenance would cost less than the confusion it resolves. Positive reactions to the form alone do not justify connectors or production infrastructure.

## Optional decision-creation critique

The **Single capture · v3** under **Earlier workflows** workspace allows a fictional approval and explanatory read-only request assumption to be created before capturing a later version. Follow its [single-review README workflow](../README.md#create-a-single-review-synthetic-decision) rather than duplicate form directions here. Ask whether someone can state a bounded approval, identify its evidence dependency, assign responsibility and reconstruct a later outcome. Observe setup time and rule/prose confusion as well as navigation. The existing prepared packet still describes Atlas; it is not a tested protocol for arbitrary decisions. Keep real participant observations blank until an actual session and retain old prepared packets as historical artifacts.

Automated v3 creation, control comparisons and recovery verify technical readiness only. No practitioner participation, authenticated responsibility or net maintenance benefit has been established. Outreach and external critique remain deferred.

For a future repeated-change critique, follow the [continuity README workflow](../README.md#reassess-a-decision-repeatedly). Ask which earlier basis applies to C after B was revised, and whether the person can distinguish prior scope from later knowledge. Observe whether explicitly maintaining the next request boundary adds useful clarity or excessive work. Measure human setup, capture/link maintenance and reassessment time only during an actual session; browser automation timings are not those measurements. Existing Atlas packets are not a prepared v4 protocol and must not be overwritten. Cross-source contradictions and full historical replay remain later capabilities; synthetic malformed-record rejection establishes neither.

## Optional shared-source critique

Follow the [shared-source README workflow](../README.md#trace-a-shared-source-across-three-decisions) in a new v5 rehearsal. Ask why the same write request affects the request decision, leaves the declared-grant rule without a relevant change, and leaves production applicability unresolved. Ask what each label does and does not establish. Observe whether inspecting the path reveals the actual field, scope, boundary and evidence references rather than encouraging a safety inference.

Ask the person to reassess one decision and reconstruct its original basis and outcome, then explain why another decision and a pending review of earlier evidence are unchanged. Measure setup, navigation and capture/link maintenance only during an actual session. The current Atlas packet has not been regenerated into a v5 protocol; preserve it and keep observations blank until participation. Automated or simulated outcomes cannot fill participant fields, establish comprehension, or measure demand.

For an optional clarification critique, follow the [v6 README workflow](../README.md#reassess-after-a-clarified-declaration) in a new rehearsal. Ask what the Production declaration established, which question remains tied to Unknown evidence, why replacement is distinct from approval, and which hold applies before the new outcome. Ask the person to inspect both frozen targets and identify what remains unobserved. Existing Atlas packets are not a v6 participant protocol. Keep observations blank until a real session; do not count automated or simulated responses as comprehension or demand.

## Ask neutral follow-up questions

- What did the change establish, and what needs additional evidence?
- What was missing or hard to understand? What would change your outcome?
- How do you handle this today, including original reasoning and responsibility?
- Describe the last relevant reassessment without confidential details. What was difficult, and what already worked?
- When would this distract you or miss a needed review?
- Who would maintain evidence links, and what work would that add?
- Which step would you remove or integrate with an existing tool?
- What would justify a bounded real-work trial?

Enthusiasm and hypothetical purchase intent do not establish demand.

## Record and judge feedback

Use private participant codes such as P01. Record role category, experience, task time, assistance, observations, and contradictions. Separate participant words from interpretation. Keep identities and confidential details out of public records. Actionable product work belongs in Linear with appropriately accessible evidence links.

Score dimensions separately; this is a planning aid, not a scientific scale.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Permissions | Confuses request with grant/use. | Understands after help or misses a limit. | Explains request and unestablished grant/use without help. |
| Decision trace | Cannot connect evidence and decision. | Finds part of the relationship. | Explains versions → assumption → decision without help. |
| Control comprehension | Cannot explain the unchanged comparison. | Repeats the label or needs help. | Explains the comparison and absence of review beyond the label. |
| Accountability/history | Cannot reconstruct the record. | Misses rationale, actor, or versions. | Explains original and later outcome records without help. |
| Maintenance fit | No owner or untenable burden. | Owner or burden uncertain. | Identifies a plausible owner and steps to measure later. |

Real impact requires later observation of comparable work: initial capture, link maintenance, reassessment time, missed affected decisions, and unnecessary reviews. Include setup burden in net-value estimates. This demo establishes none of those results.

## Candidate reviewers and public routes

Outreach and external critique are currently deferred by the user. These routes and the invitation below remain optional future preparation, not tasks to execute or conditions blocking bounded local development.

Fit is a hypothesis; participation and availability remain unconfirmed. Ask for a working assessor rather than assume a founder will participate.

- **Max Rizzuto, BABL AI — Audit & Assurance.** The [team page](https://babl.ai/who-we-are/) verifies this operational role. Its [continuous-assurance article](https://babl.ai/continuous-ai-assurance-still-starts-with-a-point-in-time/) connects ongoing evidence with foundational professional review. Ask what prior scoping information reassessment requires. Use [BABL's contact form](https://babl.ai/contact-us/) to request an appropriate assessor. Their existing review methods may already handle the problem.
- **An AI/ML security or assurance engineer, Trail of Bits.** The current [AI/ML service page](https://trailofbits.com/services/software-assurance/ai-ml/) describes AI/ML assurance work and offers a complimentary one-hour technical office-hours session with an engineer. Ask whether the permission example is a useful review trigger. Acceptance and the assigned engineer are not guaranteed; existing assessment methods may already cover the problem.
- **An operational evaluator, Eticas.ai.** Its [evaluation process](https://www.eticas.ai/what-we-do) describes monitoring, material-change reevaluation, and evaluation history. Ask about organizational context, ownership, and misleading evidence links. Use [general contact](https://www.eticas.ai/contact-us/) for routing. Its [about page](https://www.eticas.ai/about-us/) identifies founder/CEO Gemma Galdon-Clavell, but a named operational reviewer is unverified. Existing monitoring and history capabilities overlap substantially.

Start with an appropriate working assessor if participation is later authorized, then seek a contrasting practitioner. These are optional candidate routes, not product partnerships or a requirement to buy consulting services.

## Invitation draft — unsent

**Subject:** Short critique of a synthetic decision-reassessment workflow

Hello [name/team],

I am developing Decision Continuity as an independent application. This early demonstration links decisions to evidence and assumptions, identifies a reason for reassessment when a source changes, and preserves a person's outcome.

Would an appropriate working assessor critique a 20-minute synthetic example about an assistant manifest requesting write access? We want to understand where it is useful, where it fails, and what your current process handles better.

Demand and operational benefits are unvalidated. We seek feedback, not endorsement or assurance. No client data is needed. I would take anonymized notes with your agreement and would not publish your name or quotations without separate permission.

Thank you,
[your name and accurate role]

Use an accurate personal role before sending; this independent product does not imply company affiliation or endorsement. Sending this draft requires explicit authorization.

## Choose the next gate

External participation is deferred. These provisional rules guide a future practitioner-validation decision, not every local implementation milestone or market conclusions:

- **Continue:** Two of the first three suitable practitioners explain trace/history and permission limits without facilitator help, including reasoning beyond control labels. At least one describes recurring pain and agrees to discuss a feasible real-work trial.
- **Simplify:** The problem recurs but at least two need navigation help or identify duplicate capture work. Reduce steps and repeat critique before adding connectors.
- **Change direction:** Their actual problem differs or existing systems adequately handle this workflow. Identify the missing job first.
- **Stop expansion:** No recurring problem, accountable owner, or plausible benefit over maintenance burden emerges. Revisit the hypothesis; three conversations do not establish market-wide absence of need.

Fix misleading permission claims, lost history, or unaccountable outcomes before another demonstration. Candidate silence is not a product verdict. Production persistence, authentication, connectors, and deployment require a justified later milestone.

## Evidence-requirement critique extension

The [README evidence-requirement walkthrough](../README.md#turn-a-deferred-question-into-an-evidence-requirement) owns v7 run instructions. When participation is available, ask a person to explain what would answer the Unknown-context question, which exact capture their response evaluates, and why satisfying the requirement does not approve production. Compare ordinary deferral notes with the structured question/evidence/trigger journal; measure missed distinctions and annotation burden during the actual session. Keep observations blank until then. Simulated responsible codes and rehearsed responses are technical fixtures, not practitioner feedback. General prose requirements and journal replay are not implemented.

## Focused comparison-packet critique extension

The [README packet workflow](../README.md#carry-a-selected-comparison-into-a-review-packet) owns file/inspection/print directions. When actual participation is available, give a person only the prepared public/synthetic packet and ask them to reconstruct the earlier scope, explain the exact change, identify the responsible frozen review and state what remains unknown. Compare this focused handoff with the ordinary complete history. Observe correct reconstruction, reference navigation, assistance and preparation/review effort during that real session. Ask whether the bounded/archive and unauthenticated-source limits are understood. Do not treat packet validation, generated printouts or simulated responses as participant evidence. Keep observations blank until a session occurs, and do not send a packet or contact anyone without authorization.
