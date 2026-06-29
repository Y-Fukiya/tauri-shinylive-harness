# Clinical Review Sandbox Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the harness as an offline clinical review sandbox and add the policy, evidence, release, and audience-facing material needed for safe synthetic-data evaluation.

**Architecture:** Keep the existing harness CLI and generated evidence flow. Add policy/docs as source artifacts, add strict preflight modes to existing Node scripts, and keep release/source packaging separated through explicit manifest-producing commands.

**Tech Stack:** Node.js ESM scripts, existing zero-dependency CLI helpers, Markdown docs, React portal copy, existing `node:test` unit tests.

---

### Task 1: Policy and Positioning

**Files:**
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `README.ja.md`
- Create: `docs/phi-pii-policy.md`
- Create: `docs/data-handling-boundary.md`
- Create: `docs/security-threat-model.md`
- Modify: `README.md`

- [ ] Add MIT license and third-party notices.
- [ ] Normalize the project position to "Offline Clinical Review Sandbox for Shinylive/webR Apps".
- [ ] Add PHI/PII prohibition and unified clinical-use limitation in English and Japanese.
- [ ] Document localhost server trust assumptions, known risks, and mitigations.

### Task 2: Clinical Audience Documentation

**Files:**
- Create: `docs/clinical-audience-guide.md`
- Create: `docs/clinical-reviewer-quickstart.md`
- Create: `docs/data-manager-quickstart.md`
- Create: `docs/medical-monitor-quickstart.md`
- Create: `docs/stat-programmer-quickstart.md`
- Create: `docs/qa-validation-quickstart.md`
- Create: `docs/demo-medical-monitor-10min.md`
- Create: `docs/demo-safety-review-10min.md`
- Create: `docs/demo-data-manager-10min.md`
- Create: `docs/clinical-review-exercises.md`
- Create: `docs/clinical-review-answer-key.md`
- Create: scenario and evidence guide docs.

- [ ] Write role-specific "how to evaluate" guides, not feature lists.
- [ ] Add three 10-minute demo scripts.
- [ ] Add review exercises and answer key using synthetic subjects only.
- [ ] Add scenario docs for all bundled synthetic data packs.

### Task 3: Strict Verification and Packaging

**Files:**
- Modify: `scripts/harness.mjs`
- Modify: `scripts/harness-core.mjs`
- Modify: `scripts/reproducibility-report.mjs`
- Modify: `scripts/template-package.mjs`
- Modify: `package.json`
- Modify: `scripts/harness-core.test.mjs`

- [ ] Add `doctor:release`.
- [ ] Add `audit:reproducibility:strict`.
- [ ] Improve `verify-static` missing-build guidance.
- [ ] Add source-template packaging command and manifest.
- [ ] Keep generated release candidates and source templates clearly separated.

### Task 4: Verification

**Commands:**
- `npm run validate:config`
- `npm run validate:data`
- `npm run smoke:multi-app`
- `npm run test:unit`
- `npm run verify`
- `npm run verify:release`

- [ ] Run fresh local verification.
- [ ] Commit and push after checks pass.
