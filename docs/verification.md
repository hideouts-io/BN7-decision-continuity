# Demonstration verification

Local verification on October 4–5, 2026 (America/Los_Angeles), using Node 26.10.0, strict TypeScript 7.0.2, Vite 8.3.2, Playwright 1.63.0, and installed Google Chrome. Final type/build and smoke checks passed. No release was deployed.

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

The repeatable check is `scripts/smoke.ts`. It starts its own strict-port server on 5189, uses five-second locator timeouts, and closes its isolated browser and server afterward. Screenshots are local ignored files under `output/playwright/`; `usability-before-*`, `usability-after-*`, and `usability-impact-*` retain the local visual comparison and expanded-path inspection.

Limits: checks do not establish practitioner usability, real identity, secure audit storage, cross-device synchronization, concurrent multi-user writes, production integration, or market demand. Automated checks do not establish complete accessibility; assistive-technology testing and additional browsers/devices remain pending. Visible control labels make reviewer critique guided comprehension rather than blinded detection.
