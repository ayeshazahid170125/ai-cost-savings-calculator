import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  BarChart3,
  Brain,
  Calculator,
  DollarSign,
  Download,
  FileText,
  History,
  Percent,
  Server,
  Tag,
  TrendingDown,
  Upload
} from "lucide-react";
import "./styles.css";

const PROVIDERS = {
  "OpenAI GPT-4o": { input: 5, output: 15 },
  "OpenAI GPT-4o mini": { input: 0.15, output: 0.6 },
  "Claude Sonnet": { input: 3, output: 15 },
  "Claude Haiku": { input: 0.25, output: 1.25 }
};

// Round 2: hardware tiers no longer carry flat monthly cost guesses.
// Instead they carry throughput/pricing assumptions used to derive infra
// cost from actual token volume. Mirrors the backend's HARDWARE_TIERS so
// browser-fallback mode and the live API give consistent numbers.
const HARDWARE_TIERS = {
  small: {
    hardware: "1x RTX 4090",
    combinedThroughputTokensPerSec: 150,
    hourlyGpuRateCombined: 0.8,
    fineTuningCost: 150,
    setupCost: 2500
  },
  medium: {
    hardware: "1x RTX 4090 or L40S",
    combinedThroughputTokensPerSec: 250,
    hourlyGpuRateCombined: 1.6,
    fineTuningCost: 200,
    setupCost: 3500
  },
  large: {
    hardware: "2x L40S or 1x A100 80GB",
    combinedThroughputTokensPerSec: 500,
    hourlyGpuRateCombined: 6.0,
    fineTuningCost: 300,
    setupCost: 5500
  },
  enterprise: {
    hardware: "2-4x A100/H100",
    combinedThroughputTokensPerSec: 900,
    hourlyGpuRateCombined: 12.0,
    fineTuningCost: 500,
    setupCost: 9000
  }
};

// Supporting infra scaled off gpu_cost_auto rather than guessed independently.
const INFRA_RATIOS = {
  hostingCost: 0.15,
  storageCost: 0.05,
  monitoringCost: 0.05,
  maintenanceCost: 0.2
};

