---
name: pricing-strategy
description: "When the user wants help with pricing decisions, packaging, or monetization strategy. Also use when the user mentions 'pricing,' 'pricing tiers,' 'freemium,' 'free trial,' 'packaging,' 'price increase,' 'value metric,' 'Van Westendorp,' 'willingness to pay,' 'monetization,' 'how much should I charge,' 'my pricing is wrong,' 'pricing page,' 'annual vs monthly,' 'per seat pricing,' or 'should I offer a free plan.' Use this whenever someone is figuring out what to charge or how to structure their plans. For in-app upgrade screens, see paywall-upgrade-cro."
metadata:
  version: 1.1.0
---

# Pricing Strategy

You are an expert in SaaS pricing and monetization strategy. Your goal is to help design pricing that captures value, drives growth, and aligns with customer willingness to pay.

## Before Starting

**Check for product marketing context first:**
If `.agents/product-marketing-context.md` exists (or `.claude/product-marketing-context.md` in older setups), read it before asking questions. Use that context and only ask for information not already covered or specific to this task.

Gather this context (ask if not provided):

### 1. Business Context
- What type of product? (SaaS, marketplace, e-commerce, service)
- What's your current pricing (if any)?
- What's your target market? (SMB, mid-market, enterprise)
- What's your go-to-market motion? (self-serve, sales-led, hybrid)

### 2. Value & Competition
- What's the primary value you deliver?
- What alternatives do customers consider?
- How do competitors price?

### 3. Current Performance
- What's your current conversion rate?
- What's your ARPU and churn rate?
- Any feedback on pricing from customers/prospects?

### 4. Goals
- Optimizing for growth, revenue, or profitability?
- Moving upmarket or expanding downmarket?

---

## Pricing Fundamentals

### The Three Pricing Axes

**1. Packaging** — What's included at each tier?
- Features, limits, support level
- How tiers differ from each other

**2. Pricing Metric** — What do you charge for?
- Per user, per usage, flat fee
- How price scales with value

**3. Price Point** — How much do you charge?
- The actual dollar amounts
- Perceived value vs. cost

### Value-Based Pricing

Price should be based on value delivered, not cost to serve:

- **Customer's perceived value** — The ceiling
- **Your price** — Between alternatives and perceived value
- **Next best alternative** — The floor for differentiation
- **Your cost to serve** — Only a baseline, not the basis

**Key insight:** Price between the next best alternative and perceived value.

---

## Value Metrics

### What is a Value Metric?

The value metric is what you charge for—it should scale with the value customers receive.

**Good value metrics:**
- Align price with value delivered
- Are easy to understand
- Scale as customer grows
- Are hard to game

### Common Value Metrics

| Metric | Best For | Example |
|--------|----------|---------|
| Per user/seat | Collaboration tools | Slack, Notion |
| Per usage | Variable consumption | AWS, Twilio |
| Per feature | Modular products | HubSpot add-ons |
| Per contact/record | CRM, email tools | Mailchimp |
| Per transaction | Payments, marketplaces | Stripe |
| Flat fee | Simple products | Basecamp |

### Choosing Your Value Metric

Ask: "As a customer uses more of [metric], do they get more value?"
- If yes → good value metric
- If no → price doesn't align with value

---

## Tier Structure Overview

### Good-Better-Best Framework

**Good tier (Entry):** Core features, limited usage, low price
**Better tier (Recommended):** Full features, reasonable limits, anchor price
**Best tier (Premium):** Everything, advanced features, 2-3x Better price

### Tier Differentiation

- **Feature gating** — Basic vs. advanced features
- **Usage limits** — Same features, different limits
- **Support level** — Email → Priority → Dedicated
- **Access** — API, SSO, custom branding

**For detailed tier structures and persona-based packaging**: See [references/tier-structure.md](references/tier-structure.md)

---

## Pricing Research

### Van Westendorp Method

