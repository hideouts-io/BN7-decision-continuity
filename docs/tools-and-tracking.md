# Tools and Linear tracking

Read-only connection snapshot checked October 5, 2026. No plugins were installed, permissions changed, or external records created.

The guided synthetic evidence-to-review workflow, reviewer kit, and repeatable isolated sessions are implemented locally. State-aware next actions, expandable evidence relationships, and outcome explanations are derived from existing records; earlier demo history remains preserved. See the [README](../README.md) for implementation and run directions, and the [reviewer kit](reviewer-kit.md) for the protocol and unsent invitation. Practitioner usability, demand, and operational impact remain unvalidated.

| Tool | Verified state | Contribution and access |
| --- | --- | --- |
| GitHub | Installed; connector reads public `hideouts-io/BN7-decision-continuity`. Repository remains empty remotely. | Authoritative source home when publication is requested. Metadata/read access suffices now; no connector writes are needed for local implementation. |
| Linear | Installed and readable; workspace/team **Hideouts-BN7**. No active projects or suitable product issue; only onboarding HID-1 through HID-4, all Todo. | Read existing work and prepare the issue below. External project/issue creation requires requested write access. |
| Figma | Discovered as available but uninstalled; account/file access unverified. | Defer. Useful for editable shared designs if feedback justifies them; the browser demo already provides interactive design. Future access should target the selected design file. |
| Replit | Discovered as available but uninstalled; account/project access unverified. | Defer. Shared editing/previews may later help; this milestone runs locally. Selected-project and deployment access are separate. GitHub remains authoritative for code. |

GitHub metadata reports broad repository permissions; only reads were performed. App approval settings are not OAuth scope evidence. Linear's native GitHub selection cannot be verified through the exposed tools used here. GitHub plugin access does not establish that Linear's native integration includes the new repository; its earlier restriction was not expanded.

These are development tools. No customer connector is implemented. A finished-app Linear connection needs evidence that reviewers require reassessment in their existing Linear queue. GitHub source monitoring similarly needs a validated repository-evidence workflow and appropriately scoped customer access.

No new plugin is required for this local milestone. Only GitHub and Linear read operations were used to verify this snapshot; no connector write permissions were exercised.

## Proposed issue — not created

**Project:** Decision Continuity — First Pilot

**Milestone:** Guided reviewer demonstration

**Issue:** Make synthetic decision review understandable and traceable

**State:** Implemented locally; this proposed issue has not been created externally.

**Scope:** Explain each section's purpose and next action; derive workflow guidance from the selected comparison and recorded review; let a reviewer expand evidence → assumption → decision → review reasoning and understand outcome choices. Preserve existing session isolation, explicit local-link and causal validation, JSON exports, deferred/later outcomes, and the original decision basis. Navigation remains read-only. Practitioner critique, production infrastructure, export import, and private facilitator scoring are outside the implemented scope.

**Dependencies:** Existing TypeScript/Vite/Zod application, validated synthetic state and local sessions, native HTML navigation/disclosure, local Node runtime, and real-browser checks. No new package or plugin is needed. Reviewer commitment, Figma/Replit connections, live integrations, authentication, and deployment are not dependencies.

**Acceptance criteria:**

- New session creates an isolated synthetic workflow without deleting, resetting, or overwriting existing sessions or legacy demo history.
- The session selector resumes the selected stored workflow after reload; evidence, reviews, outcomes, and original versions remain isolated between sessions.
- Session IDs identify records without participant identities. JSON exports and filenames include session identity and export time while retaining decision history.
- Next-step guidance distinguishes original evidence, unchanged control, changed request, pending/deferred review, and recorded final outcome using validated records.
- Fragment navigation and expandable relationship nodes move focus/reveal reasoning without selecting evidence, opening a review, or recording a decision.
- Review guidance explains disabled or hidden actions; an unchanged comparison does not close a pending/deferred review or undo a final outcome. Outcome definitions never choose an outcome for the person.
- Requested/granted/observed distinctions, rationale requirements, causal ordering, explicit invalid-record errors, and immutable original history remain intact.
- Build, complete real-browser smoke, keyboard, narrow-screen, automated accessibility checks, and desktop/mobile visual inspection pass. Evidence and limits are recorded in [verification.md](verification.md).
- The README and reviewer kit reflect the implemented walkthrough without adding a duplicate protocol or task register.
- Completion establishes local demonstration behavior; practitioner comprehension and usefulness still require the reviewer kit's validation gate.

When issue creation is requested, use this single issue and link authoritative repository documents after publication is authorized. Do not copy complete documents into Linear or create a parallel register. Split work only when separate ownership/dependencies make it useful.
