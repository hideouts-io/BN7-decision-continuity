# Decision Continuity project instructions

- Work in this checkout for application source. Preserve the existing BN7 research and technical-review repositories.
- Follow the user's coding and testing instructions. Inspect existing code before choosing dependencies or introducing abstractions.
- Never create a commit unless the user explicitly requests one. Keep edits uncommitted and reviewable.
- Use public or synthetic evidence for the initial prototype. Do not add secrets, confidential assessments, private correspondence, or personal data to this public repository.
- Preserve source attribution, evidence versions, applicability, assumptions, and uncertainty. Distinguish requested permissions, granted permissions, and observed behavior.
- Require a responsible human and recorded rationale for consequential review outcomes. Preserve prior decision versions when recording a new outcome.
- Decision Continuity has an independent product identity and original visual system documented in README.md. Preserve archived source attribution and existing storage namespaces as compatibility/provenance, not product affiliation. External repository, tracking and hosting migration requires separate authorization.
- Keep Linear authoritative for execution and issue status. TODO.md is the compact milestone/continuation index linking those issues, not a competing task register. Research records remain in their existing authoritative repositories.
- Reviewer research is authorized. Sending outreach, changing production settings, and deployment require a direct user request.

## Repository GitHub workflow

- Verify `codex/decision-continuity`, the current development default, before authorized integration. Keep milestone authorization bounded to its stated task and branch.
- Run `npm run build`, `npm run smoke`, and `npm run rehearse:adapter` as the CI gates. Browser checks use isolated headless Chrome and synthetic data; they do not establish practitioner or production validation.
- Preserve the website's separately pinned demonstration revision. Source integration does not authorize a public build-pin update, release, outreach, or deployment.
