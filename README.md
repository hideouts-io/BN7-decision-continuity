# Decision Continuity

An application for preserving the evidence, assumptions, and dependencies behind decisions; identifying changes that warrant reassessment; and retaining accountable human review outcomes.

This is the primary application repository: [hideouts-io/BN7-decision-continuity](https://github.com/hideouts-io/BN7-decision-continuity). Company research remains in [BN7](https://github.com/hideouts-io/BN7) and [bridgenode7-technical-review](https://github.com/hideouts-io/bridgenode7-technical-review). Linear is intended to track product work; code, research, and design should remain in their authoritative systems.

## Current state

The synthetic workflow, reviewer kit, and repeatable local sessions are implemented. A state-aware next-step card, clickable workflow navigation, expandable evidence relationships, and outcome explanations guide the local demonstration. **New session** preserves earlier records; **Demo session** resumes a selected workflow. Exports include session identity and export time. Strict TypeScript/build and real-browser checks passed. The milestone is saved locally on `codex/decision-continuity`; it has not been pushed. No reviewers have been contacted, interviewed, or secured; no production deployment or live source connector exists.

Use public or synthetic evidence for the first prototype. A synthetic walkthrough can test comprehension and usefulness; demand and operational impact still require evidence from reviewers doing real work.

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

## Walk through the demonstration

Select **New session** before each rehearsal or participant. It opens a clean synthetic workflow with its own UUID; **Existing demo** retains the history prepared before session support was added. No records are reset or deleted.

1. Select **Inspect original approval** on the next-step card, then expand **Inspect the original decision and rationale**. DEC-001.1 approved synthetic document summarization using EV-001 and assumption ASM-001. **Compare the evidence** moves to the source choices.
2. Select **Load unchanged control**. EV-003 has a new capture/version label, but relevant permissions are the same. The comparison says **No relevant change** and the review button remains disabled.
3. Select **Load write-access request**. EV-002 adds `documents:write`. Inspect both source cards, then use **Explore the evidence link** or **Trace the impact**. Expand source, assumption, decision, and review nodes to inspect the reasoning. Declared granted access remains `documents:read`; activity is **Not observed**. The optional permission guide explains these distinctions.
4. Select **Open assigned review**. REV-001 is assigned to Morgan Lee, a fixed synthetic identity. Opening review creates no outcome.
5. Choose an outcome; its explanation describes what that action records without choosing it for you. Write a rationale and describe the resulting decision scope or next step. Both narrative fields require at least 16 characters after trimming. Select **Record human outcome**.
6. Inspect history, then reload. The original approval remains; the outcome includes actor, time, rationale, and both evidence snapshots. A **deferred** outcome leaves review open for a later appended outcome. A terminal outcome cannot be overwritten in this demonstration.
7. Select **Export history** to download the synthetic session as JSON. Selecting another comparison preserves earlier review history.

To verify session isolation, record an outcome, select **New session**, then use **Demo session** to return to the earlier session. Its evidence and outcome remain intact after reload. The selected UUID appears in `?session=...`; copying that URL selects data in this browser profile and origin only. An absent session fails explicitly instead of creating an empty replacement. It does not provide a remote sharing link.

The next-step card and highlighted workflow stage describe the current records, not completion inferred from which sections you visited. Navigation and native disclosures move focus or reveal reasoning; they never load evidence, open a review, or record an outcome. If you select the control while a review is pending or deferred, guidance sends you back to the reviewed write-request version. An unchanged comparison does not close that review. A terminal outcome continues to point to preserved history even when another comparison is selected.

Exports include `exportSchemaVersion`, `sessionId`, and `exportedAt`, with the fixed original decision, evidence, and recorded session. Filenames include the session ID and export timestamp. Import is deferred until a reviewer workflow requires moving records between browsers; retain the JSON as a separate inspectable copy.

**First reviewer task:** let the participant explain the unchanged comparison and whether it justifies reassessment before explaining controls yourself. Use the [reviewer kit](docs/reviewer-kit.md) for three tasks, neutral questions, observation rubric, current candidate routes, and an unsent invitation. Visible control labels make this guided comprehension, not a blinded detection experiment. Demand and operational impact need later evidence from real work.

## Rules, storage, and implementation

The rule is deliberately narrow: SRC-001 supports ASM-001, which supports the original approval. Requested write access contradicts the read-request assumption. Version labels and timestamps alone do not trigger review. A person records the outcome; the app does not grant access or change a real assistant.

The original demo remains under `bn7-decision-continuity-demo-v1` in local storage. New records use `bn7-decision-continuity-demo-v1:session:<UUID>`. `src/sessions.ts` validates URL identifiers, lists records, and creates a session only under an unused key. Controllers read/write the selected key; no migration or deletion is performed. Every outcome retains its evidence snapshots. Validation rejects selected evidence without source lineage, a review before its changed source selection, and outcomes before their review or prior outcome. Invalid/incompatible data produces an explicit error; history is not silently reset.

Storage belongs to the exact browser profile and origin, including the port. It is editable, can be cleared by the user/browser, is not a secure audit log, and is not synchronized or authenticated. Development and built-preview ports have separate storage. Enter public or synthetic material only.

For a fresh participant, select **New session**. The selector lets a facilitator resume earlier synthetic histories, so use a separate profile/private context if participants should not see those records. Keep real identities and facilitator notes outside the app and public repository. There is no reset/delete button, import, authenticated identity, or automatic deletion.

Native HTML and TypeScript with [Vite](https://vite.dev/guide/) provide preview/build; [Zod](https://zod.dev/) validates records and inputs. Session isolation reuses these dependencies and browser storage; a database/shared workspace would introduce hosting and identity requirements before the critique workflow has been tested. Pure scenario/state functions live in `src/scenario.ts` and `src/model.ts`; `src/journey.ts` derives navigation, status, and outcome explanations from validated state. Storage and UI effects remain in `src/storage.ts`, `src/main.ts`, and `src/render.ts`. Rendered narrative strings are escaped. No storage schema, source fixture, dependency, or decision rule changed for the guidance milestone. Production authentication, shared persistence, concurrent writes within one session, connectors, and secure auditing remain later decisions.

The implemented milestone provides a guided, repeatable local demonstration with explicit next actions and preserved history. Its navigation and record behavior are technically verified; whether the introductions improve practitioner comprehension remains an untested hypothesis. Further expansion requires the reviewer kit's provisional gate: two of three suitable practitioners can explain the trace/history and permission limits without help, and at least one describes recurring reassessment pain and a feasible real-work trial. Simplify or change direction when their process indicates duplication or excess maintenance.

See [tools-and-tracking.md](docs/tools-and-tracking.md) for verified plugin states and the single proposed Linear issue. No external work records were created.

## Visual foundation and site integration

Use [Bridge Node 7](https://bridgenode7.com/) as the visual reference. The user explicitly authorized copying its style. The local [homepage snapshot](design/reference/bridgenode7-home.html) preserves the original inline CSS, typography, orbital mark, and layout. [brand.css](design/brand.css) adapts its exact palette and selected primitives for the app.

Snapshot captured October 4, 2026 at 11:03:28 p.m. America/Los_Angeles from `https://bridgenode7.com/`. SHA-256: `a45e59d3af559b4f592eef317f33b0da4e78746fedb8caa85d7110483e4e3fbd`.

Retain the dark navy surfaces, gold actions, system sans typography, subtle borders, and orbital identity. Evidence comparisons and review controls need readable, restrained layouts, explicit status labels, keyboard access, and mobile stacking. Check accessibility in the implemented screens.

Eventual integration: a branded introduction on the main site linking to the working application, with shared design primitives. A route on the main domain or an application subdomain depends on verified hosting, authentication, and security requirements. The captured homepage policy blocks network connections and forms, so it cannot be reused unchanged for an authenticated application. No main-site files or settings have been changed.

## Working boundaries

Keep secrets and private assessments outside this public repository. Changes stay uncommitted for review until the user explicitly requests a commit. Product decisions remain human responsibilities; automated change detection may propose review, but must not silently revise a decision.
