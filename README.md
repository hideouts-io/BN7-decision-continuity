# Decision Continuity

An application for preserving the evidence, assumptions, and dependencies behind decisions; identifying changes that warrant reassessment; and retaining accountable human review outcomes.

This is the primary application repository: [hideouts-io/BN7-decision-continuity](https://github.com/hideouts-io/BN7-decision-continuity). Company research remains in [BN7](https://github.com/hideouts-io/BN7) and [bridgenode7-technical-review](https://github.com/hideouts-io/bridgenode7-technical-review). Linear tracks product work; code, research, and design remain in their authoritative systems.

## Current state

The guided synthetic workflow, reviewer kit, and isolated local sessions are implemented. **Enter a version** creates an explicit v2 session for one manually entered synthetic manifest; **New session** retains the preset v1 walkthrough. Requested permissions, declared grants, UTC capture time, and a source note flow into comparison, human review, retained history, and JSON export. No existing session is migrated or reset.

Strict TypeScript/build and complete real-browser checks passed. Source development is tracked on [codex/decision-continuity](https://github.com/hideouts-io/BN7-decision-continuity/tree/codex/decision-continuity), following the initial synthetic demonstration checkpoint `f323a4e`. [HID-5](https://linear.app/hideouts-bn7/issue/HID-5/record-a-synthetic-evidence-version-through-a-traceable-human-outcome) tracks the manual-evidence milestone. No reviewers have been contacted, interviewed, or secured; no production deployment or live source connector exists.

Use public or synthetic evidence for the first prototype. A synthetic walkthrough can test comprehension and usefulness; demand and operational impact still require evidence from reviewers doing real work.

Facilitated critique preparation is implemented and locally verified for [HID-7](https://linear.app/hideouts-bn7/issue/HID-7/prepare-and-rehearse-a-neutral-practitioner-critique-packet): a local command produces neutral source cards, fixture JSON, a blank observation worksheet and a preparation manifest. Its final Linear update was blocked by a disconnected connector; last verified status remains In Progress. This prepares a session; it records no practitioner participation or validation. Figma layout acceptance remains open in HID-6.

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

A grant-only change is visible but does not satisfy the request-based ASM-001 trigger. The interface explicitly identifies this coverage limit; absence of a suggested review does not establish that an approval is safe. There is no generic document parser, automatic source observation, own-decision creation, authenticated assignee, or live integration.

To verify session isolation, record an outcome, select **New session**, then use **Demo session** to return to the earlier session. Its evidence and outcome remain intact after reload. The selected UUID appears in `?session=...`; copying that URL selects data in this browser profile and origin only. An absent session fails explicitly instead of creating an empty replacement. It does not provide a remote sharing link.

The next-step card and highlighted workflow stage describe the current records, not completion inferred from which sections you visited. Navigation and native disclosures move focus or reveal reasoning; they never load evidence, open a review, or record an outcome. If you select the control while a review is pending or deferred, guidance sends you back to the reviewed write-request version. An unchanged comparison does not close that review. A terminal outcome continues to point to preserved history even when another comparison is selected.

Exports include `exportSchemaVersion`, `sessionId`, and `exportedAt`, with the fixed original decision, evidence, and recorded session. Filenames include the session ID and export timestamp. Import is deferred until a reviewer workflow requires moving records between browsers; retain the JSON as a separate inspectable copy.

**First reviewer task:** let the participant explain the unchanged comparison and whether it justifies reassessment before explaining controls yourself. Use the [reviewer kit](docs/reviewer-kit.md) for three tasks, neutral questions, observation rubric, current candidate routes, and an unsent invitation. Visible control labels make this guided comprehension, not a blinded detection experiment. Demand and operational impact need later evidence from real work.

## Rules, storage, and implementation

The rule is deliberately narrow: SRC-001 supports ASM-001, which supports the original approval. Requested write access contradicts the read-request assumption. Version labels and timestamps alone do not trigger review. A person records the outcome; the app does not grant access or change a real assistant.

The original demo remains under `bn7-decision-continuity-demo-v1`. Both session types use `bn7-decision-continuity-demo-v1:session:<UUID>`; their `schemaVersion` discriminates v1 preset records and v2 version-entry records. `src/legacy-state.ts` preserves the original v1 schema/validators. No implicit migration or write occurs on load. `src/sessions.ts` creates new records only under unused keys and validates URLs; missing or corrupt records fail explicitly without replacement.

V2 stores one authored snapshot plus its original source event. Reviews/outcomes reference exact source events and retain evidence copies, so equal-millisecond actions remain unambiguous. Runtime validation checks immutable snapshot consistency, required attribution, chronology, unique event IDs, exact review targets, and terminal outcome protection. Browser storage is still editable; these checks are consistency checks, not tamper resistance.

Storage belongs to the exact browser profile and origin, including the port. It is editable, can be cleared by the user/browser, is not a secure audit log, and is not synchronized or authenticated. Development and built-preview ports have separate storage. Enter public or synthetic material only.

For a fresh participant, select **New session** for the preset rehearsal or **Enter a version** for capture critique. The selector lets a facilitator resume earlier synthetic histories, so use a separate profile/private context if participants should not see those records. Keep real identities and facilitator notes outside the app and public repository. There is no reset/delete button, import, authenticated identity, or automatic deletion.

Native HTML and TypeScript with [Vite](https://vite.dev/guide/) provide preview/build; [Zod](https://zod.dev/) validates records and inputs. Session isolation reuses these dependencies and browser storage; a database/shared workspace would introduce hosting and identity requirements before the critique workflow has been tested. Pure scenario/state functions live in `src/scenario.ts` and `src/model.ts`; `src/journey.ts` derives navigation, status, and outcome explanations from validated state. Storage and UI effects remain in `src/storage.ts`, `src/main.ts`, and `src/render.ts`. Rendered narrative strings are escaped. The v2 schema adds authored evidence and explicit source-event references; v1 fixtures and validators remain unchanged. No dependency or decision trigger was added. Production authentication, shared persistence, concurrent writes within one session, connectors, and secure auditing remain later decisions.

The implemented increment tests a hypothesis: an assessor can capture attributable evidence and carry it into an understandable reassessment without excessive maintenance work. Its record behavior is technically verified; practitioner comprehension and usefulness remain untested. Further expansion requires the [reviewer kit](docs/reviewer-kit.md) gate: two of three suitable practitioners explain trace/history and permission limits without help, and at least one describes recurring reassessment pain and a feasible real-work trial. Simplify or change direction when their process reveals duplication or excessive capture/link maintenance.

See [tools-and-tracking.md](docs/tools-and-tracking.md) for actual Linear and Figma records and access boundaries.
## Visual foundation and site integration

Use [Bridge Node 7](https://bridgenode7.com/) as the visual reference. The user explicitly authorized copying its style. The local [homepage snapshot](design/reference/bridgenode7-home.html) preserves the original inline CSS, typography, orbital mark, and layout. [brand.css](design/brand.css) adapts its exact palette and selected primitives for the app.

Snapshot captured October 4, 2026 at 11:03:28 p.m. America/Los_Angeles from `https://bridgenode7.com/`. SHA-256: `a45e59d3af559b4f592eef317f33b0da4e78746fedb8caa85d7110483e4e3fbd`.

Retain the dark navy surfaces, gold actions, system sans typography, subtle borders, and orbital identity. Evidence comparisons and review controls need readable, restrained layouts, explicit status labels, keyboard access, and mobile stacking. Check accessibility in the implemented screens.

Eventual integration: a branded introduction on the main site linking to the working application, with shared design primitives. A route on the main domain or an application subdomain depends on verified hosting, authentication, and security requirements. The captured homepage policy blocks network connections and forms, so it cannot be reused unchanged for an authenticated application. No main-site files or settings have been changed.

## Working boundaries

Keep secrets and private assessments outside this public repository. Changes stay uncommitted for review until the user explicitly requests a commit. Product decisions remain human responsibilities; automated change detection may propose review, but must not silently revise a decision.
