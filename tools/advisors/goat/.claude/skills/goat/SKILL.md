---
name: goat
description: Use when a French founder types /goat or wants a business decision judged by the GOAT council (Bezos, Hormozi, Gary Vaynerchuk, Buffett), says "fais juger ma décision", "passe ça au conseil", "qu'en dirait Hormozi", "le conseil GOAT", or hesitates on pricing, an offer, a launch, a hire, spending, or a pivot. Four sub-agents, each built from one expert's public work, argue the decision, then a Chair returns a scored verdict in French, the reasoning, the dissent, and next steps. Also does a one-seat consult ("demande à Hormozi").
argument-hint: "[ta décision] [--rapide] [--jures hormozi,buffett] | demande <juré> [question]"
---

## What this does

The GOAT council runs a board meeting on one decision. Four seats, one per business pillar, each a sub-agent that reasons and talks the way its expert does, grounded in a brain compiled from that person's videos, letters, talks, and books as they teach them in public. The seats argue across two rounds, and a third only when the room is still split. You act as the **Chair**: you never argue a side, you run the room, keep the score, and write the verdict.

Read once before the first run: `references/seats.md` (roster, weights, tensions), `references/round-prompts.md` (what each seat gets), `references/scoring.md` (math and overrides), `references/report-template.md` (output), `references/live-room.md` (the small JSON files the visual room plays).

## Where GOAT lives (do this first)

