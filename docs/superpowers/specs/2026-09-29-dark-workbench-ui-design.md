# Dark workbench UI redesign

**Status:** design for review  
**Date:** 2026-09-29

## Goal

Give Agentic QA a cohesive, desktop-first interface that feels at home beside developer tools such as VS Code. Use a fully dark visual system, make the account-to-run workflow easier to scan, and make every existing screen feel deliberate and usable. Preserve the current product behavior and local-first security boundaries.

## Current UI observations

- The persistent navy sidebar sits beside mostly white content panels, so the app does not feel like one visual system.
- Labels, helper text, controls, and secondary buttons often have similar visual weight. At common desktop widths, important content is easy to miss.
- Settings puts several long fields into a dense row; saved project IDs and form values clip, and explanatory text can span an entire card.
- The four main navigation items are mixed with step numbers for a longer workflow, which makes the progress numbering feel inconsistent.
- Search errors can expose low-level IPC and transport wording directly in a prominent banner.
- Queue and Runs empty states use large sparse panels without enough orientation about the next step.

## Design direction

Use a dark workbench shell with a stable left navigation rail, a compact context header, and one consistent content canvas. Keep the existing destinations: Work items, QA Queue, Runs, and Settings. Use a smaller onboarding progress treatment only while the user is connecting an account and choosing an organization or project; do not number the main navigation as a wizard.

### Visual system

- Base the palette on familiar editor-dark surfaces: deep charcoal application background, a slightly differentiated sidebar, raised charcoal panels, and subtle neutral borders.
- Use high-contrast light text for headings and body copy; reserve muted text for secondary descriptions that remain readable.
- Use a restrained blue accent for primary actions and keyboard focus. Keep status colors semantic and limited to success, warning, error, and blocked states.
- Define color, spacing, radius, type size, and focus tokens in one place in the renderer stylesheet. Avoid per-screen one-off colors.
- Maintain a comfortable text and control scale at 800px width and above. Let panels and forms reflow before fields become too narrow.

### Shared application shell

- Keep a persistent navigation rail with product mark, the four destinations, selected-state styling, and a compact local-storage indicator.
- Keep the current account and organization/project visible in the top context bar. Long values truncate safely while their full text remains available to assistive technology.
- Use consistent page headers: small section label when useful, clear title, one-sentence description, and page actions aligned in a predictable location.
- Use consistent panel, table/list, button, input, select, status, and empty-state components. Every interactive control has a visible hover, focus, disabled, and active state.

### Screen layouts

- **Sign in:** focused first-run page with a clear Azure DevOps sign-in action, concise read-only/local-data explanation, and a visible CLI availability or sign-in status.
- **Organization and project setup:** guided selection surface with saved organizations, organization validation, project list, and clear back/continue actions. Keep the signed-in account context visible.
- **Work items:** search and filter controls grouped into a compact toolbar, followed by scannable work-item results. Keep acceptance criteria and child-task context available without crowding the result title and metadata.
- **QA Queue:** show item count, grouping by organization/project, stale-source status, ordering/removal controls, and one prominent Start QA action. Empty state explains the next step.
- **Run setup and plan review:** make target selection, preflight, plan summary, criteria coverage, task context, and approval a clear sequence. Keep the user-visible disclosure and approval requirements from the existing specification.
- **Runs and reports:** make empty history actionable; give saved runs a readable status, target, date, and summary. Preserve report details and review controls.
- **Settings:** divide account, organization, run profiles, and optional AI provider configuration into clearly named sections. Stack fields vertically or use balanced columns only when they retain readable labels and values. Keep helper text close to the relevant field and avoid wide disclaimer paragraphs.

### Content and interaction

- Preserve current IPC calls, saved data, account/profile switching, read-only ADO calls, queue behavior, plan approval, execution, and report review.
- Keep ADO, worker, and model errors actionable. Map known technical failures to concise UI messages and a next step; retain technical details in diagnostic logs rather than displaying raw IPC method names or stack details.
- Use explicit loading, empty, disconnected, validation, success, error, and disabled states. Avoid blank panels during transitions.
- Keep all current keyboard and screen-reader behavior. Add or preserve semantic headings, labels, status roles, button names, and visible keyboard focus.
- Do not add new permissions, ADO write actions, telemetry, or data collection as part of visual cleanup.

## Implementation boundaries

- Limit product changes to the existing desktop renderer, its renderer tests, and UI-specific documentation if acceptance details change.
- Keep main-process IPC contracts and persistence formats unchanged unless a UI defect cannot be corrected at the presentation boundary; any such dependency requires a separate design update.
- Do not change the ADO integration, account authentication, QA verdict rules, or worker security model.
- Preserve unrelated user changes already present in the working tree. Do not create a worktree, commit, push, or package a release.

## Verification and Playwright review loop

Use Playwright against the desktop renderer or Electron window with controlled local fixture data. Cover:

1. First launch, account-connected state, organization/project setup, and switching into the workspace.
2. Work-item search and result display, child-task expansion, and queue additions.
3. Empty and populated Queue states, reorder/remove controls, and Start QA navigation.
4. Run setup, plan review, approval affordances, run history, and report details using mocked/local data so no real QA job is launched.
5. Settings sections, profile entry/switching affordances, organization management, provider settings, validation, and disabled states.
6. Keyboard-only navigation and focus visibility across primary flows.
7. Layout at 800px and a typical desktop width; check horizontal overflow, clipped text, contrast, and control alignment.

For each iteration, capture the visible state, inspect the screenshot and DOM, fix the issue, and repeat the relevant flow. Do not submit real ADO changes, launch an external QA run, or use real secrets during UI checks.

## Acceptance criteria

- Every primary screen uses the same dark palette with readable text and visible focus treatment.
- Main navigation, selected organization/project context, page heading, and primary action are easy to identify.
- At 800px and desktop widths, the listed screens have no horizontal page overflow or clipped form values.
- Settings fields have readable labels, values, helper text, and responsive grouping.
- Search, queue, run, and settings flows retain their existing behavior and states.
- Raw transport/IPC wording is not presented as ordinary user-facing error copy where the renderer can identify and translate it.
- Playwright review covers the flows and widths above, with any remaining limitations recorded in the handoff.
