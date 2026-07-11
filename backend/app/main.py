from math import inf

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

# Realistic monthly self-hosted infrastructure costs by hardware tier.
# Based on typical cloud GPU rental rates (e.g. RunPod, Lambda Labs, AWS)
# for 24/7 uptime, plus hosting/storage/monitoring/maintenance overhead.
HARDWARE_TIERS = {
    "small": {
        "hardware": "1x RTX 4090",
        "gpu_cost": 450,
        "hosting_cost": 60,
        "storage_cost": 25,
        "monitoring_cost": 20,
        "maintenance_cost": 150,
        "fine_tuning_cost": 150,
        "setup_cost": 2500,
    },
    "medium": {
        "hardware": "1x RTX 4090 or L40S",
        "gpu_cost": 750,
        "hosting_cost": 100,
        "storage_cost": 40,
        "monitoring_cost": 30,
        "maintenance_cost": 220,
        "fine_tuning_cost": 200,
        "setup_cost": 3500,
    },
    "large": {
        "hardware": "2x L40S or 1x A100 80GB",
        "gpu_cost": 1450,
        "hosting_cost": 180,
        "storage_cost": 70,
        "monitoring_cost": 45,
        "maintenance_cost": 320,
        "fine_tuning_cost": 300,
        "setup_cost": 5500,
    },
    "enterprise": {
        "hardware": "2-4x A100/H100",
        "gpu_cost": 3200,
        "hosting_cost": 350,
        "storage_cost": 120,
        "monitoring_cost": 80,
        "maintenance_cost": 600,
        "fine_tuning_cost": 500,
        "setup_cost": 9000,
    },
}


class CalculationRequest(BaseModel):
    company_name: str = "Acme Support"
    team_size: int = Field(default=25, ge=1)
    provider: str = "Claude Sonnet"
    monthly_requests: int = Field(default=300000, ge=0)
    input_tokens: int = Field(default=800, ge=0)
    output_tokens: int = Field(default=450, ge=0)

    # These are now optional overrides. If the user (or frontend) doesn't
    # send them, they're auto-filled from the recommended hardware tier
    # based on team_size + monthly_tokens, so the numbers stay consistent
    # with whatever model/hardware is being recommended.
    gpu_cost: float | None = Field(default=None, ge=0)
    hosting_cost: float | None = Field(default=None, ge=0)
    storage_cost: float | None = Field(default=None, ge=0)
    monitoring_cost: float | None = Field(default=None, ge=0)
    maintenance_cost: float | None = Field(default=None, ge=0)
    fine_tuning_cost: float | None = Field(default=None, ge=0)
    setup_cost: float | None = Field(default=None, ge=0)


def get_hardware_tier(team_size: int, monthly_tokens: int) -> str:
    if team_size <= 20 and monthly_tokens < 25_000_000:
        return "small"
    if team_size <= 80 and monthly_tokens < 120_000_000:
        return "medium"
    if team_size <= 300:
        return "large"
    return "enterprise"


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

    # Figure out which hardware tier this workload falls into, and use its
    # realistic defaults for any cost field the user didn't explicitly set.
    tier = get_hardware_tier(payload.team_size, monthly_tokens)
    defaults = HARDWARE_TIERS[tier]

    gpu_cost = payload.gpu_cost if payload.gpu_cost is not None else defaults["gpu_cost"]
    hosting_cost = payload.hosting_cost if payload.hosting_cost is not None else defaults["hosting_cost"]
    storage_cost = payload.storage_cost if payload.storage_cost is not None else defaults["storage_cost"]
    monitoring_cost = payload.monitoring_cost if payload.monitoring_cost is not None else defaults["monitoring_cost"]
    maintenance_cost = payload.maintenance_cost if payload.maintenance_cost is not None else defaults["maintenance_cost"]
    fine_tuning_cost = payload.fine_tuning_cost if payload.fine_tuning_cost is not None else defaults["fine_tuning_cost"]
    setup_cost = payload.setup_cost if payload.setup_cost is not None else defaults["setup_cost"]

    self_hosted_cost = (
        gpu_cost
        + hosting_cost
        + storage_cost
        + monitoring_cost
        + maintenance_cost
        + fine_tuning_cost
    )

    monthly_savings = api_cost - self_hosted_cost
    break_even_months = setup_cost / monthly_savings if monthly_savings > 0 else inf

    return {
        "company_name": payload.company_name,
        "api_cost": round(api_cost, 2),
        "self_hosted_cost": round(self_hosted_cost, 2),
        "monthly_savings": round(monthly_savings, 2),
        "yearly_savings": round(monthly_savings * 12, 2),
        "break_even_months": None if break_even_months == inf else round(break_even_months, 2),
        "roi": round((monthly_savings / self_hosted_cost) * 100, 2) if self_hosted_cost > 0 else 0,
        "monthly_input_tokens": monthly_input_tokens,
        "monthly_output_tokens": monthly_output_tokens,
        "monthly_tokens": monthly_tokens,
        "cost_breakdown": {
            "gpu_cost": gpu_cost,
            "hosting_cost": hosting_cost,
            "storage_cost": storage_cost,
            "monitoring_cost": monitoring_cost,
            "maintenance_cost": maintenance_cost,
            "fine_tuning_cost": fine_tuning_cost,
            "setup_cost": setup_cost,
        },
        "recommendation": recommend_model(tier),
    }