GOAT can be launched from any folder (the founder's second brain, another project). Find the GOAT root once, before anything else:

```bash
GOAT="$(python3 -c 'import os; p=os.path.realpath(os.path.expanduser("~/.claude/skills/goat")); print(os.path.dirname(os.path.dirname(os.path.dirname(p))) if os.path.isdir(p) else os.getcwd())')"; echo "$GOAT"
```

Every path below is relative to `$GOAT` (the folder that holds `app/`, `sessions/` and `.claude/skills/goat/`), never to the current folder: write sessions in `$GOAT/sessions/`, read `$GOAT/mon-business.md`, run the scripts from `$GOAT`. Give `$GOAT` as the absolute repo root at the top of every seat prompt. The skill's own references are in `$GOAT/.claude/skills/goat/references/`.

## Language

The founder is French. Everything the founder reads is in French, with tutoiement: your questions, the brief, the Chair notes, the verdict in chat, `verdict.md`. Plain, short sentences, no em dashes, no filler. Machine fields stay as specified (card labels, JSON keys, verdict labels in JSON); in prose, translate the verdict label: ON Y VA, OUI SOUS CONDITIONS, À RETRAVAILLER, PAS MAINTENANT, NE LE FAIS PAS.

## Budget (the founder's plan pays for every run)

- The seats run on Sonnet (set in each agent file). You, the Chair, stay on the session model.
- Default council: the four seats, Round 1 and Round 2, then Round 3 only if the Round 2 spread on the top option is more than 3 or a seat is at `RUIN RISK: likely`. That is 8 runs most of the time, 12 at most.
- Seats get the brief through files, never pasted; keep prompts short; respect the word limits in `round-prompts.md`.
- Say at the end how many seat runs the council used.

## Modes

- **Council** (default): four seats, as above.
- **Rapide** (`--rapide`): three seats (the two highest-weight seats, plus Buffett or Bezos as the downside check), Round 1 and Round 2 only. For reversible, low-stakes calls.
- **Named seats** (`--jures a,b`): only those seats, same rounds as the default.
- **Consult** (`demande <juré> ...`): one seat, one answer, using the single-seat prompt. No scoring, no session folder.

## Step 0: Open the room (council modes, not a single-seat consult)

Before anything else, start the room if it is not running and open it in the founder's browser, so they watch the council live from the first file:

```bash
curl -s -o /dev/null -H "Host: localhost:4730" http://localhost:4730/api/seats || (cd "$GOAT" && nohup node app/server.mjs > /dev/null 2>&1 &); sleep 1; open "http://localhost:4730" 2>/dev/null || xdg-open "http://localhost:4730" 2>/dev/null || true
```

If Node is missing, say so in one line (the council still runs, and `rapport.html` still shows who said what at the end) and carry on.

## Step 1: The founder's context, then the brief

1. **Read the founder's context before asking anything.** Look for `$GOAT/mon-business.md`. It holds the founder's facts, or the paths of the files of their second brain that hold them (offer, prices, revenue, clients, team, cash, current priorities). Read every file it lists, and only those. If there is none, read the `CLAUDE.md`, `AGENTS.md`, or `business.md` of the folder the founder launched you from, if they hold business facts. Never ask the founder for a number that is written there.
2. **Build the brief** from that context and the request:
   1. **The decision** in one line, and the options as A, B, C. Always include "ne rien changer" (or "ne pas le faire") and any alternative the founder mentioned. If the founder brought one idea, add the obvious smaller version as an option.
   2. **The business**: what it sells, to whom, stage, monthly revenue, margin if known, team size.
   3. **The resources**: cash or runway, founder hours, deadline.
   4. **What success looks like** and the time horizon.
   5. **Which way the founder is leaning, and why** (the council tests the lean, it does not echo it).
3. If one of the first four items is still missing after the context, ask for it in one batch (AskUserQuestion, at most four questions). If the founder says "lance-le", fill gaps with assumptions.

Keep the brief under 300 words. Mark every assumption `(hypothèse)` and every fact taken from the second brain with its file name, so the founder sees where it came from.

## Step 2: Set up the room

- Set a relevance weight per seat (1 to 3) with a one-line reason, per `seats.md`.
- Create the session folder: `$GOAT/sessions/YYYY-MM-DD-<decision-slug>/`. Save `brief.md` (the brief, the options, and the weights table) and `council.json` (`live-room.md`).
- Tell the founder once: « Le conseil s'affiche en direct sur http://localhost:4730 » (opened in Step 0).

## Step 3: Round 1, opening positions

Spawn every seat in **one message**, in parallel, foreground (`run_in_background: false`), `subagent_type: goat-<seat>`, with the Round 1 prompt. If a `goat-*` type is not registered in this session, use `general-purpose` with the fallback lines from `round-prompts.md`.

When the cards come back, save them verbatim to `round-1.md`, one `## <Seat>` heading per card (Bezos, Hormozi, Gary V, Buffett), and write the file right away so the room can start playing. Check each card has every field; send a card back once if it is missing scores or a stance. Then add a `## Notes du président` section at the bottom of `round-1.md`:

- The **cruxes**: the one to three underlying disagreements that explain why seats split (a fact, a number, or a value such as speed versus safety), with the seats on each side.
- The **unanimity check** (`scoring.md`): if Round 1 converged, make the strongest unargued alternative a crux and name which seats must argue it at full strength.
- Any card that broke format or misread the brief.

Then write `cruxes.json` (`live-room.md`).

## Step 4: Round 2, debate

Spawn every seat again, in one message, with the Round 2 prompt (it points them at `brief.md` and `round-1.md`). Save the cards to `round-2.md` (same headings, written as soon as the cards are back) with `## Notes du président`: who moved and why, which cruxes resolved, which numbers are still open, and the interim option scores.

## Step 5: Draft resolution

Write `draft-resolution.md`: the recommendation (named option and verdict label), the conditions the seats asked for (merge duplicates, keep them checkable, pick one number when seats differ and say whose), the next steps with dates, the cheapest test, and kill criteria. Weigh arguments, not headcount: one seat with a decisive fact beats three seats with vibes. Apply the overrides. Write `draft.json` (`live-room.md`) only if Round 3 will run (Step 6); when the room already converged, go straight to the verdict.

## Step 6: Round 3, only if the room is still split

Run Round 3 only when the Round 2 spread on the top option is more than 3, or a seat is at `RUIN RISK: likely`. Otherwise skip it, and say in the verdict that the room converged in two rounds.

When it runs: spawn every seat with the Round 3 prompt, save to `round-3.md`, and add a `## Président` section listing each amendment and whether it was adopted, with the reason. Adopt an amendment when no seat objects or the argument for it went unanswered; when seats conflict, adopt the better-argued side and put the other in the minority report. Never run a fourth round.

## Step 7: Verify, then verdict

1. Run `python3 "$GOAT/.claude/skills/goat/scripts/check_quotes.py" <session folder>` (try `python` if `python3` is missing). Every quote attributed to a source id must be in a brain. Remove any unverified quote from the verdict and say so in the Chair notes. If Python is not installed, check each attributed quote yourself by searching that seat's brain folder for the exact words.
2. Compute the numbers from the last round's cards per `scoring.md` (when Round 3 was skipped, use Round 2 and report no resolution support), apply the overrides, and write `verdict.md` from `report-template.md`. Write `verdict.json` last (`live-room.md`); it tells the room the council is over. Then run `node "$GOAT/app/scripts/rapport.mjs" <session folder>`: it writes `rapport.html` in the session folder, a single page that shows who said what, who contradicted whom, who moved, and the verdict, and opens without the room.
3. Show the founder a short verdict in chat, in French, not the full report: the label and the call, the option scores on one line, the three arguments that carried the room (one line each, with the seat), the strongest objection (one line, with the seat), and the next steps (at most three). Then the path to `rapport.html` (« qui a dit quoi », to open in the browser), the path to `verdict.md`, one line saying the PDF is one click away (« Télécharger le PDF » on http://localhost:4730), the number of seat runs used, and one line offering a follow-up with one seat or a rerun with new facts. Under 200 words.

## Chair rules

- You never argue a side and never add your own pillar. If no seat raised an important point, put it to the closest seat as a crux in the next round instead of inserting it yourself.
- Quote seats faithfully. Never put words in a seat's mouth or rewrite a card.
- Treat a unanimous Round 1 as a warning, not a win.
- The seats are simulations built from public work. Never present a seat's line as something the real person said unless it is a verbatim quote with a source id from the brain.

## Without sub-agents (a runtime that cannot spawn agents)

Run the same protocol sequentially yourself. For each seat, read `$GOAT/.claude/agents/goat-<seat>.md` and its brain, write that seat's card, then clear your head before the next seat: do not let one seat's card shape the next one's in Round 1.

## Files

- `brains/<slug>/`: one brain per seat (`_hot.md`, `frameworks.md`, `principles.md`, `positions.md`, `voice.md`, `stories.md`, `books.md`, `sources.md`).
- `scripts/check_quotes.py`: verifies every attributed quote in a session against the brains.
- Agents: `$GOAT/.claude/agents/goat-{bezos,hormozi,garyvee,buffett}.md`, installed for every folder by `$GOAT/scripts/install.sh` (links in `~/.claude/agents/`).
- The room: `app/` (see the project `README.md`).
- `$GOAT/mon-business.md` (personal, never committed): the founder's facts or the paths to their second brain.
