import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  Download,
  FileText,
  History,
  Server,
  Settings,
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

// Realistic monthly self-hosted infrastructure costs by hardware tier.
// Mirrors the backend's HARDWARE_TIERS so browser-fallback mode and the
// live API give consistent, believable numbers (e.g. multi-month
// break-even instead of an unrealistic <1 month payback).
const HARDWARE_TIERS = {
  small: {
    hardware: "1x RTX 4090",
    gpuCost: 450,
    hostingCost: 60,
    storageCost: 25,
    monitoringCost: 20,
    maintenanceCost: 150,
    fineTuningCost: 150,
    setupCost: 2500
  },
  medium: {
    hardware: "1x RTX 4090 or L40S",
    gpuCost: 750,
    hostingCost: 100,
    storageCost: 40,
    monitoringCost: 30,
    maintenanceCost: 220,
    fineTuningCost: 200,
    setupCost: 3500
  },
  large: {
    hardware: "2x L40S or 1x A100 80GB",
    gpuCost: 1450,
    hostingCost: 180,
    storageCost: 70,
    monitoringCost: 45,
    maintenanceCost: 320,
    fineTuningCost: 300,
    setupCost: 5500
  },
  enterprise: {
    hardware: "2-4x A100/H100",
    gpuCost: 3200,
    hostingCost: 350,
    storageCost: 120,
    monitoringCost: 80,
    maintenanceCost: 600,
    fineTuningCost: 500,
    setupCost: 9000
  }
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

function getHardwareTier(teamSize, monthlyTokens) {
  if (teamSize <= 20 && monthlyTokens < 25_000_000) return "small";
  if (teamSize <= 80 && monthlyTokens < 120_000_000) return "medium";
  if (teamSize <= 300) return "large";
  return "enterprise";
}

// Default form values reflect the "large" tier, since the default
// team size (25) and usage (300k requests/month) fall into that
// bracket — keeps the first thing a visitor sees realistic.
const DEFAULTS = {
  companyName: "Acme Support",
  teamSize: 25,
  provider: "Claude Sonnet",
  monthlyRequests: 300000,
  inputTokens: 800,
  outputTokens: 450,
  ...HARDWARE_TIERS.large
};

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

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

function recommendModel(teamSize, monthlyTokens) {
  const tier = getHardwareTier(teamSize, monthlyTokens);
  return {
    ...MODEL_BY_TIER[tier],
    hardware: HARDWARE_TIERS[tier].hardware
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

  const selfHostedCost =
    values.gpuCost +
    values.hostingCost +
    values.storageCost +
    values.monitoringCost +
    values.maintenanceCost +
    values.fineTuningCost;

  const monthlySavings = apiCost - selfHostedCost;
  const yearlySavings = monthlySavings * 12;
  const breakEvenMonths = monthlySavings > 0 ? values.setupCost / monthlySavings : Infinity;
  const roi = selfHostedCost > 0 ? (monthlySavings / selfHostedCost) * 100 : 0;

  return {
    monthlyInputTokens,
    monthlyOutputTokens,
    monthlyTokens,
    apiCost,
    selfHostedCost,
    monthlySavings,
    yearlySavings,
    breakEvenMonths,
    roi,
    recommendation: recommendModel(values.teamSize, monthlyTokens)
  };
}

function toApiPayload(values) {
  return {
    company_name: values.companyName,
    team_size: values.teamSize,
    provider: values.provider,
    monthly_requests: values.monthlyRequests,
    input_tokens: values.inputTokens,
    output_tokens: values.outputTokens,
    gpu_cost: values.gpuCost,
    hosting_cost: values.hostingCost,
    storage_cost: values.storageCost,
    monitoring_cost: values.monitoringCost,
    maintenance_cost: values.maintenanceCost,
    fine_tuning_cost: values.fineTuningCost,
    setup_cost: values.setupCost
  };
}

function normalizeApiResult(data) {
  return {
    monthlyInputTokens: data.monthly_input_tokens,
    monthlyOutputTokens: data.monthly_output_tokens,
    monthlyTokens: data.monthly_tokens,
    apiCost: data.api_cost,
    selfHostedCost: data.self_hosted_cost,
    monthlySavings: data.monthly_savings,
    yearlySavings: data.yearly_savings,
    breakEvenMonths: data.break_even_months ?? Infinity,
    roi: data.roi,
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

function NumberField({ label, name, value, onChange, prefix = "", suffix = "" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inputWrap">
        {prefix && <small>{prefix}</small>}
        <input
          type="number"
          min="0"
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
  const [apiResult, setApiResult] = useState(null);
  const [apiStatus, setApiStatus] = useState("Calculating with backend...");
  const [uploadSummary, setUploadSummary] = useState("");
  const result = apiResult || fallbackResult;

  useEffect(() => {
    const monthlyTokens =
      values.monthlyRequests * values.inputTokens + values.monthlyRequests * values.outputTokens;
    const tier = getHardwareTier(values.teamSize, monthlyTokens);
    const recommended = HARDWARE_TIERS[tier];

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
  }, [values.teamSize, values.monthlyRequests, values.inputTokens, values.outputTokens]);

  useEffect(() => {
    const controller = new AbortController();
    setApiStatus("Calculating with backend...");

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/calculate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toApiPayload(values)),
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
  }, [values]);

  const comparisonData = [
    { name: "Current API", cost: Math.round(result.apiCost) },
    { name: "Self-hosted", cost: Math.round(result.selfHostedCost) }
  ];

  const projectionData = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      month: `M${month}`,
      api: Math.round(result.apiCost * month),
      selfHosted: Math.round(values.setupCost + result.selfHostedCost * month)
    };
  });

  function handleChange(event) {
    const { name, value } = event.target;
    if (COST_FIELDS.includes(name)) {
      setTouchedCostFields((current) => new Set(current).add(name));
    }
    setValues((current) => ({
      ...current,
      [name]: name === "companyName" || name === "provider" ? value : Number(value)
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
    const breakEven = Number.isFinite(result.breakEvenMonths)
      ? `${result.breakEvenMonths.toFixed(1)} months`
      : "No break-even with current assumptions";

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
      ["ROI", `${result.roi.toFixed(1)}%`],
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
      284
    );

    const fileName = `${values.companyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-ai-cost-report.pdf`;
    doc.save(fileName);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Brain size={24} />
          <div>
            <strong>AI CostOps</strong>
            <span>Calculator</span>
          </div>
        </div>
        <nav className="nav">
          <a className="active" href="#dashboard">
            <BarChart3 size={18} />
            Dashboard
          </a>
          <a href="#reports">
            <FileText size={18} />
            Reports
          </a>
          <a href="#history">
            <History size={18} />
            History
          </a>
          <a href="#pricing">
            <Tag size={18} />
            Pricing
          </a>
          <a href="#settings">
            <Settings size={18} />
            Settings
          </a>
        </nav>
      </aside>

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
              {Number.isFinite(result.breakEvenMonths)
                ? `${result.breakEvenMonths.toFixed(1)} months`
                : "No savings yet"}
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
            <h2>Self-hosted Estimate</h2>
          </div>
          <p style={{ marginTop: "-8px", marginBottom: "16px", color: "#64748b", fontSize: "0.85rem", lineHeight: 1.5 }}>
            These auto-fill based on the recommended hardware tier for your team size and
            usage. Edit any field to override it with your own numbers.
          </p>

          <NumberField label="GPU cost" name="gpuCost" value={values.gpuCost} onChange={handleChange} prefix="$" />
          <NumberField label="Hosting / electricity" name="hostingCost" value={values.hostingCost} onChange={handleChange} prefix="$" />
          <NumberField label="Storage" name="storageCost" value={values.storageCost} onChange={handleChange} prefix="$" />
          <NumberField label="Monitoring" name="monitoringCost" value={values.monitoringCost} onChange={handleChange} prefix="$" />
          <NumberField label="Maintenance" name="maintenanceCost" value={values.maintenanceCost} onChange={handleChange} prefix="$" />
          <NumberField label="Fine-tuning amortized" name="fineTuningCost" value={values.fineTuningCost} onChange={handleChange} prefix="$" />
          <NumberField label="One-time setup cost" name="setupCost" value={values.setupCost} onChange={handleChange} prefix="$" />
        </section>
      </section>

      <section className="cards">
        <article className="metric">
          <span>Current API Cost</span>
          <strong>{currency(result.apiCost)}</strong>
          <small>{(result.monthlyTokens / 1_000_000).toFixed(1)}M tokens/month</small>
        </article>
        <article className="metric">
          <span>Self-hosted Cost</span>
          <strong>{currency(result.selfHostedCost)}</strong>
          <small>Infrastructure + maintenance</small>
        </article>
        <article className="metric">
          <span>Yearly Savings</span>
          <strong className={result.yearlySavings >= 0 ? "positive" : "negative"}>
            {currency(result.yearlySavings)}
          </strong>
          <small>{result.roi.toFixed(1)}% monthly ROI</small>
        </article>
        <article className="metric">
          <span>Recommended Model</span>
          <strong>{result.recommendation.model}</strong>
          <small>{result.recommendation.hardware}</small>
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
              <CartesianGrid strokeDasharray="3 3" />
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
              <CartesianGrid strokeDasharray="3 3" />
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