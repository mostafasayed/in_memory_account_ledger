# WORKLOG

Times are local (GMT+4). Built by Mostafa Hanafy with Claude Code (Opus) as an AI pair.

Each entry is tagged with who did the work:
- **[Me]**: me, Mostafa.
- **[AI]**: the AI, in response to my prompts.
- **[Me+AI]**: a decision or review we made together (the AI proposed, I accepted or challenged).

Times without `~` come from `date` or git at the moment of writing. Entries marked `~` were reconstructed from the chat session afterwards and are approximate.

> **History note.** Before the first push, on 2026-09-29 at 13:58, the commit history was rewritten with `git filter-branch` to remove earlier drafts of this file.
> - Those drafts were AI-written in the first person and over-credited me. The attribution was corrected (see 12:12 below), and the drafts were then removed from history.
> - One commit that only touched this file was dropped, and two commit messages lost their "worklog" wording.
> - No code, test or other document content was altered.
> - Author dates are original; committer dates show the rewrite time.

## 2026-09-29

- **10:32** [Me] Created the repo (initial commit).
- **10:38** [Me+AI] Read the brief and planned the approach with the AI before writing any code, starting with a breakdown of what the brief requires: the deliverables, the non-negotiable rules, and which acceptance criteria look wrong.
- **~10:45** [AI] Hand-replayed E1–E10 for ACC-001 in the chat. Key finding: E7 (booked Day 5, value Day 2) makes Days 2, 4 and 5 negative, so 3 fees, not 1. Proposed rejecting criteria 2, 4, 6, 7 and 8, and flagged 5 as true but with a false premise (Auth-B is declined).
- **~10:55** [Me+AI] Discussed the analysis with the AI: what Auth-A and Auth-B are (holds vs. settlements), the reasoning behind each criterion verdict, the Day 1–6 trajectory, each ambiguity, the failing-test idea, and how to handle an AED fee on a BHD account. I raised whether amounts should be stored as integers (e.g. AED 12.23 as minor units).
- **~11:00** [AI] Explained each point in detail. Corrected its own earlier answer to criterion 8: "carry the remainder forward" was the wrong framing, because the rule defines the capitalized total as the sum of the rounded accruals. Also pointed out a typo in my question (AED 12.23 is `1223` minor units, not `1224`).
- **~11:10** [Me+AI] Settled the design with the AI and gave the go-ahead:
  - **Integer minor units**, following my question on integer storage. Floats can't hold money exactly (0.1 + 0.2 ≠ 0.3); integers keep AED at 2 decimals and BHD at 3 with explicit rounding.
  - TypeScript + Bun.
  - Auth-Z force-posted with an error.
  - Fees kept after the E9 reversal.
  - No AED fee on non-AED accounts: flag an error instead of inventing an FX rate.
  - Test strategy: one test per acceptance criterion (for rejected criteria, assert the behaviour chosen instead), plus one annotated failing test against the design.
- **11:11** [AI] Scaffolded the project (Bun, TypeScript strict, Biome).
- **11:12** [AI] Wrote `src/money.ts` and `src/ledger.ts`. Biome reformatted the E1–E10 table into 90 lines; the AI restored one event per line with `biome-ignore format`. Bumped the TS target to ES2023 for `findLast`.
- **11:13** [AI] First `bun run replay` matched the chat hand-replay exactly: 250 → 250 → 650 → 285 → −410 → 210.69; fees on Days 2, 4 and 5; Auth-B declined; interest AED 0.69 / BHD 0.008.
- **11:14** [AI] Wrote the test suite. One test failed on the first run, and the test was wrong, not the ledger: a BHD account negative on Days 1 and 2 correctly gets one `NO_FEE_SCHEDULE` flag per day. Fixed the assertion, not the code.
- **11:15** [AI] Added the intentional failing test (arrival-order independence). The predicted diff (285.79, 0 fees, Auth-B approved) matched the actual one.
- **11:17** [AI] Wrote NUMBERS, AMBIGUITIES and REJECTED. While writing REJECTED, the AI caught its own arithmetic error: the exact unrounded interest is AED 0.702, not 0.692. That flips the accuracy argument about carry-forward rounding, so the AI rewrote that entry around auditability instead and recorded the correction.
- **11:18** [AI] Wrote the README and checked every number in it against `bun run replay` and `bun test`.
- **~11:25** [Me+AI] Reviewed the finished work with the AI before submission. Identified three things to check: WORKLOG attribution, defense prep (the Day 5 walkthrough and the criterion 4 argument), and an optional fee-refund exercise.
- **12:12** [Me] Asked the AI to fix the attribution in this file. Earlier entries were written in first person, which credited me with work the AI did (the hand-replay and both self-corrections). Rewrote them with [Me]/[AI] tags.
- **12:21** [Me] Switched to `scratch/fee-refund` to try the fee-refund rule myself. Wrote the refund check in `Ledger.endOfDay`; my first attempt placed it outside the account/day loops and failed typecheck (10 errors), so I learned `account`/`d` only exist inside those loops.
- **~12:40** [Me] Weighed adopting vs. discarding the refund rule. Decided not to adopt: the brief defines fee assessment but not refunds, and the rule can't undo the Auth-B decline. Kept the experiment on the scratch branch for reference.
- **~13:55** [Me] Chose to rewrite the history before the first push to remove earlier WORKLOG drafts, with the rewrite disclosed in this file and the README.
- **13:58** [Me+AI] At my request, the AI rewrote the commit history before the first push to remove the earlier drafts of this file, and added the history note at the top and in the README. Verified that the only difference between the old and new branch tips is this file.
- **14:00** [AI] At my request, closed three gaps in the design, each as its own commit:
  - **Over-settlement:** settlements above their hold are now flagged `SETTLEMENT_EXCEEDS_HOLD`, with no tolerance (NUMBERS #15).
  - **Fee spiral:** added a test showing a fee alone can trigger the next day's fee (AMBIGUITIES B3).
  - **Refunded fee days:** documented whether a refunded fee day could be charged again (AMBIGUITIES B7).
  - The main scenario's output is unchanged.
- **~14:00** [Me] Reviewed the code again while the AI worked on the three design gaps.
- **14:16** [AI] At my request, cut the Part 2 document from 2,471 words to about 1,600 to meet the 2–4 page limit, and rendered it to `Architecture-and-Trade-offs.pdf` (3 pages, A4). The markdown went through make-pdf to HTML, then a compact print stylesheet, then headless Chrome. Dropped the `bigint` row as not a real risk.
