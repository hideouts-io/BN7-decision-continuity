# Demonstration verification

Local verification on October 4–5, 2026 (America/Los_Angeles), using Node 26.10.0, strict TypeScript 7.0.2, Vite 8.3.2, Playwright 1.63.0, and installed Google Chrome. Final type/build and smoke checks passed for preset v1, manual-version v2, and critique-packet preparation/rehearsal. No release was deployed.

| Check | Observed result |
| --- | --- |
| `npm run build` | Type checking and static build passed. |
| `npm run smoke` | Real-browser workflow passed in isolated browser contexts. |
| State-aware guidance | Next-action destinations change with original/control/changed evidence, open/deferred review, and recorded outcomes; resuming a session restores the appropriate guidance. |
| Read-only exploration | Keyboard/fragment navigation moves focus to the section. Expanding the assumption and visiting review leave persisted state unchanged and never open a review automatically. |
| Outcome explanations | Selecting an outcome changes its explanation without recording a decision; required rationale and scope still gate submission. |
| Unchanged control | No review opened; original decision preserved. |
| Changed request | Write request traces SRC-001 / EV-002 → ASM-001 → DEC-001.1. Declared grant and unobserved runtime remain distinct. |
| Human outcome | Opening review hides its completed opening action and creates no outcome; empty/whitespace rationale blocks recording. Actor, rationale, and scope are preserved. |
| History/reload | Original approval remains; reviewed evidence survives reload and JSON export. Control selection retains outcomes. |
| Deferral | Keyboard-recorded deferral leaves review open. Selecting the control hides the form and guides back to EV-002 without changing the review/outcome; returning permits a later appended final record. |
| Session isolation | Keyboard New session creates an unused UUID record. Switching and reload preserve each history and the legacy record exactly; actions in another session/tab do not alter the current outcome. |
| Export identity | JSON metadata and filename include the selected session ID and export time; exported state matches that session. |
| Accessibility | axe WCAG A/AA tagged checks found no violations in tested states. Keyboard skip link, source/review activation, focus, and form submission passed. |
| Narrow layout | At 375 × 812, no horizontal overflow; the same automated accessibility scan passes. |
| Visual inspection | Desktop 1440 × 1000 and mobile 375 × 812 screenshots show readable session controls, wrapped identifiers, and the retained BN7 visual style. |
| Invalid storage | Incompatible data and a saved outcome after a terminal outcome raise visible ZodErrors, disable editing, and remain stored. These expected errors are deliberately exercised, not smoke failures. |
| Causal order and local links | An outcome predating its review is rejected. A missing named-session URL raises a clear error without fabricating data. |
| V1 compatibility | Explicitly creating v2 sessions leaves every previously captured v1 key and raw stored value unchanged; v1 workflow/review/export still pass. |
| Manual capture | Keyboard entry records one immutable EV-004 with required synthetic source note, UTC capture, independent request/grant values, source event and unobserved runtime. No review or outcome is created automatically. |
| Entry validation | Empty selections, whitespace note, pre-original and future captures do not save data; corrected input remains usable without a global error. |
| Rule coverage | Grant-only change is visible and explicitly outside the request-assumption trigger. No false unchanged/read-only-grant claim appears. Requested write access triggers the existing linked-assumption rule. |
| Exact review basis | Review/outcomes retain EV-001/EV-004 and explicit source-event UUIDs. EV-002 selection cannot receive an outcome for EV-004; returning resumes the deferred review and appends a final record. |
| Authored persistence/export | Note, original capture, both outcome snapshots and session identity survive reload and JSON export; authoring/selection cannot edit the saved capture. |
| Authored invalid storage | Altered snapshot, wrong source-event reference and reversed capture time raise visible ZodErrors and retain the original raw stored data for inspection. |
| Authored interface | Native keyboard capture/review, 375 × 812 no-overflow layout, axe tagged checks on entry/review/history, and desktop/mobile screenshot inspection pass. |
| Packet filesystem | Actual generator creates a new external directory with mode 0700 and files 0600. Source/artifact hashes agree; missing/relative arguments, an existing destination and a symlink into the checkout are rejected. Rejected duplicate execution leaves existing artifacts unchanged. |
| Packet rehearsal | Generated Source B fields reach an isolated v2 session, linked review, synthetic deferred outcome, reload and exact JSON export. UTC instants are compared after the app's ISO normalization; no participant observations or consent are fabricated. |
| Handout layout | Screenshots inspected at 1440 × 1000 and 375 × 812: readable source fields and no horizontal overflow. Print-media Source B has black text on white with readable rows. Physical printer pagination remains untested. |


The repeatable check is `scripts/smoke.ts`, which also runs `scripts/version-smoke.ts` for the authored workflow and `scripts/critique-smoke.ts` for actual packet filesystem boundaries and generated-input rehearsal. It starts its own strict-port server on 5189, uses five-second locator timeouts, and closes its isolated browser and server afterward. Screenshots are local ignored files under `output/playwright/`; `usability-before-*`, `usability-after-*`, and `usability-impact-*` retain the local visual comparison and expanded-path inspection. `version-entry-desktop.png`, `version-entry-mobile.png`, `version-review-desktop.png`, and `version-history-mobile.png` retain the authored-flow inspection. `critique-cards-desktop.png`, `critique-cards-mobile.png`, and `critique-card-print.png` retain the handout inspection. The packet layout was inspected through a temporary loopback server serving only synthetic HTML; private observations were not served.

Limits: checks do not establish practitioner usability, real identity, secure audit storage, cross-device synchronization, concurrent multi-user writes, production integration, or market demand. Automated checks do not establish complete accessibility; assistive-technology testing and additional browsers/devices remain pending. Visible control labels make reviewer critique guided comprehension rather than blinded detection.

Figma is a separate design artifact. Its earlier creation/editing and prototype-connection metadata were verified, but screenshots revealed clipping/overlap. Fresh metadata and screenshot requests are now blocked because the authenticated Starter/View account lacks edit access to the existing file. Design acceptance remains incomplete in HID-6, linked from [tools-and-tracking.md](tools-and-tracking.md). App screenshot/browser results do not establish Figma visual acceptance.
