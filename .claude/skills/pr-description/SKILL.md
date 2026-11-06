---
name: pr-description
description: Create GitHub pull requests with a brief, structured description covering why, what changed, screenshots, risks, and before/after performance metrics. Use whenever the user asks to open, create, or write a PR / pull request, or to improve a PR description. Works for web, backend, game, and 3D/asset projects.
---

# PR Description Skill

Create concise, reviewer-friendly GitHub PRs. Brevity matters: every line must earn its place. Never pad sections.

## Workflow

1. **Understand the change.** Run `git status`, `git log <base>..HEAD --oneline`, and `git diff <base>...HEAD --stat` (base is usually `main`/`master`; confirm with `git remote show origin`). Read the actual diff, not just the commit messages.
2. **Pre-flight checks** (report problems, don't silently fix unrelated things):
   - Run the project's lint/tests/build if they exist and are quick.
   - Scan the diff for secrets/keys, debug leftovers (`console.log`, `print`, `TODO`/`FIXME` you added), commented-out code, and unrelated changes. Flag them to the user before opening the PR.
   - **Size check:** if the PR exceeds ~400 changed lines (excluding lockfiles, generated files, and binary assets), warn the user and suggest how to split it. Proceed if they still want it.
3. **Detect the change type** and include only the sections that apply (see below).
4. **Gather evidence** (screenshots, metrics) per the sections below.
5. **Check for a repo PR template** (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, root, or `docs/`). If one exists, use its headings as the layout and fit the sections below into it.
6. **Show the user the title + body for a quick review**, then create the PR with `gh pr create`. Push the branch first (`git push -u origin <branch>`). Open as a normal (ready) PR, not a draft, unless the user asks for a draft.
7. Return the PR URL.

## Title convention

`type(scope): short summary`. Imperative mood, lowercase after the colon, no period, under ~70 characters.

| Type | Use for |
|---|---|
| `feat` | new feature or content |
| `fix` | bug fix |
| `perf` | performance improvement |
| `refactor` | restructure with no behavior change |
| `art` | models, textures, animations, other assets |
| `docs` | documentation only |
| `chore` | tooling, config, dependencies |

Add `!` after the scope for breaking changes: `feat(save)!: change save file format`.
Examples: `feat(player): add double jump`, `perf(renderer): cut draw calls by batching meshes`, `art(models): reduce tree LOD0 to 8k triangles`.

## Body template

Keep the whole body scannable in under a minute. Use this structure, omitting sections that don't apply (see "When to omit").

```markdown
## Why
<1-2 sentences: the problem or goal. Link the issue/ticket: Closes #123>

## What changed
- <3-5 bullets of behavior/approach changes, not a file-by-file list>

## Screenshots
<before/after, see below>

## Risks
<see below>

## Performance
<see below>

## How to test
1. <short steps a reviewer can follow>
Automated: <tests added/run, or "none">

## Review focus
- <where the reviewer should look hardest, and why>
```

### Why
State the reason, not a restatement of the diff. If there's an issue, link it with `Closes #N`. If you can't determine the reason from the code, commits, or branch name, ask the user.

### What changed
3-5 bullets max. Describe what behaves differently or what approach was taken. Do not list files.

### Screenshots (whenever possible)
Show the change visually. Pick the form that fits the project:

- **UI / web:** before/after table.
  ```markdown
  | Before | After |
  |---|---|
  | ![before](url) | ![after](url) |
  ```
  Capture with Playwright (Chromium is typically preinstalled; use `deviceScaleFactor: 2` for screenshots a person will see). Include mobile width if layout changed.
- **Games:** screenshots of the affected scene, or a short GIF/clip (a few seconds) of the new behavior. Before/after if visuals changed.
- **3D models / art:** renders from consistent angles (front, 3/4, wireframe or polygon view if relevant), ideally a turntable GIF. Show before/after side by side with the same camera and lighting.
- **CLI / backend / logs:** terminal output or log excerpts in a code block, before vs. after, when it demonstrates the change.
- **Nothing visual to show** (pure refactor, config, internal logic): omit the section entirely rather than writing "N/A".

Images must render in the PR. Hosting options, in order of preference: commit them to the PR branch under a clearly named folder (e.g. `docs/pr-assets/`) only if the user is fine with that; otherwise ask the user how they'd like to attach images. GitHub's CLI cannot upload images to PR bodies directly, so if hosting isn't possible, save the images to a local folder, tell the user the paths, and leave placeholders (`<!-- drag image here -->`) for them to drag in. Never fake or fabricate screenshots.

### Risks
Be explicit and honest. List each real risk as one line:

```markdown
| Risk | Severity | Blast radius | Mitigation |
|---|---|---|---|
| Migration locks `orders` table | High | All checkout traffic during deploy | Run off-peak; tested on 10M-row copy |
```

- Severity: **Low / Medium / High**.
- Always flag as a callout (`> ⚠️ **Breaking change:** ...`) any API, schema, save-format, config, or env var changes, required deploy ordering, or data migrations.
- Consider: backward compatibility, data loss, security, concurrency, rollout order, dependency upgrades, asset/save-file compatibility, platform differences.
- If there are genuinely none, write one line: `No known risks, <reason, e.g. "docs-only change">`. Don't invent risks to fill space. Don't include a rollback section: rejecting or reverting the PR is the rollback.

### Performance (before / after)
Choose metrics that fit the project type. If unsure which matter, ask the user.

| Project type | Typical metrics |
|---|---|
| Game | avg FPS, 1% low FPS, frame time (ms), memory, load time, draw calls, build size |
| 3D / assets | triangle/vertex count, texture sizes, file size, import/load time, draw calls |
| Web frontend | bundle size, load time / LCP, render time |
| Backend / API | response time (p50/p95), throughput, query time, memory |
| Build / tooling | build time, test time, artifact size |

Format:

```markdown
| Metric | Before | After | Delta |
|---|---|---|---|
| Avg FPS | 58 | 72 | +24% |
| Frame time | 17.2 ms | 13.9 ms | -19% |

_Measured: <machine/scene/test used, N runs>. _
```

Rules:
- **Measure for real.** Where feasible, run the benchmark/scene/test on the base branch and on the PR branch (use `git stash`/`git worktree` to avoid disturbing the work). Prefer several runs and report the median.
- **Always state how it was measured** (machine, scene, dataset, run count) so the comparison is fair and repeatable.
- **Never invent numbers.** If you cannot measure, say so plainly and ask the user for numbers or mark `Not measured, <reason>`.
- If the change cannot plausibly affect performance, write `N/A: <one-line reason>` (e.g. "docs-only change"). If it *could* regress performance but wasn't measured, call that out under Risks.
- Report regressions honestly, with the trade-off that justifies them.

### How to test
Short numbered steps a reviewer can follow, plus what automated tests were added or run.

### Review focus
1-3 bullets pointing at the trickiest or riskiest parts of the diff.

## When to omit sections

Tailor to the change type so small PRs stay small:

| Change type | Keep | Usually omit |
|---|---|---|
| UI / visual | all | none |
| Game / 3D / art | Why, What, Screenshots, Risks, Performance, Review focus | How to test if trivial |
| Backend / API | Why, What, Risks, Performance, How to test, Review focus | Screenshots (unless output helps) |
| Refactor | Why, What, Risks, Performance (to show no regression), Review focus | Screenshots |
| Docs / typo | Why, What | Screenshots, Risks, Performance, How to test, Review focus |
| Dependency bump / chore | Why, What, Risks | Screenshots, Review focus |

## Writing style

- Plain, direct sentences. No filler ("This PR aims to...", "I decided to...").
- Past or present tense consistently; the title is imperative.
- Don't repeat the diff. Explain intent and consequences.
- Don't mention which AI model was used in the title, body, or commits.
- When creating the PR, follow any attribution lines given in the session context for PR descriptions.

## Creating the PR

```bash
git push -u origin <branch>
gh pr create --base <base> --title "<title>" --body-file <path-to-body.md>
```

Write the body to a temp file and use `--body-file` to avoid shell-escaping problems. Do not add reviewers, labels, or assignees unless the user asks. Only create the PR when the user has asked for one.
