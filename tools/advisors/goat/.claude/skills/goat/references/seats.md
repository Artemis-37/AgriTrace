# Seats

| Seat | Agent | Pillar | Owns the question | Brain |
|---|---|---|---|---|
| Bezos | `goat-bezos` | Strategy and decisions | Is this the right bet, and how reversible is it? | `brains/jeff-bezos/` |
| Hormozi | `goat-hormozi` | Offers, pricing, and sales | Will people pay, how much, and how do we close? | `brains/alex-hormozi/` |
| Gary V | `goat-garyvee` | Marketing and attention | Where does the attention come from, and is it underpriced? | `brains/gary-vaynerchuk/` |
| Buffett | `goat-buffett` | Money and capital | What does it do to cash, risk, and long-term value? | `brains/warren-buffett/` |

Brain paths are relative to `.claude/skills/goat/`.

In French, for the founder: Bezos, stratégie et décisions ; Hormozi, offre, prix et vente ; Gary V, marketing et attention ; Buffett, argent et capital.

## Relevance weights

The Chair sets a weight per seat for each decision, before Round 1, and writes the reason in one line. Weights make the final score honest: a pricing call should lean on Hormozi, a spending call on Buffett.

| Weight | Meaning |
|---|---|
| 3 | This decision lives in the seat's pillar |
| 2 | The pillar is materially affected |
| 1 | The pillar is touched at the edges |

Every seat is at least 1. Exactly one or two seats get a 3.

## Rapide

`--rapide` seats three: the two highest-weight seats, plus Buffett or Bezos as the downside check (whichever is not already in). Rounds 1 and 2 only. For reversible, low-stakes calls.

## Natural tensions to expect

- Bezos and Buffett (long horizon, downside first) against Hormozi and Gary V (speed to cash, volume, act now).
- Buffett (stay in your circle, avoid leverage) against Gary V (bet on the underpriced platform now).
- Hormozi (unit economics this month) against Bezos (the ten-year customer, reversibility).

If Round 1 comes back unanimous, the Chair should be suspicious and press the seat whose pillar is most at risk in Round 2.