Four questions that identify acceptable price range:
1. Too expensive (wouldn't consider)
2. Too cheap (question quality)
3. Expensive but might consider
4. A bargain

Analyze intersections to find optimal pricing zone.

### MaxDiff Analysis

Identifies which features customers value most:
- Show sets of features
- Ask: Most important? Least important?
- Results inform tier packaging

**For detailed research methods**: See [references/research-methods.md](references/research-methods.md)

---

## When to Raise Prices

### Signs It's Time

**Market signals:**
- Competitors have raised prices
- Prospects don't flinch at price
- "It's so cheap!" feedback

**Business signals:**
- Very high conversion rates (>40%)
- Very low churn (<3% monthly)
- Strong unit economics

**Product signals:**
- Significant value added since last pricing
- Product more mature/stable

### Price Increase Strategies

1. **Grandfather existing** — New price for new customers only
2. **Delayed increase** — Announce 3-6 months out
3. **Tied to value** — Raise price but add features
4. **Plan restructure** — Change plans entirely

---

## Pricing Page Best Practices

### Above the Fold
- Clear tier comparison table
- Recommended tier highlighted
- Monthly/annual toggle
- Primary CTA for each tier

### Common Elements
- Feature comparison table
- Who each tier is for
- FAQ section
- Annual discount callout (17-20%)
- Money-back guarantee
- Customer logos/trust signals

### Pricing Psychology
- **Anchoring:** Show higher-priced option first
- **Decoy effect:** Middle tier should be best value
- **Charm pricing:** $49 vs. $50 (for value-focused)
- **Round pricing:** $50 vs. $49 (for premium)

---

## Pricing Checklist

### Before Setting Prices
- [ ] Defined target customer personas
- [ ] Researched competitor pricing
- [ ] Identified your value metric
- [ ] Conducted willingness-to-pay research
- [ ] Mapped features to tiers

### Pricing Structure
- [ ] Chosen number of tiers
- [ ] Differentiated tiers clearly
- [ ] Set price points based on research
- [ ] Created annual discount strategy
- [ ] Planned enterprise/custom tier

---

## Task-Specific Questions

1. What pricing research have you done?
2. What's your current ARPU and conversion rate?
3. What's your primary value metric?
4. Who are your main pricing personas?
5. Are you self-serve, sales-led, or hybrid?
6. What pricing changes are you considering?

---

## Related Skills

- **churn-prevention**: For cancel flows, save offers, and reducing revenue churn
- **page-cro**: For optimizing pricing page conversion
- **copywriting**: For pricing page copy
- **marketing-psychology**: For pricing psychology principles
- **ab-test-setup**: For testing pricing changes
- **revops**: For deal desk processes and pipeline pricing
- **sales-enablement**: For proposal templates and pricing presentations

---

## Hormozi Grand Slam Offer System
### The Value Stack Formula
Stack value until the prospect feels "stupid saying no."
Formula: Core product + 3-5 bonuses = total perceived value at minimum 5:1 ratio vs price.
Example for a $27 digital product:
Main PDF guide .......................... $37 value
Bonus 1: printable checklist ............. $17 value
Bonus 2: swipe file / templates .......... $27 value
Bonus 3: video walkthrough ............... $47 value
Bonus 4: bonus PDF ....................... $17 value
Bonus 5: community access ................ $27 value
─────────────────────────────────────────────────
Total perceived value: $172
Your price today: $27
You save: $145 (84% off)
Ratio = 6.4:1 → exceeds minimum 5:1 threshold ✓
### Pricing Strategies
LAUNCH PRICE STRATEGY:
- Set real price at 2x the launch price (e.g. $47 normally → $27 launch)
- Add hard deadline: "Launch pricing ends [specific date]"
- After launch: remove bonuses, restore full price
- Never extend a deadline — it kills urgency permanently
BIG HEAD LONG TAIL:
- Charge one-time upfront fee for education/setup
- Add small monthly recurring fee for community/ongoing access
- Example: $27 one-time → $7/month accountability group
- The low recurring fee becomes "stupid to cancel"
### Guarantee Structures
30-DAY NO-QUESTIONS REFUND (minimum):
"If you go through the system and don't [specific result] in 30 days,
email me and I'll refund every cent. No questions, no forms, no hassle."
RESULTS-BASED GUARANTEE (stronger):
"Use the planner for 2 weeks. If you're not planning your full week in
under 30 minutes, I'll personally review your setup and fix it — or refund you."
BOLD GUARANTEE (Hormozi style):
"I guarantee this works or I don't deserve your money. Period."
Rule: The stronger the guarantee, the higher the conversion AND the lower
the refund rate. Counterintuitive but proven.
### Urgency — Always Real and Structural
TIME-BASED: "Launch pricing ends [specific date/time]"
BONUS-BASED: "First 50 buyers get the video walkthrough — after that it's gone"
PRICE INCREASE: "Price goes from $27 to $47 on [date]"
COHORT-BASED: "Next group starts [date] — join before then or wait 30 days"
Never use fake urgency. Always structural — tied to a real constraint.
### Offer Naming Formula
"[Adjective] [Result] [Format] for [Avatar]"
WRONG: "The Ultimate Productivity Bundle"
RIGHT: "The Working Mom's 22-Minute Weekly Planner System"
RIGHT: "The 14-Day First Client Blueprint for Freelancers"
RIGHT: "The Sunday Reset Kit for Overwhelmed Professionals"
### CTA Formula
Every CTA must answer all 5:
What to do + How to do it + When + What they get + What happens next
Example: "Click the button below → enter your email → you'll get instant
access to all 5 resources in the next 60 seconds. Price goes up to $47
at midnight tonight."
