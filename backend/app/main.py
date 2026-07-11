from math import inf
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(title="AI Cost Savings Calculator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        # TODO: add your live website domain here before going live, e.g.
        # "https://yourwebsite.com",
        # "https://calculator.yourwebsite.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


PROVIDERS = {
    "OpenAI GPT-4o": {"input": 5, "output": 15},
    "OpenAI GPT-4o mini": {"input": 0.15, "output": 0.6},
    "Claude Sonnet": {"input": 3, "output": 15},
    "Claude Haiku": {"input": 0.25, "output": 1.25},
}

# Round 2: tiers are now driven primarily by monthly_tokens (throughput),
# with team_size only used as a tie-breaker near a boundary. Each tier also
# now carries illustrative throughput/hourly-rate figures used to
# auto-calculate infra cost from actual usage instead of flat guesses.
HARDWARE_TIERS = {
    "small": {
        "hardware": "1x RTX 4090",
        "token_ceiling": 50_000_000,
        "combined_throughput_tokens_per_sec": 150,
        "hourly_gpu_rate_combined": 0.80,
        "fine_tuning_cost": 150,
        "setup_cost": 2500,
    },
    "medium": {
        "hardware": "1x RTX 4090 or L40S",
        "token_ceiling": 150_000_000,
        "combined_throughput_tokens_per_sec": 250,
        "hourly_gpu_rate_combined": 1.60,
        "fine_tuning_cost": 200,
        "setup_cost": 3500,
    },
    "large": {
        "hardware": "2x L40S or 1x A100 80GB",
        "token_ceiling": 400_000_000,
        "combined_throughput_tokens_per_sec": 500,
        "hourly_gpu_rate_combined": 6.00,
        "fine_tuning_cost": 300,
        "setup_cost": 5500,
    },
    "enterprise": {
        "hardware": "2-4x A100/H100",
        "token_ceiling": None,
        "combined_throughput_tokens_per_sec": 900,
        "hourly_gpu_rate_combined": 12.00,
        "fine_tuning_cost": 500,
        "setup_cost": 9000,
    },
}

# Supporting infra scaled off gpu_cost_auto rather than guessed independently.
INFRA_RATIOS = {
    "hosting_cost": 0.15,
    "storage_cost": 0.05,
    "monitoring_cost": 0.05,
    "maintenance_cost": 0.20,
}


class CalculationRequest(BaseModel):
    company_name: str = "Acme Support"
    team_size: int = Field(default=25, ge=1)
    provider: str = "Claude Sonnet"
    monthly_requests: int = Field(default=300000, ge=0)
    input_tokens: int = Field(default=800, ge=0)
    output_tokens: int = Field(default=450, ge=0)

    # Round 2 controls
    infra_costing_mode: Literal["auto", "manual"] = "auto"
    gpu_billing_mode: Literal["cloud_rental", "owned_hardware"] = "cloud_rental"
    fine_tuning_billing_mode: Literal["monthly", "one_time"] = "monthly"
    target_gpu_utilization: float = Field(default=0.4, gt=0, le=1)
    # 1.0 = no degradation assumed (lower bound, not realistic for most
    # swaps away from a frontier model). 1.15-1.30 is a more defensible
    # starting default; should ideally come from a real eval.
    reliability_derating_factor: float = Field(default=1.20, ge=1.0)

    # Manual overrides. Only used when infra_costing_mode == "manual"
    # (gpu/hosting/storage/monitoring/maintenance) or always for
    # fine_tuning_cost, which is never auto-derived.
    gpu_cost: float | None = Field(default=None, ge=0)
    hosting_cost: float | None = Field(default=None, ge=0)
    storage_cost: float | None = Field(default=None, ge=0)
    monitoring_cost: float | None = Field(default=None, ge=0)
    maintenance_cost: float | None = Field(default=None, ge=0)
    fine_tuning_cost: float | None = Field(default=None, ge=0)
    setup_cost: float | None = Field(default=None, ge=0)


def get_hardware_tier(team_size: int, monthly_tokens: int) -> str:
    """Round 2: primary signal is monthly_tokens; team_size only breaks
    ties when usage sits right at a tier boundary."""
    if monthly_tokens < 50_000_000:
        tier = "small"
    elif monthly_tokens < 150_000_000:
        tier = "medium"
    elif monthly_tokens < 400_000_000:
        tier = "large"
    else:
        tier = "enterprise"

    # Tie-breaker: a very large team on borderline usage gets bumped up one
    # tier so headcount-driven concurrency isn't ignored entirely.
    order = ["small", "medium", "large", "enterprise"]
    idx = order.index(tier)
    if team_size > 300 and idx < 3:
        idx += 1
    elif team_size > 80 and idx == 0:
        idx += 1
    return order[idx]


def recommend_model(tier: str) -> dict:
    models = {
        "small": {
            "model": "Gemma 2 9B",
            "latency": "1.0-1.8 sec",
            "note": "Best for small teams, internal assistants, and FAQ style workloads.",
        },
        "medium": {
            "model": "Llama 3.1 8B / Mistral 7B",
            "latency": "1.5-2.5 sec",
            "note": "Balanced option for support, sales, and knowledge-base workflows.",
        },
        "large": {
            "model": "Mixtral 8x7B / Llama 3.1 70B quantized",
            "latency": "2.5-4.0 sec",
            "note": "Suitable when quality matters and usage is high.",
        },
        "enterprise": {
            "model": "Llama 3.1 70B / DeepSeek class model",
            "latency": "Enterprise dependent",
            "note": "Needs capacity planning, observability, and dedicated DevOps ownership.",
        },
    }
    info = models[tier]
    hw = HARDWARE_TIERS[tier]
    return {
        "model": info["model"],
        "hardware": hw["hardware"],
        "latency": info["latency"],
        "note": info["note"],
        "tier_driver": "monthly_tokens",
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/calculate")
def calculate(payload: CalculationRequest) -> dict:
    pricing = PROVIDERS.get(payload.provider, PROVIDERS["Claude Sonnet"])
    monthly_input_tokens = payload.monthly_requests * payload.input_tokens
    monthly_output_tokens = payload.monthly_requests * payload.output_tokens
    monthly_tokens = monthly_input_tokens + monthly_output_tokens

    api_cost = (
        (monthly_input_tokens / 1_000_000) * pricing["input"]
        + (monthly_output_tokens / 1_000_000) * pricing["output"]
    )

    tier = get_hardware_tier(payload.team_size, monthly_tokens)
    defaults = HARDWARE_TIERS[tier]

    # --- Reliability / retry fudge factor ---
    # A self-hosted open-source model is generally less reliable than the
    # frontier hosted model it replaces, so more effective compute is
    # needed per successful response.
    effective_self_hosted_tokens = monthly_tokens * payload.reliability_derating_factor

    # --- Auto-calculated infra costs, derived from actual throughput ---
    effective_throughput_tokens_per_sec = (
        defaults["combined_throughput_tokens_per_sec"] * payload.target_gpu_utilization
    )
    required_gpu_hours_per_month = effective_self_hosted_tokens / (
        effective_throughput_tokens_per_sec * 3600
    )
    gpu_cost_auto = required_gpu_hours_per_month * defaults["hourly_gpu_rate_combined"]

    hosting_cost_auto = gpu_cost_auto * INFRA_RATIOS["hosting_cost"]
    storage_cost_auto = gpu_cost_auto * INFRA_RATIOS["storage_cost"]
    monitoring_cost_auto = gpu_cost_auto * INFRA_RATIOS["monitoring_cost"]
    maintenance_cost_auto = gpu_cost_auto * INFRA_RATIOS["maintenance_cost"]

    use_auto = payload.infra_costing_mode == "auto"

    gpu_cost = payload.gpu_cost if payload.gpu_cost is not None else (
        gpu_cost_auto if use_auto else 0
    )
    hosting_cost = payload.hosting_cost if payload.hosting_cost is not None else (
        hosting_cost_auto if use_auto else 0
    )
    storage_cost = payload.storage_cost if payload.storage_cost is not None else (
        storage_cost_auto if use_auto else 0
    )
    monitoring_cost = payload.monitoring_cost if payload.monitoring_cost is not None else (
        monitoring_cost_auto if use_auto else 0
    )
    maintenance_cost = payload.maintenance_cost if payload.maintenance_cost is not None else (
        maintenance_cost_auto if use_auto else 0
    )
    fine_tuning_cost = (
        payload.fine_tuning_cost if payload.fine_tuning_cost is not None else defaults["fine_tuning_cost"]
    )
    setup_cost = payload.setup_cost if payload.setup_cost is not None else defaults["setup_cost"]

    # --- Billing mode routing ---
    # If GPU is owned (not rented), its cost is capital, not a recurring
    # monthly line item -> folds into effective_setup_cost instead.
    monthly_gpu_line = gpu_cost if payload.gpu_billing_mode == "cloud_rental" else 0
    monthly_fine_tune_cost = (
        fine_tuning_cost if payload.fine_tuning_billing_mode == "monthly" else 0
    )

    effective_setup_cost = (
        setup_cost
        + (gpu_cost if payload.gpu_billing_mode == "owned_hardware" else 0)
        + (fine_tuning_cost if payload.fine_tuning_billing_mode == "one_time" else 0)
    )

    self_hosted_cost = (
        monthly_gpu_line
        + hosting_cost
        + storage_cost
        + monitoring_cost
        + maintenance_cost
        + monthly_fine_tune_cost
    )

    monthly_savings = api_cost - self_hosted_cost
    yearly_savings = monthly_savings * 12

    if monthly_savings > 0:
        break_even_months = round(effective_setup_cost / monthly_savings, 2)
        break_even_note = None
    else:
        break_even_months = None
        break_even_note = "Self-hosting is not cost-effective at this usage level."

    annual_roi_percent = (
        round((yearly_savings - effective_setup_cost) / effective_setup_cost * 100, 2)
        if effective_setup_cost > 0
        else 0
    )
    monthly_cost_efficiency_ratio = (
        round((monthly_savings / self_hosted_cost) * 100, 2) if self_hosted_cost > 0 else 0
    )

    return {
        "company_name": payload.company_name,
        "api_cost": round(api_cost, 2),
        "effective_self_hosted_tokens": round(effective_self_hosted_tokens),
        "self_hosted_cost": round(self_hosted_cost, 2),
        "effective_setup_cost": round(effective_setup_cost, 2),
        "monthly_savings": round(monthly_savings, 2),
        "yearly_savings": round(yearly_savings, 2),
        "break_even_months": break_even_months,
        "break_even_note": break_even_note,
        "annual_roi_percent": annual_roi_percent,
        "monthly_cost_efficiency_ratio": monthly_cost_efficiency_ratio,
        "monthly_input_tokens": monthly_input_tokens,
        "monthly_output_tokens": monthly_output_tokens,
        "monthly_tokens": monthly_tokens,
        "cost_breakdown": {
            "gpu_cost_auto": round(gpu_cost_auto, 2),
            "hosting_cost_auto": round(hosting_cost_auto, 2),
            "storage_cost_auto": round(storage_cost_auto, 2),
            "monitoring_cost_auto": round(monitoring_cost_auto, 2),
            "maintenance_cost_auto": round(maintenance_cost_auto, 2),
            "gpu_cost": round(gpu_cost, 2),
            "hosting_cost": round(hosting_cost, 2),
            "storage_cost": round(storage_cost, 2),
            "monitoring_cost": round(monitoring_cost, 2),
            "maintenance_cost": round(maintenance_cost, 2),
            "fine_tuning_cost": round(fine_tuning_cost, 2),
            "setup_cost": round(setup_cost, 2),
        },
        "recommendation": recommend_model(tier),
    }