const COST_FIELDS = [
  "gpuCost",
  "hostingCost",
  "storageCost",
  "monitoringCost",
  "maintenanceCost",
  "fineTuningCost",
  "setupCost"
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Round 2: primary signal is monthly_tokens (throughput); team_size is
// only a tie-breaker near a boundary.
function getHardwareTier(teamSize, monthlyTokens) {
  const order = ["small", "medium", "large", "enterprise"];
  let idx;
  if (monthlyTokens < 50_000_000) idx = 0;
  else if (monthlyTokens < 150_000_000) idx = 1;
  else if (monthlyTokens < 400_000_000) idx = 2;
  else idx = 3;

  if (teamSize > 300 && idx < 3) idx += 1;
  else if (teamSize > 80 && idx === 0) idx += 1;
  return order[idx];
}

// Derives gpu/hosting/storage/monitoring/maintenance cost from actual
// token throughput instead of a flat per-tier guess. Also applies the
// reliability/retry fudge factor before any cost is calculated.
function computeAutoInfraCosts(values, monthlyTokens) {
  const tier = getHardwareTier(values.teamSize, monthlyTokens);
  const defaults = HARDWARE_TIERS[tier];
  const effectiveSelfHostedTokens = monthlyTokens * values.reliabilityDeratingFactor;
  const effectiveThroughput =
    defaults.combinedThroughputTokensPerSec * values.targetGpuUtilization;
  const requiredGpuHours = effectiveSelfHostedTokens / (effectiveThroughput * 3600);
  const gpuCostAuto = requiredGpuHours * defaults.hourlyGpuRateCombined;

  return {
    tier,
    effectiveSelfHostedTokens,
    gpuCostAuto,
    hostingCostAuto: gpuCostAuto * INFRA_RATIOS.hostingCost,
    storageCostAuto: gpuCostAuto * INFRA_RATIOS.storageCost,
    monitoringCostAuto: gpuCostAuto * INFRA_RATIOS.monitoringCost,
    maintenanceCostAuto: gpuCostAuto * INFRA_RATIOS.maintenanceCost,
    fineTuningDefault: defaults.fineTuningCost,
    setupDefault: defaults.setupCost
  };
}

// Default form values reflect the "large" tier, since the default
// team size (25) and usage (300k requests/month) fall into that
// bracket — keeps the first thing a visitor sees realistic.
function buildDefaults() {
  const base = {
    companyName: "Acme Support",
    teamSize: 25,
    provider: "Claude Sonnet",
    monthlyRequests: 300000,
    inputTokens: 800,
    outputTokens: 450,
    infraCostingMode: "auto",
    gpuBillingMode: "cloud_rental",
    fineTuningBillingMode: "monthly",
    targetGpuUtilization: 0.4,
    reliabilityDeratingFactor: 1.2
  };
  const monthlyTokens =
    base.monthlyRequests * base.inputTokens + base.monthlyRequests * base.outputTokens;
  const auto = computeAutoInfraCosts(base, monthlyTokens);

  return {
    ...base,
    gpuCost: round2(auto.gpuCostAuto),
    hostingCost: round2(auto.hostingCostAuto),
    storageCost: round2(auto.storageCostAuto),
    monitoringCost: round2(auto.monitoringCostAuto),
    maintenanceCost: round2(auto.maintenanceCostAuto),
    fineTuningCost: auto.fineTuningDefault,
    setupCost: auto.setupDefault
  };
}

const DEFAULTS = buildDefaults();

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

const TIER_LABELS = {
  small: "Small (under 50M tokens/month)",
  medium: "Medium (50M–150M tokens/month)",
  large: "Large (150M–400M tokens/month)",
  enterprise: "Enterprise (over 400M tokens/month)"
};

const MODEL_BY_TIER = {
  small: {
    model: "Gemma 2 9B",
    latency: "1.0-1.8 sec",
    note: "Best for small teams, internal assistants, and FAQ style workloads."
  },
  medium: {
    model: "Llama 3.1 8B / Mistral 7B",
    latency: "1.5-2.5 sec",
    note: "Balanced option for support, sales, and knowledge-base workflows."
  },
  large: {
    model: "Mixtral 8x7B / Llama 3.1 70B quantized",
    latency: "2.5-4.0 sec",
    note: "Suitable when quality matters and usage is high."
  },
  enterprise: {
    model: "Llama 3.1 70B / DeepSeek class model",
    latency: "Enterprise dependent",
    note: "Needs capacity planning, observability, and dedicated DevOps ownership."
  }
};

function recommendModel(tier) {
  return {
    ...MODEL_BY_TIER[tier],
    hardware: HARDWARE_TIERS[tier].hardware,
    tierDriver: "monthly_tokens"
  };
}

function calculate(values) {
  const pricing = PROVIDERS[values.provider];
  const monthlyInputTokens = values.monthlyRequests * values.inputTokens;
  const monthlyOutputTokens = values.monthlyRequests * values.outputTokens;
  const monthlyTokens = monthlyInputTokens + monthlyOutputTokens;
  const apiCost =
    (monthlyInputTokens / 1_000_000) * pricing.input +
    (monthlyOutputTokens / 1_000_000) * pricing.output;

  const auto = computeAutoInfraCosts(values, monthlyTokens);
  const useAuto = values.infraCostingMode === "auto";

  const gpuCost = useAuto ? auto.gpuCostAuto : values.gpuCost;
  const hostingCost = useAuto ? auto.hostingCostAuto : values.hostingCost;
  const storageCost = useAuto ? auto.storageCostAuto : values.storageCost;
  const monitoringCost = useAuto ? auto.monitoringCostAuto : values.monitoringCost;
  const maintenanceCost = useAuto ? auto.maintenanceCostAuto : values.maintenanceCost;
  const fineTuningCost = values.fineTuningCost;
  const setupCost = values.setupCost;

  // GPU that's owned (not rented) is capital, not a recurring monthly
  // line item — it folds into effective_setup_cost instead.
  const monthlyGpuLine = values.gpuBillingMode === "cloud_rental" ? gpuCost : 0;
  const monthlyFineTuneCost = values.fineTuningBillingMode === "monthly" ? fineTuningCost : 0;

  const effectiveSetupCost =
    setupCost +
    (values.gpuBillingMode === "owned_hardware" ? gpuCost : 0) +
    (values.fineTuningBillingMode === "one_time" ? fineTuningCost : 0);

  const selfHostedCost =
    monthlyGpuLine + hostingCost + storageCost + monitoringCost + maintenanceCost + monthlyFineTuneCost;

  const monthlySavings = apiCost - selfHostedCost;
  const yearlySavings = monthlySavings * 12;

  let breakEvenMonths = null;
  let breakEvenNote = null;
  if (monthlySavings > 0) {
    breakEvenMonths = effectiveSetupCost / monthlySavings;
  } else {
    breakEvenNote = "Self-hosting is not cost-effective at this usage level.";
  }

  const annualRoiPercent =
    effectiveSetupCost > 0 ? ((yearlySavings - effectiveSetupCost) / effectiveSetupCost) * 100 : 0;
  const monthlyCostEfficiencyRatio = selfHostedCost > 0 ? (monthlySavings / selfHostedCost) * 100 : 0;

  return {
    monthlyInputTokens,
    monthlyOutputTokens,
    monthlyTokens,
    effectiveSelfHostedTokens: auto.effectiveSelfHostedTokens,
    apiCost,
    selfHostedCost,
    effectiveSetupCost,
    monthlySavings,
    yearlySavings,
    breakEvenMonths,
    breakEvenNote,
    annualRoiPercent,
    monthlyCostEfficiencyRatio,
    costBreakdown: { gpuCost, hostingCost, storageCost, monitoringCost, maintenanceCost, fineTuningCost, setupCost },
    recommendation: recommendModel(auto.tier)
  };
}

function toApiPayload(values, touchedCostFields) {
  // Only send a cost field as an explicit override if the user actually
  // edited it. Otherwise send null so the backend derives it itself
  // (auto-calculated or tier default, per infra_costing_mode).
  const override = (field) => (touchedCostFields.has(field) ? values[field] : null);

  return {
    company_name: values.companyName,
    team_size: values.teamSize,
    provider: values.provider,
    monthly_requests: values.monthlyRequests,
    input_tokens: values.inputTokens,
    output_tokens: values.outputTokens,
    infra_costing_mode: values.infraCostingMode,
    gpu_billing_mode: values.gpuBillingMode,
    fine_tuning_billing_mode: values.fineTuningBillingMode,
    target_gpu_utilization: values.targetGpuUtilization,
    reliability_derating_factor: values.reliabilityDeratingFactor,
    gpu_cost: override("gpuCost"),
    hosting_cost: override("hostingCost"),
    storage_cost: override("storageCost"),
    monitoring_cost: override("monitoringCost"),
    maintenance_cost: override("maintenanceCost"),
    fine_tuning_cost: override("fineTuningCost"),
    setup_cost: override("setupCost")
  };
}

function normalizeApiResult(data) {
  return {
    monthlyInputTokens: data.monthly_input_tokens,
    monthlyOutputTokens: data.monthly_output_tokens,
    monthlyTokens: data.monthly_tokens,
    effectiveSelfHostedTokens: data.effective_self_hosted_tokens,
    apiCost: data.api_cost,
    selfHostedCost: data.self_hosted_cost,
    effectiveSetupCost: data.effective_setup_cost,
    monthlySavings: data.monthly_savings,
    yearlySavings: data.yearly_savings,
    breakEvenMonths: data.break_even_months,
    breakEvenNote: data.break_even_note,
    annualRoiPercent: data.annual_roi_percent,
    monthlyCostEfficiencyRatio: data.monthly_cost_efficiency_ratio,
    costBreakdown: {
      gpuCost: data.cost_breakdown.gpu_cost,
      hostingCost: data.cost_breakdown.hosting_cost,
      storageCost: data.cost_breakdown.storage_cost,
      monitoringCost: data.cost_breakdown.monitoring_cost,
      maintenanceCost: data.cost_breakdown.maintenance_cost,
      fineTuningCost: data.cost_breakdown.fine_tuning_cost,
      setupCost: data.cost_breakdown.setup_cost
    },
    recommendation: data.recommendation
  };
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function toNumber(value) {
  const number = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function getFirstNumber(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") {
      return toNumber(row[name]);
    }
  }
  return 0;
}

function providerFromCsv(rows) {
  const modelText = rows
    .map((row) => `${row.model || ""} ${row.provider || ""} ${row.service || ""}`)
    .join(" ")
    .toLowerCase();

  if (modelText.includes("haiku")) return "Claude Haiku";
  if (modelText.includes("claude") || modelText.includes("sonnet")) return "Claude Sonnet";
  if (modelText.includes("mini")) return "OpenAI GPT-4o mini";
  if (modelText.includes("gpt") || modelText.includes("openai")) return "OpenAI GPT-4o";
  return null;
}

function summarizeCsvUsage(text) {
  const parsedRows = parseCsv(text);
  if (parsedRows.length < 2) {
    throw new Error("CSV file is empty or missing data rows.");
  }

  const headers = parsedRows[0].map(normalizeHeader);
  const rows = parsedRows.slice(1).map((cells) =>
    headers.reduce((record, header, index) => {
      record[header] = cells[index] || "";
      return record;
    }, {})
  );

  let requestCount = 0;
  let inputTokenTotal = 0;
  let outputTokenTotal = 0;

  rows.forEach((row) => {
    const rowRequests =
      getFirstNumber(row, ["requests", "request_count", "num_requests", "count"]) || 1;
    const inputTokens = getFirstNumber(row, [
      "input_tokens",
      "prompt_tokens",
      "input_token_count",
      "prompt_token_count"
    ]);
    const outputTokens = getFirstNumber(row, [
      "output_tokens",
      "completion_tokens",
      "output_token_count",
      "completion_token_count"
    ]);
    const totalTokens = getFirstNumber(row, ["total_tokens", "tokens", "token_count"]);

    requestCount += rowRequests;

    if (inputTokens || outputTokens) {
      inputTokenTotal += inputTokens;
      outputTokenTotal += outputTokens;
    } else if (totalTokens) {
      inputTokenTotal += totalTokens * 0.65;
      outputTokenTotal += totalTokens * 0.35;
    }
  });

  if (!requestCount || (!inputTokenTotal && !outputTokenTotal)) {
    throw new Error("Could not find request or token columns in this CSV.");
  }

  return {
    rows: rows.length,
    provider: providerFromCsv(rows),
    monthlyRequests: Math.round(requestCount),
    inputTokens: Math.round(inputTokenTotal / requestCount),
    outputTokens: Math.round(outputTokenTotal / requestCount),
    inputTokenTotal: Math.round(inputTokenTotal),
    outputTokenTotal: Math.round(outputTokenTotal)
  };
}

function NumberField({ label, name, value, onChange, prefix = "", suffix = "", step = "any" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        {prefix && <small>{prefix}</small>}
        <input
          type="number"
          min="0"
          step={step}
          name={name}
          value={value}
          onChange={onChange}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function App() {
  const [values, setValues] = useState(DEFAULTS);
  // Tracks which self-hosted cost fields the user has manually edited.
  // Untouched fields keep auto-updating to match the recommended
  // hardware tier as team size / usage change; touched fields are left
  // alone so the user's own numbers are never silently overwritten.
  const [touchedCostFields, setTouchedCostFields] = useState(new Set());
  const fallbackResult = useMemo(() => calculate(values), [values]);
  // Always reflects the auto-derived recommendation (tier, hardware, and
  // dollar breakdown), regardless of which infra_costing_mode is currently
  // selected. Used to show a friendly "here's what we estimated for you"
  // summary even while the user is in manual mode.
  const autoInfra = useMemo(() => {
    const monthlyTokens =
      values.monthlyRequests * values.inputTokens + values.monthlyRequests * values.outputTokens;
    const auto = computeAutoInfraCosts(values, monthlyTokens);
    return {
      tier: auto.tier,
      monthlyTokensForDisplay: monthlyTokens,
      gpuCost: round2(auto.gpuCostAuto),
      hostingCost: round2(auto.hostingCostAuto),
      storageCost: round2(auto.storageCostAuto),
      monitoringCost: round2(auto.monitoringCostAuto),
      maintenanceCost: round2(auto.maintenanceCostAuto),
      fineTuningCost: auto.fineTuningDefault,
      setupCost: auto.setupDefault,
      recommendation: recommendModel(auto.tier)
    };
  }, [
    values.teamSize,
    values.monthlyRequests,
    values.inputTokens,
    values.outputTokens,
    values.reliabilityDeratingFactor,
    values.targetGpuUtilization
  ]);
  const [apiResult, setApiResult] = useState(null);
  const [apiStatus, setApiStatus] = useState("Calculating with backend...");
  const [uploadSummary, setUploadSummary] = useState("");
  // Billing modes default to the conservative options (cloud_rental,
  // monthly) so numbers aren't accidentally optimistic. Per README's
  // Known Limitations, the user still needs to explicitly confirm these
  // match their real arrangement before the figures should be trusted
  // for a client-facing report — wrong mode silently skews break-even/ROI.
  const [billingConfirmed, setBillingConfirmed] = useState(false);
  // Most users (e.g. a compliance/ops person filling this in) don't know
  // GPU throughput or hourly cloud rates. Auto mode already derives every
  // infra dollar figure from usage + recommended tier; these toggles just
  // control whether the underlying technical assumptions are shown at all.
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const result = apiResult || fallbackResult;

  useEffect(() => {
    const monthlyTokens =
      values.monthlyRequests * values.inputTokens + values.monthlyRequests * values.outputTokens;
    const auto = computeAutoInfraCosts(values, monthlyTokens);
    const recommended = {
      gpuCost: round2(auto.gpuCostAuto),
      hostingCost: round2(auto.hostingCostAuto),
      storageCost: round2(auto.storageCostAuto),
      monitoringCost: round2(auto.monitoringCostAuto),
      maintenanceCost: round2(auto.maintenanceCostAuto),
      fineTuningCost: auto.fineTuningDefault,
      setupCost: auto.setupDefault
    };

    setValues((current) => {
      const next = { ...current };
      let changed = false;
      COST_FIELDS.forEach((field) => {
        if (!touchedCostFields.has(field) && current[field] !== recommended[field]) {
          next[field] = recommended[field];
          changed = true;
        }
      });
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.teamSize,
    values.monthlyRequests,
    values.inputTokens,
    values.outputTokens,
    values.reliabilityDeratingFactor,
    values.targetGpuUtilization
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setApiStatus("Calculating with backend...");

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/calculate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toApiPayload(values, touchedCostFields)),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        setApiResult(normalizeApiResult(data));
        setApiStatus("Backend connected");
      } catch (error) {
        if (error.name !== "AbortError") {
          setApiResult(null);
          setApiStatus("Using browser fallback. Start backend for API mode.");
        }
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [values, touchedCostFields]);

  const comparisonData = [
    { name: "Current API", cost: Math.round(result.apiCost) },
    { name: "Self-hosted", cost: Math.round(result.selfHostedCost) }
  ];

  const projectionData = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      month: `M${month}`,
      api: Math.round(result.apiCost * month),
      selfHosted: Math.round(result.effectiveSetupCost + result.selfHostedCost * month)
    };
  });

  const STRING_FIELDS = ["companyName", "provider", "infraCostingMode", "gpuBillingMode", "fineTuningBillingMode"];

  function handleChange(event) {
    const { name, value } = event.target;
    if (COST_FIELDS.includes(name)) {
      setTouchedCostFields((current) => new Set(current).add(name));
    }
    if (name === "gpuBillingMode" || name === "fineTuningBillingMode") {
      setBillingConfirmed(false);
    }
    setValues((current) => ({
      ...current,
      [name]: STRING_FIELDS.includes(name) ? value : Number(value)
    }));
  }

  function handleCsvUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const summary = summarizeCsvUsage(String(reader.result || ""));
        setValues((current) => ({
          ...current,
          provider: summary.provider || current.provider,
          monthlyRequests: summary.monthlyRequests,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens
        }));
        setUploadSummary(
          `Loaded ${summary.rows} rows from ${file.name}: ${summary.monthlyRequests.toLocaleString("en-US")} requests, ${(summary.inputTokenTotal + summary.outputTokenTotal).toLocaleString("en-US")} tokens.`
        );
      } catch (error) {
        setUploadSummary(error.message);
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function downloadReport() {
    const doc = new jsPDF();
    const generatedAt = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    const breakEven =
      result.breakEvenMonths != null
        ? `${result.breakEvenMonths.toFixed(1)} months`
        : result.breakEvenNote || "Not cost-effective at this usage level";

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("AI Cost Savings Report", 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated for ${values.companyName} on ${generatedAt}`, 14, 27);

    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Executive Summary", 14, 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const summary = doc.splitTextToSize(
      `${values.companyName} currently spends an estimated ${currency(result.apiCost)} per month on ${values.provider}. ` +
        `A self-hosted model setup is projected at ${currency(result.selfHostedCost)} per month, creating ${currency(result.monthlySavings)} in monthly savings and ${currency(result.yearlySavings)} in yearly savings.`,
      180
    );
    doc.text(summary, 14, 58);

    const rows = [
      ["Team size", `${values.teamSize} users`],
      ["Monthly requests", values.monthlyRequests.toLocaleString("en-US")],
      ["Monthly tokens", result.monthlyTokens.toLocaleString("en-US")],
      ["Current API cost", currency(result.apiCost)],
      ["Self-hosted cost", currency(result.selfHostedCost)],
      ["Monthly savings", currency(result.monthlySavings)],
      ["Yearly savings", currency(result.yearlySavings)],
      ["Annual ROI", `${result.annualRoiPercent.toFixed(1)}%`],
      ["Monthly cost efficiency ratio", `${result.monthlyCostEfficiencyRatio.toFixed(1)}%`],
      ["Break-even", breakEven],
      ["Recommended model", result.recommendation.model],
      ["Recommended hardware", result.recommendation.hardware],
      ["Expected latency", result.recommendation.latency]
    ];

    let y = 88;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Cost Breakdown", 14, y);
    y += 10;

    rows.forEach(([label, value], index) => {
      if (index % 2 === 0) {
        doc.setFillColor(245, 247, 251);
        doc.rect(14, y - 6, 182, 9, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(label, 18, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(value), 84, y);
      y += 9;
    });

    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Recommendation Note", 14, y);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(result.recommendation.note, 180), 14, y);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Assumptions are estimates for planning. Final infrastructure costs depend on model size, latency target, cloud provider, and DevOps ownership.",
      14,
      274
    );
    doc.setFont("helvetica", "bold");
    doc.text(
      "Scope: estimate reflects infrastructure costs only; excludes engineering and operational overhead.",
      14,
      280
    );
    doc.setFont("helvetica", billingConfirmed ? "normal" : "bold");
    doc.setTextColor(billingConfirmed ? 100 : 180, billingConfirmed ? 116 : 83, billingConfirmed ? 139 : 9);
    doc.text(
      billingConfirmed
        ? "Billing modes (GPU / fine-tuning) were confirmed by the preparer before this report was generated."
        : "Note: GPU/fine-tuning billing modes were NOT confirmed by the preparer — verify before sharing.",
      14,
      286
    );

    const fileName = `${values.companyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-ai-cost-report.pdf`;
    doc.save(fileName);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">
            <Brain size={22} />
            <div>
              <strong>AI CostOps</strong>
              <span>Calculator</span>
            </div>
          </div>
          <nav className="nav">
            <a className="active" href="#dashboard">
              <BarChart3 size={16} />
              Overview
            </a>
            <a href="#pricing">
              <Tag size={16} />
              Pricing
            </a>
            <a href="#history">
              <History size={16} />
              History
            </a>
            <a href="#reports">
              <FileText size={16} />
              Reports
            </a>
          </nav>
        </div>
      </header>

      <div className="app">
      <section id="dashboard" className="hero">
        <div>
          <p className="eyebrow">AI Infrastructure Cost Optimization</p>
          <h1>AI Cost Savings Calculator</h1>
          <p>
            Estimate monthly ChatGPT or Claude spend, compare it with a self-hosted
            fine-tuned model, and calculate savings, ROI, and break-even time.
          </p>
          <span className={apiResult ? "status connected" : "status"}>
            {apiStatus}
          </span>
        </div>
        <div className="heroStats">
          <div>
            <span>Monthly Savings</span>
            <strong className={result.monthlySavings >= 0 ? "positive" : "negative"}>
              {currency(result.monthlySavings)}
            </strong>
          </div>
          <div>
            <span>Break-even</span>
            <strong>
              {result.breakEvenMonths != null
                ? `${result.breakEvenMonths.toFixed(1)} months`
                : "Not cost-effective"}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel uploadPanel">
        <div>
          <div className="sectionTitle">
            <Upload size={20} />
            <h2>Upload Real Usage CSV</h2>
          </div>
          <p>
            Upload OpenAI, Claude, or internal usage CSV data. The app will read
            requests and token columns, then auto-fill monthly usage.
          </p>
          {uploadSummary && <small className="uploadSummary">{uploadSummary}</small>}
        </div>
        <label className="uploadButton">
          <Upload size={18} />
          Choose CSV File
          <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} />
        </label>
      </section>

      <section id="pricing" className="grid">
        <form className="panel">
          <div className="sectionTitle">
            <Calculator size={20} />
            <h2>Company Usage</h2>
          </div>

          <label className="field">
            <span>Company name</span>
            <input
              type="text"
              name="companyName"
              value={values.companyName}
              onChange={handleChange}
            />
          </label>

          <label className="field">
            <span>Current provider</span>
            <select name="provider" value={values.provider} onChange={handleChange}>
              {Object.keys(PROVIDERS).map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <NumberField label="Team size" name="teamSize" value={values.teamSize} onChange={handleChange} suffix="users" />
          <NumberField label="Monthly requests" name="monthlyRequests" value={values.monthlyRequests} onChange={handleChange} />
          <NumberField label="Average input tokens" name="inputTokens" value={values.inputTokens} onChange={handleChange} suffix="/request" />
          <NumberField label="Average output tokens" name="outputTokens" value={values.outputTokens} onChange={handleChange} suffix="/request" />
        </form>

        <section className="panel">
          <div className="sectionTitle">
            <Server size={20} />
            <h2>Recommended Infrastructure</h2>
          </div>
          <p style={{ marginTop: "-8px", marginBottom: "16px", color: "#64748b", fontSize: "0.85rem", lineHeight: 1.5 }}>
            You don't need to know GPU pricing or server specs — this is
            generated automatically from your company usage on the left.
          </p>

          <div
            style={{
              marginBottom: "16px",
              padding: "16px",
              border: "1px solid #bfdbfe",
              borderRadius: "8px",
              background: "#eff6ff"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                marginBottom: "8px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Server size={16} color="#1d4ed8" />
                <strong style={{ fontSize: "0.95rem", color: "#1e3a8a" }}>
                  {autoInfra.recommendation.model}
                </strong>
              </div>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  color: "#065f46",
                  background: "#d1fae5",
                  padding: "3px 9px",
                  borderRadius: "999px",
                  whiteSpace: "nowrap"
                }}
              >
                ✓ Auto Generated
              </span>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: "0.83rem", color: "#334155", lineHeight: 1.5 }}>
              Based on your usage, we recommend {autoInfra.recommendation.hardware}. Every
              cost below is calculated automatically — nothing to fill in.
            </p>
            <div
              style={{
                marginBottom: "12px",
                padding: "10px 12px",
                border: "1px dashed #93c5fd",
                borderRadius: "6px",
                background: "#fff",
                fontSize: "0.78rem",
                color: "#475569",
                lineHeight: 1.6
              }}
            >
              <strong style={{ color: "#1e3a8a" }}>Why this recommendation: </strong>
              {values.teamSize} team members × {values.monthlyRequests.toLocaleString("en-US")}{" "}
              requests/month × ({values.inputTokens} in + {values.outputTokens} out tokens) ≈{" "}
              {(autoInfra.monthlyTokensForDisplay / 1_000_000).toFixed(1)}M tokens/month, which
              falls in the <strong>{TIER_LABELS[autoInfra.tier]}</strong> tier. A reliability
              factor of {values.reliabilityDeratingFactor}x is applied on top of that, assuming
              the self-hosted model needs that much more effective compute to match your
              current provider's reliability.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "10px"
              }}
            >
              {[
                ["GPU", autoInfra.gpuCost],
                ["Hosting", autoInfra.hostingCost],
                ["Storage", autoInfra.storageCost],
                ["Monitoring", autoInfra.monitoringCost],
                ["Maintenance", autoInfra.maintenanceCost],
                ["Fine-tuning", autoInfra.fineTuningCost],
                ["Setup (one-time)", autoInfra.setupCost]
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    background: "#fff",
                    border: "1px solid #dbeafe",
                    borderRadius: "6px",
                    padding: "8px 10px"
                  }}
                >
                  <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#1e3a8a" }}>
                    {currency(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="field">
            <span>GPU billing mode</span>
            <select name="gpuBillingMode" value={values.gpuBillingMode} onChange={handleChange}>
              <option value="cloud_rental">Cloud rental (recurring monthly)</option>
              <option value="owned_hardware">Owned hardware (one-time, in setup cost)</option>
            </select>
          </label>

          <label className="field">
            <span>Fine-tuning billing mode</span>
            <select name="fineTuningBillingMode" value={values.fineTuningBillingMode} onChange={handleChange}>
              <option value="monthly">Recurring monthly</option>
              <option value="one_time">One-time (in setup cost)</option>
            </select>
          </label>

          {!billingConfirmed && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "14px",
                padding: "12px 14px",
                border: "1px solid #fcd34d",
                borderRadius: "8px",
                background: "#fffbeb"
              }}
            >
              <span style={{ fontSize: "0.85rem", color: "#92400e", lineHeight: 1.5 }}>
                ⚠️ Please confirm these billing modes match your real arrangement. Wrong
                mode silently skews break-even and ROI.
              </span>
              <button
                type="button"
                onClick={() => setBillingConfirmed(true)}
                style={{
                  flexShrink: 0,
                  border: 0,
                  borderRadius: "6px",
                  padding: "8px 14px",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  color: "#fff",
                  background: "#d97706",
                  cursor: "pointer"
                }}
              >
                Confirm
              </button>
            </div>
          )}
          {billingConfirmed && (
            <p
              style={{
                margin: "-4px 0 14px",
                fontSize: "0.82rem",
                color: "#059669",
                fontWeight: 700
              }}
            >
              ✓ Billing modes confirmed
            </p>
          )}

          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
            <button
              type="button"
              onClick={() => setShowAdvancedSettings((current) => !current)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: 0,
                background: "none",
                color: "#1d4ed8",
                fontWeight: 700,
                fontSize: "0.85rem",
                cursor: "pointer",
                padding: 0,
                marginBottom: showAdvancedSettings ? "14px" : 0
              }}
            >
              <span style={{ display: "inline-block", transform: showAdvancedSettings ? "rotate(90deg)" : "none", transition: "transform 150ms ease" }}>
                ▶
              </span>
              {showAdvancedSettings ? "Hide Advanced Settings" : "Need custom infrastructure? Advanced Settings"}
            </button>

            {showAdvancedSettings && (
              <>
                <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#64748b", lineHeight: 1.5 }}>
                  Everything here is pre-filled with our recommended estimate. Only
                  change a field if you have a real vendor quote or benchmark to
                  replace it with.
                </p>
                <NumberField label="GPU cost" name="gpuCost" value={values.gpuCost} onChange={handleChange} prefix="$" />
                <NumberField label="Hosting / electricity" name="hostingCost" value={values.hostingCost} onChange={handleChange} prefix="$" />
                <NumberField label="Storage" name="storageCost" value={values.storageCost} onChange={handleChange} prefix="$" />
                <NumberField label="Monitoring" name="monitoringCost" value={values.monitoringCost} onChange={handleChange} prefix="$" />
                <NumberField label="Maintenance" name="maintenanceCost" value={values.maintenanceCost} onChange={handleChange} prefix="$" />
                <NumberField label="Fine-tuning amortized" name="fineTuningCost" value={values.fineTuningCost} onChange={handleChange} prefix="$" />
                <NumberField label="One-time setup cost" name="setupCost" value={values.setupCost} onChange={handleChange} prefix="$" />
                <NumberField
                  label="Target GPU utilization"
                  name="targetGpuUtilization"
                  value={values.targetGpuUtilization}
                  onChange={handleChange}
                  suffix="(0-1, default 0.4 works for most teams)"
                />
                <NumberField
                  label="Reliability derating factor"
                  name="reliabilityDeratingFactor"
                  value={values.reliabilityDeratingFactor}
                  onChange={handleChange}
                  suffix="x (1.15-1.30 typical, estimate)"
                />
              </>
            )}
          </div>
        </section>
      </section>

      <section className="cards">
        <article className="metric metric-blue">
          <div className="metricHead">
            <span className="metricIcon"><DollarSign size={18} /></span>
            <span>Current API Cost</span>
          </div>
          <strong>{currency(result.apiCost)}</strong>
          <small>{(result.monthlyTokens / 1_000_000).toFixed(1)}M tokens/month</small>
        </article>
        <article className="metric metric-purple">
          <div className="metricHead">
            <span className="metricIcon"><Server size={18} /></span>
            <span>Self-hosted Cost</span>
          </div>
          <strong>{currency(result.selfHostedCost)}</strong>
          <small>Infrastructure + maintenance</small>
        </article>
        <article className="metric metric-green">
          <div className="metricHead">
            <span className="metricIcon"><TrendingDown size={18} /></span>
            <span>Yearly Savings</span>
          </div>
          <strong className={result.yearlySavings >= 0 ? "positive" : "negative"}>
            {currency(result.yearlySavings)}
          </strong>
          <small>{result.annualRoiPercent.toFixed(1)}% annual ROI</small>
        </article>
        <article className="metric metric-amber">
          <div className="metricHead">
            <span className="metricIcon"><Brain size={18} /></span>
            <span>Recommended Model</span>
          </div>
          <strong>{result.recommendation.model}</strong>
          <small>{result.recommendation.hardware}</small>
        </article>
        <article className="metric metric-pink">
          <div className="metricHead">
            <span className="metricIcon"><Percent size={18} /></span>
            <span>Cost Efficiency</span>
          </div>
          <strong className={result.monthlyCostEfficiencyRatio >= 0 ? "positive" : "negative"}>
            {result.monthlyCostEfficiencyRatio.toFixed(1)}%
          </strong>
          <small>Savings per $ of monthly self-hosted spend (not ROI)</small>
        </article>
      </section>

      <section id="history" className="grid charts">
        <article className="panel">
          <div className="sectionTitle">
            <TrendingDown size={20} />
            <h2>Monthly Cost Comparison</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={comparisonData}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => currency(value)} />
              <Bar dataKey="cost" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="panel">
          <div className="sectionTitle">
            <Brain size={20} />
            <h2>12-month Projection</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={projectionData}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => currency(value)} />
              <Line type="monotone" dataKey="api" stroke="#dc2626" strokeWidth={3} name="API" />
              <Line type="monotone" dataKey="selfHosted" stroke="#16a34a" strokeWidth={3} name="Self-hosted" />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section id="reports" className="panel report">
        <div>
          <div className="sectionTitle">
            <Download size={20} />
            <h2>Executive Summary</h2>
          </div>
          <p>
            {values.companyName} currently spends an estimated {currency(result.apiCost)} per
            month on {values.provider}. A self-hosted setup is projected at{" "}
            {currency(result.selfHostedCost)} per month, creating{" "}
            {currency(result.monthlySavings)} in monthly savings.
          </p>
          <p>
            Recommended setup: {result.recommendation.model} on {result.recommendation.hardware}.
            Expected latency: {result.recommendation.latency}. {result.recommendation.note}
          </p>
          <p style={{ fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.6 }}>
            These are estimated projections based on standard cloud GPU pricing and typical
            infrastructure costs. Actual costs may vary depending on real-world usage,
            provider rates, and chosen hosting setup.
          </p>
        </div>
        <button className="downloadButton" type="button" onClick={downloadReport}>
          <Download size={18} />
          Download PDF Report
        </button>
      </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);