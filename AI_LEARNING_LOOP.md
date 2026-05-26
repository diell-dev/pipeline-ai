# How the AI Gets Smarter Over Time

**Audience:** Diell (non-technical reader)
**Drafted:** 2026-05-25
**Status:** Process explanation. Implementation comes later.

This explains how Pipeline AI's data-plate extraction system can learn from every photo a tech takes and every correction they make — without us having to "train" anything manually.

---

## The Big Picture

Every time a tech scans a plate, three things happen:

1. **Photo** arrives — the image file
2. **AI extracts fields** — make, model, serial, dates, voltage, refrigerant, etc.
3. **Tech reviews and confirms** in the confirmation UI — they accept the green fields, fix the yellow ones, and type in the red ones from scratch

The result of step 3 is the **truth** — what the plate actually says, verified by a human. If we save every one of these as `{photo, ai_guess, human_truth}`, we've built a growing dataset of "ground truth" examples. Each one is potentially worth gold.

What we DO with that data is what makes the AI smarter. There are three escalating ways, ordered cheapest-to-most-expensive.

---

## Level 1 — Smart Few-Shot Retrieval (the cheap win)

**The idea:** When the AI is shown a new photo, we don't just ask it to extract fields blind. We say: "Here are 5 examples of similar plates we've successfully extracted before. Now do this one." Examples massively improve accuracy.

But which 5 examples? We don't show the same generic 5 every time. We find the 5 most *relevant* ones — same brand, same equipment type, similar layout.

**How it works:**

1. Tech scans a Daikin mini-split plate
2. Before sending to AI, our system queries our own database: "Find the 5 most recently confirmed Daikin mini-split extractions"
3. We include those 5 examples in the prompt: "Look at these 5 plates and how we extracted them. Now extract this new one."
4. The AI is now grounded in real examples from this exact brand + type

**Why it's powerful:**

- The first 100 scans, results are about the same as today (no examples to retrieve from)
- After 500 scans, Daikin/Carrier/Trane plates get noticeably better
- After 5,000 scans across brands, the system effectively has "seen everything" — Daikin plates from 2015 with glare look like Daikin plates from 2024 with glare
- **The AI gets better just by being used**, with zero retraining

