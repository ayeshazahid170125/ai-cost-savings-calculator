# AI Cost Savings Calculator

AI Cost Savings Calculator is a full-stack interactive web tool that helps companies estimate their current ChatGPT/Claude API spending and compare it with the projected cost of running a self-hosted fine-tuned open-source model.

Important clarification: this application estimates the financial impact of migrating from hosted LLM APIs to a self-hosted fine-tuned open-source model. It does not perform model training or fine-tuning itself.

The goal is to help a company answer one business question:

> Should we continue paying for hosted AI APIs, or can we save money by switching to a self-hosted model?

> **Scope note:** the cost model below covers infrastructure only (GPU, hosting, storage, monitoring, maintenance, fine-tuning). It does not include engineering/DevOps time, retraining cadence, or on-call/reliability overhead. Treat outputs as an infrastructure-cost comparison, not a full TCO. This is disclosed in the PDF report footer — see [PDF Report](#pdf-report).

## Changelog

### Round 1
- **ROI formula corrected.** The original `roi = monthly_savings / self_hosted_cost * 100` never referenced the investment (`setup_cost`), so it wasn't really ROI. It's now reported as two separate, clearly labeled metrics — see [Cost Formula](#cost-formula).
- **`break_even_months` no longer breaks when self-hosting costs more than the API.** Added an explicit non-positive-savings branch.
- **`gpu_cost` and `fine_tuning_cost` billing mode clarified.** Both were previously always treated as recurring monthly costs, which double-penalizes one-time GPU purchases and one-time fine-tuning runs. Added `gpu_billing_mode` and `fine_tuning_billing_mode` fields.
- **Recommendation tiers now driven by `monthly_tokens`** (throughput) as the primary signal, with `team_size` as a secondary tie-breaker, instead of an undocumented mix of the two.
- **Pricing accuracy flagged as a known risk** — see [Supported Providers](#supported-providers) and [Known Limitations](#known-limitations--assumptions).

### Round 2 — the tool was still overselling savings
Round 1 fixed *when* fine-tuning cost gets counted, but two bigger problems remained: infrastructure cost was still a flat, disconnected manual guess instead of something derived from actual usage, and nothing accounted for the fact that a self-hosted open-source model is typically less reliable than the frontier hosted model it's replacing — meaning more retries, more failed completions, more effective compute per successful response. Both inflate the true cost of self-hosting in ways the old formula ignored, which meant the tool's savings numbers were structurally optimistic, not just occasionally off.

- **Infrastructure costs are now auto-calculated from token volume** instead of being flat manual inputs disconnected from usage — see [Auto-Calculated Infrastructure Costs](#auto-calculated-infrastructure-costs).
- **Added a reliability/retry "fudge factor"** (`reliability_derating_factor`) that inflates effective self-hosted compute demand to account for expected quality degradation versus the hosted model being replaced — see [Reliability / Retry Fudge Factor](#reliability--retry-fudge-factor).
- Recomputing the original example with both fixes applied **flips the result from a $2,035/month "savings" to a ~$2,587/month loss** at the same usage volume — see [Why This Matters](#why-this-matters).

## Features

- Company usage input form
- ChatGPT/Claude provider selection
- Monthly API cost calculation
- Self-hosted infrastructure cost estimation, auto-calculated from token volume (with manual override)
- Self-hosted estimate panel always shows a plain-language, read-only "Recommended Infrastructure" summary by default (model, hardware, and full cost breakdown, all auto-generated — no GPU/pricing jargon, nothing to fill in); there is no auto-vs-manual choice for the user to make. A single collapsed "Advanced Settings" section (closed by default) exposes every underlying field — GPU/hosting/storage/monitoring/maintenance/fine-tuning/setup cost plus the technical assumptions (GPU utilization, reliability derating) — for the rare user who has a real vendor quote to enter
- Reliability/retry fudge factor to account for expected quality degradation vs. the hosted model
- Monthly and yearly savings calculation
- Break-even period calculation (with non-positive-savings handling)
- True annual ROI + monthly cost-efficiency ratio
- Open-source model and GPU recommendation (token-throughput driven)
- API vs self-hosted cost chart
- 12-month cost projection chart
- Backend-powered calculation using FastAPI
- Browser fallback calculation if backend is not running
- CSV usage upload for real billing/usage data
- Professional PDF report download (with TCO scope disclaimer)
- SaaS-style dashboard navigation

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite |
| Styling | CSS |
| Charts | Recharts |
| Icons | Lucide React |
| PDF Export | jsPDF |
| Backend | FastAPI |
| Validation | Pydantic |
| Server | Uvicorn |

## Project Structure

```text
ai-cost-savings-calculator/
  backend/
    app/
      main.py
    env/
    requirements.txt
  frontend/
    src/
      main.jsx
      styles.css
    index.html
    package.json
  README.md
```

## How It Works

The user enters:

- Company name
- Team size
- Current AI provider
- Monthly requests
- Average input tokens per request
- Average output tokens per request
- ~~Infra costing mode~~ — removed as a user-facing choice. The dashboard always shows the auto-calculated estimate by default; a collapsed "Advanced Settings" panel lets an expert user override individual cost fields (GPU, hosting, storage, monitoring, maintenance, fine-tuning, setup, target GPU utilization, reliability derating factor) without exposing any of them by default. Internally the app still sends `infra_costing_mode: "auto"` to the backend and relies on per-field overrides (`gpu_cost`, `hosting_cost`, etc.) for anything the user edits in Advanced Settings — see [Auto-Calculated Infrastructure Costs](#auto-calculated-infrastructure-costs).
- GPU billing mode (cloud rental vs. owned hardware)
- Fine-tuning cost estimate + fine-tuning billing mode (recurring vs. one-time)
- Reliability/retry fudge factor — expected quality-degradation overhead vs. the hosted model being replaced (default suggestion, user-adjustable)
- Target GPU utilization assumption (used only in auto-costing mode)
- One-time setup cost

The user can also upload a CSV file containing real usage data. The app reads the CSV and auto-fills:

- Monthly requests
- Average input tokens per request
- Average output tokens per request
- Provider, when it can be detected from the model/provider columns

The system calculates:

- Current hosted API cost
- Estimated self-hosted monthly cost
- Monthly savings
- Yearly savings
- True annual ROI
- Monthly cost-efficiency ratio
- Break-even time (or a "not cost-effective at this usage" flag)
- Recommended open-source model and GPU setup

## Cost Formula

### Monthly Tokens

```text
monthly_input_tokens = monthly_requests * average_input_tokens
monthly_output_tokens = monthly_requests * average_output_tokens
monthly_tokens = monthly_input_tokens + monthly_output_tokens
```

### API Cost

```text
api_cost =
  (monthly_input_tokens / 1,000,000 * input_token_price)
  +
  (monthly_output_tokens / 1,000,000 * output_token_price)
```

### Reliability / Retry Fudge Factor

A self-hosted open-source model is generally less capable than the frontier hosted model (GPT-4o, Claude Sonnet) it's replacing. In production this shows up as a real, billable cost the old formula ignored entirely: more retries on failed or malformed completions, more re-prompting to get an acceptable answer, sometimes multi-sample/self-consistency techniques to close the quality gap. All of that means **more tokens actually processed per successful business outcome**, even though `monthly_requests` stays the same.

`reliability_derating_factor` captures this as a multiplier on effective token volume before any cost is calculated:

```text
effective_self_hosted_tokens = monthly_tokens * reliability_derating_factor
```

- `reliability_derating_factor = 1.0` → assumes zero degradation (unrealistic for most swaps away from a frontier model; treat as a lower bound, not a default).
- A starting default of **1.15–1.30** is more defensible for a first pass, i.e. assume 15–30% more effective compute is needed to match the reliability of the hosted model — but this should be treated as a placeholder to calibrate, not a benchmarked constant. See [Known Limitations](#known-limitations--assumptions).
- This factor should ideally come from an actual eval (run the candidate open-source model against a sample of real production prompts and measure retry/failure rate) rather than a guess. Until that eval exists, the tool should visibly label this as an estimate everywhere it's surfaced, including in the PDF report.

### Auto-Calculated Infrastructure Costs

Previously `gpu_cost`, `hosting_cost`, `storage_cost`, `monitoring_cost`, and `maintenance_cost` were flat numbers the user typed in, with no connection to how much the company actually needs to run. Two companies with wildly different usage could enter the same guessed numbers and get equally wrong answers. Infra cost is now derived from `effective_self_hosted_tokens` and the hardware tier already picked by the recommendation engine, with manual entry available as an override (`infra_costing_mode: "manual"`) for teams with a real vendor quote.

```text
# From the recommendation tier (see Recommendation Logic table):
#   combined_throughput_tokens_per_sec — illustrative default per tier, user-editable
#   hourly_gpu_rate_combined           — illustrative default per tier, user-editable
#   target_gpu_utilization             — default 0.4 (accounts for request queuing,
#                                         concurrency limits, and non-peak hours;
#                                         GPUs are rarely at 100% sustained throughput)

effective_throughput_tokens_per_sec = combined_throughput_tokens_per_sec * target_gpu_utilization

required_gpu_hours_per_month = effective_self_hosted_tokens / (effective_throughput_tokens_per_sec * 3600)

gpu_cost_auto = required_gpu_hours_per_month * hourly_gpu_rate_combined   # if gpu_billing_mode == "cloud_rental"
                                                                            # if "owned_hardware": amortize into effective_setup_cost instead

# Supporting infra scaled off compute spend rather than guessed independently:
hosting_cost_auto     = gpu_cost_auto * 0.15
storage_cost_auto     = gpu_cost_auto * 0.05
monitoring_cost_auto  = gpu_cost_auto * 0.05
maintenance_cost_auto = gpu_cost_auto * 0.20
```

> ⚠️ `combined_throughput_tokens_per_sec`, `hourly_gpu_rate_combined`, and the 15/5/5/20% scaling ratios above are **illustrative placeholders**, not benchmarked figures. Before this feeds a client-facing report, calibrate throughput against real inference benchmarks for the recommended model/quantization and calibrate hourly rates against current cloud GPU pricing (e.g. RunPod, Lambda, AWS/GCP/Azure on-demand). Treat the scaling ratios as a rough starting shape for the hosting/storage/monitoring/maintenance split, to be replaced with real vendor quotes once available.

### Self-hosted Cost

`fine_tuning_cost` remains a manual estimate — unlike GPU/hosting cost, it can't be derived from inference token volume, since it depends on dataset size, epoch count, and provider fine-tuning pricing. Its billing mode (recurring vs. one-time) still routes it the same way as before.

```text
monthly_fine_tune_cost = fine_tuning_cost if fine_tuning_billing_mode == "monthly" else 0

effective_setup_cost =
  setup_cost
  + (gpu_cost_auto_or_manual if gpu_billing_mode == "owned_hardware" else 0)
  + (fine_tuning_cost        if fine_tuning_billing_mode == "one_time" else 0)

self_hosted_cost =
  (gpu_cost_auto if infra_costing_mode == "auto" else gpu_cost_manual, if cloud_rental)
  + (hosting_cost_auto if infra_costing_mode == "auto" else hosting_cost_manual)
  + (storage_cost_auto if infra_costing_mode == "auto" else storage_cost_manual)
  + (monitoring_cost_auto if infra_costing_mode == "auto" else monitoring_cost_manual)
  + (maintenance_cost_auto if infra_costing_mode == "auto" else maintenance_cost_manual)
  + monthly_fine_tune_cost
```

### Savings

```text
monthly_savings = api_cost - self_hosted_cost
yearly_savings  = monthly_savings * 12
```

### Break-even

```text
if monthly_savings > 0:
    break_even_months = effective_setup_cost / monthly_savings
else:
    break_even_months = null
    break_even_note   = "Self-hosting is not cost-effective at this usage level."
```

### ROI — two metrics, reported separately

The original single `roi` field conflated a monthly operating ratio with return on the actual capital outlay. These are now two distinct fields so a finance reviewer isn't misled by the label:

```text
# True ROI: return relative to what was actually invested (effective_setup_cost)
annual_roi_percent = (yearly_savings - effective_setup_cost) / effective_setup_cost * 100

# Monthly cost-efficiency ratio: how much you save per dollar of monthly
# self-hosted operating spend. Useful, but NOT return on investment.
monthly_cost_efficiency_ratio = monthly_savings / self_hosted_cost * 100
```

## Run the Project

### 1. Start Backend

```bash
cd A:\projects\ai-cost-savings-calculator\backend
env\Scripts\activate
uvicorn app.main:app --reload
```

Backend URL:

```text
http://127.0.0.1:8000
```

Health check:

```text
http://127.0.0.1:8000/health
```

### 2. Start Frontend

Open a second terminal:

```bash
cd A:\projects\ai-cost-savings-calculator\frontend
npm.cmd run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

## Build Frontend

```bash
cd A:\projects\ai-cost-savings-calculator\frontend
npm.cmd run build
```

## API Documentation

FastAPI automatically provides API docs:

```text
http://127.0.0.1:8000/docs
```

## API Endpoints

### GET `/health`

Checks whether the backend is running.

Example response:

```json
{
  "status": "ok"
}
```

### POST `/calculate`

Calculates API cost, self-hosted cost, savings, ROI, break-even, and model recommendation.

Example request (auto-costing mode):

```json
{
  "company_name": "Demo Co",
  "team_size": 40,
  "provider": "Claude Sonnet",
  "monthly_requests": 300000,
  "input_tokens": 800,
  "output_tokens": 450,
  "infra_costing_mode": "auto",
  "gpu_billing_mode": "cloud_rental",
  "target_gpu_utilization": 0.4,
  "reliability_derating_factor": 1.15,
  "fine_tuning_cost": 120,
  "fine_tuning_billing_mode": "monthly",
  "setup_cost": 1800
}
```

Example response:

```json
{
  "company_name": "Demo Co",
  "api_cost": 2745.0,
  "effective_self_hosted_tokens": 431250000,
  "gpu_cost_auto": 3594.25,
  "hosting_cost_auto": 539.14,
  "storage_cost_auto": 179.71,
  "monitoring_cost_auto": 179.71,
  "maintenance_cost_auto": 718.85,
  "self_hosted_cost": 5331.66,
  "effective_setup_cost": 1800.0,
  "monthly_savings": -2586.66,
  "yearly_savings": -31039.92,
  "break_even_months": null,
  "break_even_note": "Self-hosting is not cost-effective at this usage level.",
  "annual_roi_percent": -1824.44,
  "monthly_cost_efficiency_ratio": -48.52,
  "monthly_input_tokens": 240000000,
  "monthly_output_tokens": 135000000,
  "monthly_tokens": 375000000,
  "recommendation": {
    "model": "Mixtral 8x7B / Llama 3.1 70B quantized",
    "hardware": "2x L40S or 1x A100 80GB",
    "latency": "2.5-4.0 sec",
    "note": "Suitable when quality matters and usage is high.",
    "tier_driver": "monthly_tokens"
  }
}
```

**Field notes:**
- `annual_roi_percent` is the number to use in any client-facing "ROI" claim — it's tied to `effective_setup_cost`, the actual capital outlay. It's still computed (and shown negative) when savings are negative, since "you'd lose X% of your investment" is meaningful.
- `monthly_cost_efficiency_ratio` is the old `roi` field, renamed for accuracy. Keep it if it's useful internally, but don't present it to a client as "ROI."
- If `monthly_savings <= 0`, `break_even_months` is `null` and `break_even_note` explains why — there's no sensible number of months when self-hosting never actually recoups the investment.

### Why This Matters

Same underlying usage (300K requests/month, 800 in / 450 out tokens), two versions of the formula:

| | Round 1 (flat manual infra guesses) | Round 2 (auto-calculated + reliability derating) |
| --- | --- | --- |
| `self_hosted_cost` | $710/mo | ~$5,332/mo |
| `monthly_savings` | **+$2,035/mo** | **–$2,587/mo** |
| `break_even_months` | 0.88 | null — not cost-effective |
| Story it tells a client | "Switch now, break even in under a month" | "Not worth switching at this volume without cheaper infra or a smaller reliability gap" |

Nothing about the company's actual usage changed between these two rows — only the honesty of the cost model did. The Round 1 version wasn't wrong on principle, just structurally biased toward making self-hosting look better than it likely is, because the manual infra inputs ($260 GPU, $90 hosting, etc.) were arbitrary and didn't scale with 375M tokens/month of real throughput. This is the scenario worth testing against a few real client profiles before this tool goes in front of anyone — low-volume teams may still come out ahead even after these corrections; it's the mid-to-high-volume cases where the old formula was most likely to oversell.

## Supported Providers

- OpenAI GPT-4o
- OpenAI GPT-4o mini
- Claude Sonnet
- Claude Haiku

> **Pricing is hardcoded server-side per provider and is not part of the request body.** Hosted LLM pricing changes frequently. Verify current rates against each provider's pricing page before using output in a client-facing report — see [Known Limitations](#known-limitations--assumptions). The planned Admin Pricing Panel (see [Current Status](#current-status)) is intended to remove this manual step.

## Recommendation Logic

Tiering is driven primarily by **monthly token throughput** (`monthly_tokens`), not team size. Team size is only used as a secondary tie-breaker when a company sits near a tier boundary.

| Tier | Monthly Tokens | Recommended Model | Suggested Hardware | Illustrative Combined Throughput | Illustrative Hourly Rate |
| --- | --- | --- | --- | --- | --- |
| Small | < 50M | Gemma 2 9B | 1x RTX 4090 | 150 tok/s | $0.80/hr |
| Medium | 50M – 150M | Llama 3.1 8B / Mistral 7B | 1x RTX 4090 or L40S | 250 tok/s | $1.60/hr |
| Large | 150M – 400M | Mixtral 8x7B / Llama 3.1 70B quantized | 2x L40S or 1x A100 80GB | 500 tok/s | $6.00/hr |
| Enterprise | > 400M | Llama 3.1 70B / DeepSeek class model | 2-4x A100/H100 | 900 tok/s | $12.00/hr |

*(In the example above, `monthly_tokens = 375,000,000` falls in the Large tier — consistent with the sample response, regardless of the 40-person team size.)*

The throughput and hourly-rate columns feed directly into [Auto-Calculated Infrastructure Costs](#auto-calculated-infrastructure-costs) — they are illustrative starting points, not benchmarked numbers. Replace them with real inference-throughput benchmarks and current cloud GPU pricing before relying on the output for a client-facing figure.

## PDF Report

The frontend includes a `Download PDF Report` button. The report contains:

- Executive summary
- Usage information
- Current API cost
- Self-hosted cost
- Monthly and yearly savings
- Annual ROI and monthly cost-efficiency ratio (labeled separately)
- Break-even period (or not-cost-effective note)
- Recommended model and hardware
- **Scope disclaimer:** "Estimate reflects infrastructure costs only; excludes engineering and operational overhead."

## CSV Upload

The dashboard supports CSV upload for real usage data from OpenAI, Claude, or internal logs.

Supported column names include:

- `requests`
- `request_count`
- `num_requests`
- `count`
- `input_tokens`
- `prompt_tokens`
- `output_tokens`
- `completion_tokens`
- `total_tokens`
- `model`
- `provider`

Example CSV:

```csv
date,provider,model,requests,input_tokens,output_tokens
2026-07-01,Anthropic,claude-sonnet,12000,9600000,5400000
2026-07-02,Anthropic,claude-sonnet,11500,9200000,5175000
```

A sample file is available at:

```text
sample-usage.csv
```

## Known Limitations & Assumptions

> ⚠️ **This calculator produces planning-grade estimates, not exact vendor quotations.** Every dollar figure it shows — API cost, self-hosted infra cost, ROI, break-even — is derived from illustrative pricing constants and usage assumptions listed below. Before using output in a client-facing proposal or procurement decision, validate the assumptions that matter most against real vendor quotes.

- **Infrastructure-only cost model.** Excludes engineering/DevOps time, model retraining cadence as base models improve, and reliability/on-call cost. Disclosed in the PDF; not yet reflected as a line item in the cost formula.
- **Pricing is manually maintained.** `input_token_price` / `output_token_price` are hardcoded per provider server-side. No automatic sync with provider pricing pages — stale pricing produces confidently wrong numbers. Mitigation: planned Admin Pricing Panel (see roadmap).
- **GPU/fine-tuning billing mode must be set correctly by the user.** If `gpu_billing_mode` or `fine_tuning_billing_mode` is left at a default that doesn't match reality (e.g., owned hardware marked as cloud rental), break-even and ROI will be skewed. Mitigated: the form defaults to the more conservative modes (`cloud_rental`, `monthly`) and the frontend now shows an explicit "confirm your billing modes" prompt in the Self-hosted Estimate panel until the user acknowledges it — see the `billingConfirmed` state and banner in `main.jsx`.
- **Recommendation tiers use fixed token thresholds.** These are reasonable starting points but haven't been validated against real deployment benchmarks; treat as directional, not authoritative sizing guidance.
- **Auto-calculated infra costs rely on illustrative throughput/pricing constants** (see the Recommendation Logic table). These need calibration against real inference benchmarks and current cloud GPU pricing before the output is used in a client-facing report — otherwise this just replaces one set of guesses with a more sophisticated-looking set of guesses.
- **`reliability_derating_factor` is a placeholder estimate, not a measured value.** The suggested 1.15–1.30 default is a reasonable starting assumption, not a benchmark. Ideally it's set per-project from an actual eval of the candidate open-source model against real production prompts. It is surfaced by default (not hidden) in the "Why this recommendation" explanation box in the Self-hosted Estimate panel, clearly labeled as an assumption, with the editable field one click away under "Show advanced assumptions."
- **`fine_tuning_cost` is still a flat manual estimate.** Its billing-mode timing was fixed, but unlike GPU/hosting cost, its magnitude isn't derived from anything — it depends on dataset size, epoch count, and provider fine-tuning pricing, which are outside what this tool currently models.
- **No authentication or saved reports yet**, so figures aren't currently auditable across sessions — relevant if this tool is used in a formal sales or procurement process.

## Current Status

Completed:

- Frontend dashboard
- Backend API
- Backend/frontend integration
- Cost calculator (Round 1: corrected ROI/break-even logic)
- Cost calculator (Round 2: auto-calculated infrastructure costs + reliability/retry fudge factor) — implemented in both `backend/app/main.py` and the frontend calculation fallback (`frontend/src/main.jsx`)
- Auto-calculated infrastructure costs derived from `effective_self_hosted_tokens`
- Reliability/retry fudge factor (`reliability_derating_factor`)
- Billing-mode confirmation prompt for `gpu_billing_mode` / `fine_tuning_billing_mode` (see [Known Limitations](#known-limitations--assumptions))
- Recommendation engine (token-throughput driven)
- Charts
- PDF report download (with scope disclaimer)
- CSV usage upload
- SaaS-style sidebar navigation

Not yet implemented (deferred, needs real vendor/benchmark data before it can be done properly):

- Calibration of illustrative throughput/hourly-rate constants against real inference benchmarks and current cloud GPU pricing

Next planned features:

- Pricing database + Admin pricing panel (mitigates stale-pricing risk)
- ML-based usage forecasting
- Authentication
- Saved company reports
- Deployment

## Presentation Summary

This project helps companies compare hosted AI API costs with a self-hosted fine-tuned model setup. A company enters team size and monthly AI usage, and the system calculates projected savings, a true annual ROI tied to actual setup investment, break-even period, and recommended model infrastructure sized to actual token throughput — with infrastructure cost derived from that same throughput rather than guessed, and a reliability fudge factor applied so the projection doesn't quietly assume the self-hosted model performs as well as the one it's replacing.