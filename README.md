# AI Cost Savings Calculator

AI Cost Savings Calculator is a full-stack interactive web tool that helps companies estimate their current ChatGPT/Claude API spending and compare it with the projected cost of running a self-hosted fine-tuned open-source model.

Important clarification: this application estimates the financial impact of migrating from hosted LLM APIs to a self-hosted fine-tuned open-source model. It does not perform model training or fine-tuning itself.

The goal is to help a company answer one business question:

> Should we continue paying for hosted AI APIs, or can we save money by switching to a self-hosted model?

## Features

- Company usage input form
- ChatGPT/Claude provider selection
- Monthly API cost calculation
- Self-hosted infrastructure cost estimation
- Monthly and yearly savings calculation
- Break-even period calculation
- ROI estimate
- Open-source model and GPU recommendation
- API vs self-hosted cost chart
- 12-month cost projection chart
- Backend-powered calculation using FastAPI
- Browser fallback calculation if backend is not running
- CSV usage upload for real billing/usage data
- Professional PDF report download
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
- Self-hosted infrastructure costs
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
- ROI
- Break-even time
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

### Self-hosted Cost

```text
self_hosted_cost =
  gpu_cost
  + hosting_cost
  + storage_cost
  + monitoring_cost
  + maintenance_cost
  + fine_tuning_cost
```

Each of these cost fields has a realistic default based on a **hardware tier**
(small, medium, large, enterprise), automatically selected from team size and
monthly token volume. Defaults auto-update in the form as usage changes, but
any field can be manually overridden with the company's own numbers.

| Tier | Team Size / Usage | Hardware | GPU | Hosting | Storage | Monitoring | Maintenance | Fine-tuning | Setup Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Small | ≤20 users, <25M tokens/mo | 1x RTX 4090 | $450 | $60 | $25 | $20 | $150 | $150 | $2,500 |
| Medium | ≤80 users, <120M tokens/mo | 1x RTX 4090 or L40S | $750 | $100 | $40 | $30 | $220 | $200 | $3,500 |
| Large | ≤300 users | 2x L40S or 1x A100 80GB | $1,450 | $180 | $70 | $45 | $320 | $300 | $5,500 |
| Enterprise | >300 users | 2-4x A100/H100 | $3,200 | $350 | $120 | $80 | $600 | $500 | $9,000 |

These figures are based on typical cloud GPU rental rates (e.g. RunPod,
Lambda Labs, AWS) for 24/7 uptime, and are meant as planning estimates, not
guaranteed pricing.

### Savings

```text
monthly_savings = api_cost - self_hosted_cost
yearly_savings = monthly_savings * 12
break_even_months = setup_cost / monthly_savings
roi = monthly_savings / self_hosted_cost * 100
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

## Environment Variables

### Frontend

| Variable | Purpose | Default (local dev) |
| --- | --- | --- |
| `VITE_API_URL` | Base URL of the backend API | `http://127.0.0.1:8000` |

When deploying, set `VITE_API_URL` to the live backend URL (e.g.
`https://ai-cost-calculator-backend.onrender.com`) in the hosting
platform's environment variable settings, not committed to the repo.

## Deployment (in progress)

Planned setup:

- **Backend** — deployed on Render/Railway, with `allow_origins` in
  `main.py`'s CORS middleware updated to the live frontend domain.
- **Frontend** — deployed on Vercel, with `VITE_API_URL` pointed at the
  live backend URL.
- The tool will be hosted at a subdomain of the company website (e.g.
  `calculator.<company-domain>`).

This section will be updated with the live URL once deployment is complete.

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

Example request:

```json
{
  "company_name": "Demo Co",
  "team_size": 40,
  "provider": "Claude Sonnet",
  "monthly_requests": 300000,
  "input_tokens": 800,
  "output_tokens": 450
}
```

Cost fields (`gpu_cost`, `hosting_cost`, `storage_cost`, `monitoring_cost`,
`maintenance_cost`, `fine_tuning_cost`, `setup_cost`) are optional. If
omitted, the API fills them in automatically based on the recommended
hardware tier for the given team size and usage. They can still be passed
explicitly to override the defaults with a company's real infrastructure
costs.

Example response:

```json
{
  "company_name": "Demo Co",
  "api_cost": 2745.0,
  "self_hosted_cost": 2365.0,
  "monthly_savings": 380.0,
  "yearly_savings": 4560.0,
  "break_even_months": 14.47,
  "roi": 16.07,
  "monthly_input_tokens": 240000000,
  "monthly_output_tokens": 135000000,
  "monthly_tokens": 375000000,
  "cost_breakdown": {
    "gpu_cost": 1450,
    "hosting_cost": 180,
    "storage_cost": 70,
    "monitoring_cost": 45,
    "maintenance_cost": 320,
    "fine_tuning_cost": 300,
    "setup_cost": 5500
  },
  "recommendation": {
    "model": "Mixtral 8x7B / Llama 3.1 70B quantized",
    "hardware": "2x L40S or 1x A100 80GB",
    "latency": "2.5-4.0 sec",
    "note": "Suitable when quality matters and usage is high."
  }
}
```

## Supported Providers

- OpenAI GPT-4o
- OpenAI GPT-4o mini
- Claude Sonnet
- Claude Haiku

## Recommendation Logic

| Company Size / Usage | Recommended Model | Suggested Hardware |
| --- | --- | --- |
| Small teams | Gemma 2 9B | 1x RTX 4090 |
| Medium teams | Llama 3.1 8B / Mistral 7B | 1x RTX 4090 or L40S |
| Large teams | Mixtral 8x7B / Llama 3.1 70B quantized | 2x L40S or 1x A100 80GB |
| Enterprise | Llama 3.1 70B / DeepSeek class model | 2-4x A100/H100 |

## PDF Report

The frontend includes a `Download PDF Report` button. The report contains:

- Executive summary
- Usage information
- Current API cost
- Self-hosted cost
- Monthly and yearly savings
- ROI
- Break-even period
- Recommended model and hardware

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

## Current Status

Completed:

- Frontend dashboard
- Backend API
- Backend/frontend integration
- Cost calculator
- Recommendation engine
- Charts
- PDF report download
- CSV usage upload
- SaaS-style sidebar navigation
- Hardware-tier-based realistic cost defaults (frontend + backend, kept in sync)
- Executive summary disclaimer note
- CORS configuration placeholder for live domain

In progress:

- Deployment to a live URL (backend on Render/Railway, frontend on Vercel)

Next planned features:

- Pricing database with live-updated provider rates
- Admin pricing panel
- ML-based usage forecasting
- Authentication
- Saved company reports

## Presentation Summary

This project helps companies compare hosted AI API costs with a self-hosted fine-tuned model setup. A company enters team size and monthly AI usage, and the system calculates projected savings, ROI, break-even period, and recommended model infrastructure.