**Cost:** Almost free. Adds maybe 5-10 milliseconds per scan for the database lookup. Uses slightly more tokens per AI call (we're sending 5 example images), but Claude pricing on cached prompts is cheap.

---

## Level 2 — Equipment Catalog That Builds Itself

**The idea:** Once 10 different techs have confirmed that "Daikin FTXS18LVJU" is a 208/230V mini-split with R-410A refrigerant and a 31 lb weight, we don't need to ask the AI to extract those fields anymore. We just know.

**How it works:**

1. Every confirmed (make + model) combo gets added to our internal equipment catalog
2. Each subsequent scan of the same model: AI extracts what it can, then our system fills in the rest from the catalog
3. If the new scan disagrees with the catalog ("this Daikin says 460V, not 208/230V"), we surface that as a warning — the catalog might be wrong, OR this is a different variant

**Why it's powerful:**

- Reduces the AI's job to "just confirm what brand/model this is" — much easier than extracting 15 fields
- Catches mistakes (a tech enters the wrong model number, the system notices the auto-filled voltage doesn't match the photo, flags it)
- Becomes a competitive moat — your catalog is unique to your installed base in NYC
- Powers other features: "We've seen this model 47 times — average lifespan is 12 years — yours is 9 years old, replace in 3"

**Cost:** Tiny. One Postgres table. The lookup is a single SQL query per scan.

---

## Level 3 — Actual Model Fine-Tuning (the long-term play)

**The idea:** Once we have thousands of (photo, human-confirmed-extraction) pairs, we can use Anthropic's fine-tuning service to create a custom version of Claude that's specifically good at HVAC data plates. It would beat the general Claude at this task.

**How it works:**

1. We export, say, 5,000 confirmed extractions as training data
2. Send to Anthropic's fine-tuning service (or use an open model like Llama and train ourselves)
3. We get back a custom model — "Pipeline AI HVAC Extractor v1"
4. Our extraction code switches to calling that model
5. Every 6 months, retrain with the new data

**Why it's the long game:**

- A model fine-tuned on your data will outperform anyone else's general AI on this task
- Real competitive moat — Bluon and ServiceTitan can copy our prompts but they can't copy our model
- Marketing story: "Trained on real US HVAC plates, not generic OCR"

**Cost & timing:**

- Don't do this until we have at least 1,000-2,000 confirmed scans
- Anthropic fine-tuning runs into the thousands of dollars per training cycle
- Custom model inference costs slightly more per call
- Worth it only when prompting hits its ceiling AND we have enough customers to justify the cost

This is a **future** consideration. We don't build it in v1. But Levels 1 and 2 set up the data capture, so when the time comes, the dataset is already there.

---

## The Quality Flywheel

There's a fourth thing that happens alongside the three levels — a feedback loop on our PROMPT itself.

**How it works:**

1. Every confirmed scan logs: `{ field_name, ai_value, ai_confidence, human_value, was_corrected }`
2. Weekly (or monthly), we run a query: "Which fields were wrong most often? Which brands? Which equipment types?"
3. Example output: "Manufacture date was wrong 40% of the time for Daikin mini-splits. AI thinks `2021.5` means December 2009."
4. We update the prompt to handle that specific case (we already know from research that `2021.5` is the Daikin `YYYY.M` decimal format)
5. Re-deploy. Accuracy goes up.

This is **us learning** — humans reading the failure patterns and tightening the prompt. The data the system collects gives us exactly the signal we need.

After 3-6 months of this loop, we'll have a prompt that handles 90%+ of real US HVAC plates correctly without ever fine-tuning a model.

---

## What We Need to Build (to enable any of this)

The actual learning happens later. But the **data capture** has to exist from day one, otherwise we have nothing to learn from. Specifically:

1. **`equipment_scans` table extension** — every scan saves:
   - The photo (Supabase Storage)
   - The raw AI extraction (JSON)
   - The human-confirmed extraction (JSON)
   - Per-field: was it corrected? what was the AI's confidence?
   - Timestamp + tech who confirmed

2. **Equipment catalog table** — `make + model` → known field values. Populated automatically as techs confirm.

3. **Audit query** — a simple admin view showing "extraction accuracy by brand/field over time."

These three pieces give us the foundation for Levels 1, 2, and the quality flywheel. Level 3 (fine-tuning) doesn't need any extra plumbing — it just uses the same data we're already collecting.

**Bonus:** if the photos and confirmed-extractions are well-organized, this is also valuable training data we could sell or open-source someday. Anonymized US HVAC plates with verified field extractions don't exist publicly — there's a real asset being created.

---

## What This Means for Bogdan Right Now

Even before any of this learning machinery is built, Bogdan benefits:

- Today: AI extracts, tech corrects, save. (We're here.)
- Week 1: Confirmation UI lands. Tech reviews + corrects. Data starts being captured.
- Month 1: We have a few hundred scans. Level 1 (smart few-shot retrieval) can be turned on.
- Month 3: Catalog (Level 2) starts auto-filling fields for repeat models. Tech sees "auto-filled from 12 prior scans" badges.
- Month 6+: Quality-flywheel improvements ship monthly. Bogdan's accuracy gradually approaches 95%+ on the brands he sees most.
- Year 1+: Consider fine-tuning if we have the data + customer demand to justify it.

The system gets smarter as Bogdan uses it — without us asking him to label anything extra. The "labeling" is what he's already doing when he confirms a scan.

---

## TL;DR

> Every confirmed scan is training data. We save it from day one. Then we use it three ways: smart example retrieval (cheap, immediate), an auto-building equipment catalog (cheap, compounds over time), and eventually a fine-tuned model (expensive, biggest moat, only when justified). Plus a monthly review loop where we read failure patterns and tighten the prompt. The system improves passively as the app is used.
