# Decision Continuity

An application for preserving the evidence, assumptions, and dependencies behind decisions; identifying changes that warrant reassessment; and retaining accountable human review outcomes.

This is the primary application repository: [hideouts-io/BN7-decision-continuity](https://github.com/hideouts-io/BN7-decision-continuity). Company research remains in [BN7](https://github.com/hideouts-io/BN7) and [bridgenode7-technical-review](https://github.com/hideouts-io/bridgenode7-technical-review). Linear tracks product work; code, research, and design remain in their authoritative systems.

## Current state

The guided synthetic workflow, reviewer kit, isolated local sessions, and **Your decisions** workspace are implemented. Atlas v1/v2 and one-review authored v3 remain intact. **Repeated reassessment** creates an opt-in v4 decision: retain multiple immutable captures, evaluate each against the applicable human decision/evidence/request boundary, explicitly open a review and append outcomes. No existing record is migrated or reset. [HID-9](https://linear.app/hideouts-bn7/issue/HID-9/create-a-synthetic-decision-and-assumption-through-an-accountable) tracks creation; [HID-10](https://linear.app/hideouts-bn7/issue/HID-10/preserve-decision-continuity-through-repeated-evidence-reassessment) tracks continuity. **Shared impact** provides the v5 three-decision rehearsal tracked by [HID-11](https://linear.app/hideouts-bn7/issue/HID-11/trace-one-shared-synthetic-source-across-three-independent-decisions).

Strict TypeScript/build and complete real-browser checks passed. Source development is tracked on [codex/decision-continuity](https://github.com/hideouts-io/BN7-decision-continuity/tree/codex/decision-continuity); Git history identifies the reviewed source checkpoint. [HID-5](https://linear.app/hideouts-bn7/issue/HID-5/record-a-synthetic-evidence-version-through-a-traceable-human-outcome) tracks the manual-evidence milestone. No reviewers have been contacted, interviewed, or secured; no shared backend or live source connector exists. HID-13 records public demonstration publication separately from operational validation.

Use public or synthetic evidence for the first prototype. Automated synthetic rehearsal verifies technical behavior; practitioner comprehension, usefulness, demand and operational impact remain unvalidated. External critique and outreach are deferred under the user's current direction; bounded local development can proceed.

Facilitated critique preparation is implemented and locally verified for [HID-7](https://linear.app/hideouts-bn7/issue/HID-7/prepare-and-rehearse-a-neutral-practitioner-critique-packet): a local command produces neutral source cards, fixture JSON, a blank observation worksheet and a preparation manifest. Linear access is restored; its local completion evidence is reconciled in the existing issue. This prepares a session; it records no practitioner participation or validation. Figma repair acceptance is complete in HID-6; the draft remains a separate design proposal.

## Run locally

Requires Node.js **22.18 or newer** and npm. From this checkout:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). If this checkout's preview is already running there, reuse it rather than starting a second server. The server binds to the local machine and fails if that port is occupied; do not terminate an unrelated listener. Stop your terminal's server with Ctrl+C before restarting it.

```sh
npm run build
npm run smoke
```

The build includes strict TypeScript checking. Smoke checks start their own server on port 5189 and use an isolated headless **Google Chrome** installation, Playwright, and axe. Chrome must be installed; tests do not use your signed-in Chrome profile. See [verification.md](docs/verification.md) for results and limits. For a local preview of the built files, run `npm run preview` and open `http://127.0.0.1:4173`.

## Prepare a critique packet

Choose a new directory outside this public checkout. Its parent must already exist. For example:

```sh
mkdir -p /Users/macbookpro/Documents/Decision-Continuity-Validation
npm run prepare:critique -- --output-dir /Users/macbookpro/Documents/Decision-Continuity-Validation/participant-P01
```

The command creates `source-cards.html` (open in a browser or print), `sources.json`, blank `observations.md`, and `manifest.json`. The packet directory and files use owner-only permissions. Existing destinations are rejected without replacement; choose a new name for another preparation. Paths inside the checkout, including paths reached through a symlink, are rejected. No network access, account credentials, app session writes, or new dependency is required.

The packet reuses the immutable original read/read basis, unchanged control, requested-write case and grant-only case. Cards and fixture JSON separately attribute public inspiration to the pinned MCP filesystem documentation in [the reference manifest](fixtures/public-reference/mcp-filesystem/manifest.json). The captured documentation and upstream license notice retain commit, URL, UTC capture, attribution and SHA-256 hashes. The license notice describes a transition while the filesystem README states MIT; both original artifacts are preserved. Tool capabilities are public facts; Atlas permissions, actors, approvals, outcomes and scenario dates are invented. The reference is not runtime evidence. Preparation validates local capture hashes and requires no live network connection.

The manifest records preparation time and source/artifact SHA-256 hashes. It describes the blank snapshot, not a secure audit record. Completing the worksheet changes its hash normally; the manifest does not authenticate consent or subsequent notes. Keep completed observations and session exports private. Follow the [reviewer kit](docs/reviewer-kit.md) for task selection, neutral questions and the continuation gate.

## Walk through the demonstration

Select **New session** before each rehearsal or participant. It opens a clean synthetic workflow with its own UUID; **Existing demo** retains the history prepared before session support was added. No records are reset or deleted.

1. Select **Inspect original approval** on the next-step card, then expand **Inspect the original decision and rationale**. DEC-001.1 approved synthetic document summarization using EV-001 and assumption ASM-001. **Compare the evidence** moves to the source choices.
2. Select **Load unchanged control**. EV-003 has a new capture/version label, but relevant permissions are the same. The comparison says **No relevant change** and the review button remains disabled.
3. Select **Load write-access request**. EV-002 adds `documents:write`. Inspect both source cards, then use **Explore the evidence link** or **Trace the impact**. Expand source, assumption, decision, and review nodes to inspect the reasoning. Declared granted access remains `documents:read`; activity is **Not observed**. The optional permission guide explains these distinctions.
4. Select **Open assigned review**. REV-001 is assigned to Morgan Lee, a fixed synthetic identity. Opening review creates no outcome.
5. Choose an outcome; its explanation describes what that action records without choosing it for you. Write a rationale and describe the resulting decision scope or next step. Both narrative fields require at least 16 characters after trimming. Select **Record human outcome**.
6. Inspect history, then reload. The original approval remains; the outcome includes actor, time, rationale, and both evidence snapshots. A **deferred** outcome leaves review open for a later appended outcome. A terminal outcome cannot be overwritten in this demonstration.
7. Select **Export history** to download the synthetic session as JSON. Selecting another comparison preserves earlier review history.

## Enter another synthetic version

1. Select **Enter a version**. It creates a distinct v2 session and opens Evidence; the original approval and older sessions remain intact.
2. Enter a synthetic capture time in UTC, at or after EV-001's capture and at or before recording time. Select at least one requested permission and at least one declared grant independently. Neither category is preselected.
3. Write a synthetic source note of 16–1,000 characters after trimming. For a rehearsal, request read/write, declare read-only grants, and describe the fictional manifest and lack of runtime evidence. Use public or synthetic material only.
4. Select **Record & compare version**. EV-004 and its source note are immutable within this session. Comparison shows additions/removals in both categories; runtime activity remains **Not observed**. Capture creates no review or decision outcome automatically.
5. Follow the impact path and open the assigned review when the request contradicts ASM-001. Record an outcome as in the preset walkthrough. The review is permanently bound to its exact source version; selecting EV-002 while reviewing EV-004 hides the outcome form. **Load entered version** resumes the correct comparison.
6. Inspect history, reload, and export. The original decision, capture note, snapshots, human rationale, and explicit source-event references remain available. Deferral permits a later appended final outcome; a final outcome cannot be overwritten.

One authored version and one review per session keep this prototype bounded. Capture closes after a version is saved or any review opens. To try different evidence, select **Enter a version** again rather than edit earlier records. EV-004 is identified together with its session UUID; it is not a globally unique source identifier.

A grant-only change is visible but does not satisfy the request-based ASM-001 trigger. The interface explicitly identifies this coverage limit; absence of a suggested review does not establish that an approval is safe. There is no generic document parser, automatic source observation, authenticated assignee, or live integration.

To verify session isolation, record an outcome, select **New session**, then use **Demo session** to return to the earlier session. Its evidence and outcome remain intact after reload. The selected UUID appears in `?session=...`; copying that URL selects data in this browser profile and origin only. An absent session fails explicitly instead of creating an empty replacement. It does not provide a remote sharing link.

The next-step card and highlighted workflow stage describe the current records, not completion inferred from which sections you visited. Navigation and native disclosures move focus or reveal reasoning; they never load evidence, open a review, or record an outcome. If you select the control while a review is pending or deferred, guidance sends you back to the reviewed write-request version. An unchanged comparison does not close that review. A terminal outcome continues to point to preserved history even when another comparison is selected.

Atlas exports include `exportSchemaVersion`, `sessionId`, and `exportedAt`, with the fixed original decision, evidence, and recorded session. Their filenames include the session ID and export timestamp.

## Create a single-review synthetic decision

Open **Your decisions** in the header, or [http://127.0.0.1:5173/decisions.html](http://127.0.0.1:5173/decisions.html). The Atlas workflow remains available separately.

1. Define a fictional approval: title, original scope and rationale, fictional reviewer code such as `REVIEWER_A`, and why its read-only request assumption matters. Name the synthetic source and enter the baseline capture in UTC, no later than recording time. The baseline requests `documents:read` only; select declared grants independently and write its source note. Confirm the synthetic-material boundary, then select **Create & preserve the original basis**.
2. Enter one later capture, at or after the baseline capture and no later than recording time. Select requested and declared-granted permissions independently. For a complete reassessment, request read/write and declare read-only grants. **Preserve & compare version** freezes the snapshot and compares it with the original basis; it opens no review automatically.
3. Inspect the source → evidence → assumption → original decision path. The structured `request-remains-read-only` rule suggests review only for a requested write permission. Assumption prose explains context; it is not executable logic. Unchanged and grant-only cases remain visible controls, with the rule's limit explicitly described.
4. Select **Open assigned review**. Act as the assigned fictional reviewer; choose an outcome, explain its rationale and resulting scope. **Append outcome to history** preserves every prior record. Deferral leaves the review open; a final outcome blocks further appends. Reviewer codes are not authenticated identities.
5. Inspect the original approval, source events and outcomes, then reload and export. Export format v2 holds session v3 and preserves UUID relationships and exact snapshots. Restore via **Import history** on either page; preview is read-only and confirmation opens the appropriate workspace. The **Saved decision** picker resumes v3 records; **New decision** preserves them while starting another blank form.

This version supports one source, one structured assumption, one later capture and one review per created decision. Original entities cannot be edited; create another decision to rehearse another case. Entered text is trimmed before initial recording; imported historical text must already be normalized. Invalid chronology, empty selections, wrong reviewer codes, broken references and terminal-history violations fail explicitly. A stale tab cannot overwrite newer v3 history: reload before continuing. This synchronous same-browser check is not a distributed concurrency guarantee.

## Reassess a decision repeatedly

Select **Repeated reassessment** or open [http://127.0.0.1:5173/decisions.html?format=4](http://127.0.0.1:5173/decisions.html?format=4). This explicitly starts a new v4 decision; an existing v3 history is not silently upgraded. Define the original synthetic approval as above. Its first accepted request boundary is `documents:read`.

1. **Version A:** Preserve the original read-only basis and rationale.
2. **Version B:** Capture a later manifest requesting read/write with independently declared read-only grants. Inspect the five-field summary: change, relevance, uncertainty, responsibility and recorded outcome. Open the review explicitly; opening records no outcome.
3. **Revised basis:** A deferral preserves the current approval and keeps review open. To resolve B with **Revise**, explicitly select the next accepted request boundary, write the matching synthetic scope and rationale, then append the outcome. For this benchmark, accept read/write. Free text cannot silently change the rule. Reaffirm retains the earlier boundary; withdrawal ends the active approval.
4. **Version C:** Capture read/write/delete requests with read-only declared grants. `documents:delete` is an invented synthetic permission used to exercise another meaningful change. The new comparison shows deletion added against B and the revised approval, rather than comparing again with A. A new review freezes that exact basis and target. Resolve it without replacing B's outcome; reaffirm can retain a read/write scope that excludes deletion.
5. **Controls D/E:** Capture the same request set again, then change only the declared grants. Neither creates a new request-based review. If deletion remains outside the boundary, the summary says so rather than claiming safety. A grant-specific rule is not implemented.
6. Reload, export and restore in a fresh browser context. Both earlier reviews, all outcomes and the original approval remain reconstructible. The saved-decision picker distinguishes repeated records and clears/sets the format parameter when switching between v3/v4.

One review may be open at a time. Additional capture is blocked until it resolves; a deferral is not a final basis. Terminal protection applies per review: another relevant source version can receive a new review. After withdrawal, preserve/export history and create a new synthetic decision for another approval. All original entities and existing event prefixes are immutable. Stale-tab writes fail explicitly; this is not distributed concurrency or tamper resistance.

Each resolved approval basis contains the human scope/rationale, revision, actor, time, source event, evidence snapshot and accepted request boundary. Every later review/outcome binds to exact UUID references and frozen basis/target snapshots. Detailed identifiers are inspectable behind disclosures. New v4 writes are checked against the size of their full formatted export before saving; exceeding the shared 1 MiB recovery limit rejects the append without truncating history.

The repeatable synthetic benchmark is part of `npm run smoke`: two relevant targets, unchanged/grant-only controls, deferred-basis behavior and exact history recovery. Inconsistent basis/snapshot fixtures test validation, not resolution of genuine conflicting independent sources. Automated elapsed time is not practitioner setup time. No maintenance-cost or operational-benefit result is established.

## Trace a shared source across three decisions

Open [http://127.0.0.1:5173/impact.html](http://127.0.0.1:5173/impact.html), or select **Shared impact**. This explicitly creates a new v5 rehearsal, leaving v1–v4 records intact. The three starting decisions and source are simulated; the production decision is a hold, not an approval. Use a fictional uppercase reviewer code and confirm the synthetic boundary before creating the baseline.

1. Append a source capture requesting read/write, independently declaring read granted, with deployment **Unknown**. Keep the prefilled UTC time or enter a later valid time, and describe the synthetic change in the source note.
2. Inspect the three results: **Request boundary** is affected; **Declared grant boundary** has no relevant change under its own field rule; **Production applicability** remains unresolved. Requests do not establish grants, declarations do not establish runtime, and no relevant change does not establish safety.
3. Select source/evidence/assumption/decision nodes to inspect exact UUID references, added/removed permissions, applicable revision and boundary, scope, uncertainty and original rationale. The native buttons are keyboard accessible. The text inspector and history provide the readable equivalent. The view evaluates the latest capture against the current applicable basis; it is not historical replay.
4. Select the request decision in **Decision to review**, then open its assigned review. Choose an outcome, enter an accountable rationale and resulting scope. **Revise** requires an explicit next boundary for that decision's monitored field; accepting read/write in this synthetic case changes neither grants nor other decisions. **Reaffirm** retains the prior boundary, so an outstanding mismatch stays visible. A terminal capture cannot receive a duplicate review; a later capture may be reassessed.
5. Select the production decision and open its review. With Unknown applicability, only **Defer** or **Withdraw** is permitted. Deferral records an interim action, supplies no new approval basis, and keeps that decision's review open. This bounded version does not supersede an Unknown-target review with a clarified capture; any future supersession must retain both targets and receive its own milestone. Another capture cannot silently approve or retarget this review.
6. Additional captures can proceed while reviews are pending. Every review retains its exact earlier target; a B outcome does not approve C. Other decisions have independent revision sequences and outcomes. Inspect review/outcome nodes and the append-only history, reload, then export and restore in a fresh browser context using the recovery directions below.

V5 uses `bn7-decision-continuity-shared-v5:session:<UUID>` at `/impact.html?session=<UUID>` and export format v4. One canonical source/capture array is shared by all decisions. The v5 validator enforces three explicit field/scope rules, original relationships, chronological captures, exact review basis/target references, assigned codes, per-decision terminal protection and append-only revisions. Persistence preserves every prior entity/event prefix, rejects stale-tab writes, and checks the full formatted export against 1 MiB before saving. These are local consistency protections, not tamper resistance or authenticated accountability.

`src/shared-model.ts` contains pure transitions and applicability rules, `src/shared-storage.ts` the persistence boundary, `src/shared-export.ts` the envelope, and `src/shared-render.ts` / `src/shared-main.ts` the native trail and controls. No dependency or external data integration was added. `scripts/shared-smoke.ts` exercises the entire workflow through real Chrome, including independent outcomes, frozen-target reassessment, older-format byte preservation, recovery, keyboard/mobile/reduced motion and accessibility.

## Reassess after a clarified declaration

Open [http://127.0.0.1:5173/impact.html?format=6](http://127.0.0.1:5173/impact.html?format=6) using **Clarified review**. Create a new, explicitly synthetic v6 baseline with a fictional reviewer code. Existing v1–v5 records and URLs are retained; this is not an upgrade of a saved v5 session.

1. Capture **B** requesting read/write, independently declaring read granted, with deployment **Unknown**. Select **Production applicability**, open its assigned review, and record **Defer** with a simulated rationale and interim production hold. Reaffirm/Revise remain unavailable for that Unknown target.
2. Capture **C** with the same permissions and declared deployment **Production**. The old review stays tied to B and remains unresolved; C changes no approval, scope or original decision. Actual deployment and runtime are still unobserved.
3. In **Replace the deferred question explicitly**, enter the assigned fictional reviewer code and why C warrants a separate review. Select **Preserve old review & open replacement**. One atomic append records the replacement and a new review targeting C. The old review, its exact deferral UUID, B evidence/source references and frozen basis remain intact. Replacement is not a decision outcome.
4. Inspect the replacement's old/new review buttons using mouse or keyboard. Each inspector exposes its own frozen context, target and basis, the recorded handoff reason, responsible code and remaining uncertainty. The current trail displays an outcome only for its associated review; the original deferral remains in readable history. This is selected-review context, not general historical replay.
5. Record the new review's explicit synthetic outcome. **Revise** requires a new accepted boundary plus rationale and scope; read/write supplies this rehearsal's example. **Reaffirm** retains the exact earlier scope, including the production hold, and cannot silently change it. Deferral keeps this new review open; withdrawal ends only this decision's active scope. Requests, declared grants, original decisions and other decision outcomes remain independent.
6. Reload, export, then inspect and explicitly restore the JSON in a fresh browser profile. Export format v5 holds session v6 and opens `format=6`. Recovering an older shared export opens its original v5 route and retains the v6 record.

`src/clarification-model.ts` validates original/shared relationships plus append-only replacement events. Replacement requires a deferred Unknown review, a later Production capture, the same decision/assigned code, exact old/new source/evidence and deferral references, and ordered nonbranching review links. Orphaned, cyclic, duplicate, terminal and wrong-actor replacements are rejected. The old review cannot receive later outcomes after replacement. Import also rejects a Reaffirm that changes the frozen scope.

V6 uses `bn7-decision-continuity-clarification-v6:session:<UUID>`. `src/clarification-storage.ts` preserves all entity/event prefixes and rejects stale writes; `src/clarification-export.ts` validates exact originals, export time and the shared 1 MiB boundary. Shared native controls and frozen-review rendering are reused; no dependency, AI or customer connector was added. Reviewer codes are unauthenticated and local consistency is not tamper resistance.

See [differentiation.md](docs/differentiation.md) for the bounded primary-source comparison and next capability hypothesis. Review replacement, lineage and approval workflows have precedents; originality and practitioner benefit remain unvalidated.

## Restore an exported history

1. Export a session using **Export history**. Open the application in another browser profile or private context; a session URL alone does not transfer records.
2. Expand **Import history**, choose the exported JSON file, and select **Inspect export**. The preview shows identity, versions, original decision, event/outcome counts and destination behavior; it writes nothing.
3. Select **Restore & open session**. Reload and inspect history, then export again. The session and original basis remain identical; the new export timestamp changes. **Open existing session** resumes identical history without rewriting its stored bytes.

Import accepts export format v1 with Atlas session v1/v2, format v2 with authored session v3, format v3 with continuity session v4, format v4 with shared-source session v5, and format v5 with clarification session v6, up to 1 MiB. Each envelope must preserve its exact original basis. Required fields, source/review relationships and causal ordering are validated before persistence. Historical text must already be normalized; import never silently trims it. Unrelated extra fields are ignored. Conflicting identity, malformed/incompatible content, altered bases or invalid existing destinations fail explicitly without replacement. Confirmation rechecks storage and opens the matching format/route; a missing session uses one atomic write. Quota/storage failures report an error and record no success. The valid current session remains usable after rejection.

Legacy exports retain `existing-demo` and its original storage key. A different legacy history in the destination blocks recovery: use a separate browser profile rather than overwrite, merge or relabel it. A missing named-session URL still reports an error, but **Import history** remains available to restore its matching export. There is no automatic transfer, merge, migration, cloud synchronization or concurrent-writer guarantee. Browser records are editable and these checks do not authenticate their origin. Keep exports private and use public/synthetic material only.

**First reviewer task:** let the participant explain the unchanged comparison and whether it justifies reassessment before explaining controls yourself. Use the [reviewer kit](docs/reviewer-kit.md) for three tasks, neutral questions, observation rubric, current candidate routes, and an unsent invitation. Visible control labels make this guided comprehension, not a blinded detection experiment. Demand and operational impact need later evidence from real work.

## Rules, storage, and implementation

Atlas/v3 retain their read-only request rule. V4 explicitly records an accepted request boundary for the applicable decision. A later requested-permission set must both differ from its preserved basis and exceed that boundary to suggest reassessment. Capture labels, timestamps, source-note edits and changed declared grants alone do not satisfy this request rule. No assurance verdict, grant change or runtime operation is implied.

The original demo remains under `bn7-decision-continuity-demo-v1`. Atlas v1/v2 sessions use `bn7-decision-continuity-demo-v1:session:<UUID>`. V3 uses `bn7-decision-continuity-authored-v3:session:<UUID>` at `/decisions.html?session=<UUID>`. Opt-in v4 uses `bn7-decision-continuity-authored-v4:session:<UUID>` at `/decisions.html?format=4&session=<UUID>`. Existing URLs and storage bytes are preserved without implicit migration. Older validators remain intact. Missing or corrupt records fail explicitly; loading/navigating writes nothing.

V2 stores one authored snapshot plus its original source event. Reviews/outcomes reference exact source events and retain evidence copies, so equal-millisecond actions remain unambiguous. Runtime validation checks immutable snapshot consistency, required attribution, chronology, unique event IDs, exact review targets, and terminal outcome protection. Browser storage is still editable; these checks are consistency checks, not tamper resistance.

Storage belongs to the exact browser profile and origin, including the port. It is editable, can be cleared by the user/browser, is not a secure audit log, and is not synchronized or authenticated. Development and built-preview ports have separate storage. Enter public or synthetic material only.

For a fresh participant, select **New session** for the preset rehearsal or **Enter a version** for capture critique. The selector lets a facilitator resume earlier synthetic histories, so use a separate profile/private context if participants should not see those records. Keep real identities and facilitator notes outside the app and public repository. There is no reset/delete button, authenticated identity, or automatic deletion.

Native HTML and TypeScript with [Vite](https://vite.dev/guide/) provide preview/build; [Zod](https://zod.dev/) validates inputs and histories. No dependency was added. Atlas logic remains in `src/scenario.ts`/`src/model.ts`; v3 logic remains in `src/authored-model.ts`/`src/authored-storage.ts`. `src/continuity-model.ts` owns v4 entities, explicit basis derivation and pure transitions. `src/continuity-storage.ts` protects entity/event prefixes and rejects stale tabs; `src/continuity-export.ts` validates its export and recoverable size. `src/history-contract.ts` holds the shared limit and synthetic notice. `src/authored-main.ts` dispatches to the correct format's controls, validators and renderer; no format is guessed from missing data. Shared recovery validates all formats and routes them explicitly. `vite.config.ts` builds all three native HTML pages, including `/impact.html`. Authentication, shared persistence, distributed concurrency, customer connectors and secure auditing remain later decisions.

The implemented increment tests a hypothesis: an assessor can capture attributable evidence and carry it into an understandable reassessment without excessive maintenance work. Its record behavior is technically verified; practitioner comprehension and usefulness remain untested. External validation is deferred; it is not a prerequisite for each bounded local improvement. Production/customer expansion still needs justified workflow evidence. The [reviewer kit](docs/reviewer-kit.md) proposes a future practitioner gate: two of three suitable practitioners explain trace/history and permission limits without help, and at least one describes recurring reassessment pain and a feasible real-work trial. Simplify or change direction when their process reveals duplication or excessive capture/link maintenance.

Continuation checkpoint: HID-6 is Done for verified repair criteria, including all seven Figma screens and six clicked prototype connections. HID-11 is Done for local v5 acceptance; HID-12 is Done for opt-in v6 clarification replacement. Build, full smoke, built-file and visual evidence are in verification.md and Linear. The pre-publication checkpoint is `e55d2f6` on `codex/decision-continuity`; use Git history to identify the newer publication source. Inspect Git status, preserve the clarification workflow, and consult HID-13 for the current deployment evidence. Review the complete Unknown → defer → declared Production → explicit replacement → separate outcome sequence. The strongest subsequent hypothesis is a bounded read-only view of one decision's basis at a selected recorded event, after defining event ordering and equal-time semantics; differentiation.md owns its rationale and reconstruction experiment. General historical replay, cross-source contradictions, evidence-gap guidance and AI remain deferred. No practitioner has participated; usefulness and setup burden are unmeasured, and outreach remains deferred. Future commits, pushes, deployments and customer connectors require explicit authorization.

See [tools-and-tracking.md](docs/tools-and-tracking.md) for actual Linear and Figma records and access boundaries.
## Visual foundation and site integration

Use [Bridge Node 7](https://bridgenode7.com/) as the visual reference. The user explicitly authorized copying its style. The local [homepage snapshot](design/reference/bridgenode7-home.html) preserves the original inline CSS, typography, orbital mark, and layout. [brand.css](design/brand.css) adapts its exact palette and selected primitives for the app.

Snapshot captured October 4, 2026 at 11:03:28 p.m. America/Los_Angeles from `https://bridgenode7.com/`. SHA-256: `a45e59d3af559b4f592eef317f33b0da4e78746fedb8caa85d7110483e4e3fbd`.

Retain the dark navy surfaces, gold actions, system sans typography, subtle borders, and orbital identity. Evidence comparisons and review controls need readable, restrained layouts, explicit status labels, keyboard access, and mobile stacking. Check accessibility in the implemented screens.

Eventual integration: a branded introduction on the main site linking to the working application, with shared design primitives. A route on the main domain or an application subdomain depends on verified hosting, authentication, and security requirements. The captured homepage policy blocks network connections and forms, so it cannot be reused unchanged for an authenticated application. No main-site files or settings have been changed.

## Working boundaries

Keep secrets and private assessments outside this public repository. Changes stay uncommitted for review until the user explicitly requests a commit. Product decisions remain human responsibilities; automated change detection may propose review, but must not silently revise a decision.

## Public subdirectory deployment

The public demonstration is hosted at https://hideouts.io/bridgenode7/decision-continuity/. The Hideouts repository builds an explicitly pinned commit from this source repository after its existing BN7 publication. Changing this repository does not silently update the website; the website's `publication/decision-continuity.json` identifies the deployed source. HID-13 owns deployment verification.

HTML navigation is relative to the application directory. `src/app-path.ts` uses Vite's configured `BASE_URL` for runtime navigation and recovery across all six session formats. Build with `npm run build -- --base /bridgenode7/decision-continuity/`. Serve the built pages at that exact directory, including the trailing slash; copying the default root build into a subdirectory would use incorrect asset paths.

`node scripts/deployment-smoke.ts https://hideouts.io/bridgenode7/decision-continuity/` runs isolated real-browser source capture, review/outcome, clarification replacement, reload, export/recovery, older-format preservation, keyboard/mobile and accessibility checks against the actual public path. Use an explicit local static-server URL with the same directory for pre-publication verification. The benchmark also delays real JavaScript requests to verify that forms remain inactive until initialization completes and native reviewer-code validation works. No existing visitor records are read or edited by these isolated contexts.

Hosting supplies the static demonstration. Records and imported JSON remain in each visitor's browser; there is no authenticated shared account, cloud database, live source connector or AI service. Localhost and hideouts.io are separate storage origins. Export locally, then explicitly import on the public app to transfer a synthetic session. Keep private observations and confidential examples outside the public website/repository.
