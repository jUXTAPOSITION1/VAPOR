// VAPOR live dashboard — polls the facilitator's public, unauthenticated
// /stats and /stats/timeseries endpoints. No fabricated numbers: every
// value rendered here is exactly what the API returned.

const API_BASE = "https://x402.duckdns.org";

const STATS_POLL_MS = 8000;
const TIMESERIES_POLL_MS = 30000;

// Range selector state — hours sent to the backend; bucket is left for the
// API to auto-select (hourly under a week, daily beyond) except where an
// explicit choice reads better for that window.
const RANGES = {
  "1d": { hours: 24, bucket: "hour", label: "last 24 hours" },
  "7d": { hours: 24 * 7, bucket: "hour", label: "last 7 days" },
  "30d": { hours: 24 * 30, bucket: "day", label: "last 30 days" },
  "90d": { hours: 24 * 90, bucket: "day", label: "last 90 days" },
  "1y": { hours: 24 * 365, bucket: "day", label: "last year" },
};
let activeRange = "1d";

const fmtInt = (n) => Number(n ?? 0).toLocaleString("en-US");
const fmtUsd = (n) =>
  Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtPct = (n) => `${Number(n ?? 0).toFixed(1)}%`;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setLiveStatus(ok) {
  const dot = document.getElementById("live-dot");
  const label = document.getElementById("live-label");
  if (!dot || !label) return;
  if (ok) {
    dot.classList.remove("bg-rose-500");
    dot.classList.add("bg-emerald-500", "live-dot");
    label.textContent = "LIVE";
    label.classList.remove("text-rose-400");
    label.classList.add("text-zinc-400");
  } else {
    dot.classList.remove("bg-emerald-500", "live-dot");
    dot.classList.add("bg-rose-500");
    label.textContent = "RECONNECTING";
    label.classList.remove("text-zinc-400");
    label.classList.add("text-rose-400");
  }
}

function formatUptime(seconds) {
  const s = Number(seconds ?? 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

let activityChart = null;
let riskChart = null;

const MONO_FONT = { family: "JetBrains Mono" };

function renderStats(stats) {
  const successRate =
    stats.totals.verifyRequests > 0 ? (stats.totals.validVerifyCount / stats.totals.verifyRequests) * 100 : 100;

  setText("stat-verify", fmtInt(stats.totals.verifyRequests));
  setText("stat-settle", fmtInt(stats.totals.settleRequests));
  setText("stat-success-rate", fmtPct(successRate));
  setText("stat-volume", fmtUsd(stats.totals.settledVolumeUsd));
  setText("stat-avg-risk", stats.averageRiskScore === null ? "—" : stats.averageRiskScore.toFixed(1));
  setText("stat-uptime", formatUptime(stats.uptimeSeconds));
  setText("stat-networks", fmtInt(stats.networks.length));
  setText("footer-generated-at", new Date(stats.generatedAt).toLocaleString());

  renderRiskChart(stats.riskBandCounts);
}

// Horizontal bar, not a doughnut/pie — a plain, information-dense read on
// exact counts per band rather than a decorative proportion shape. Colors
// stay functional (risk severity), not brand chrome: green→red maps
// directly to low→severe, the one place this dashboard uses more than one
// hue on purpose, since the color IS the data here.
function renderRiskChart(riskBandCounts) {
  const canvas = document.getElementById("risk-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const order = ["low", "medium", "high", "severe"];
  const colors = { low: "#4ade80", medium: "#fbbf24", high: "#fb923c", severe: "#f87171" };
  const labels = order.filter((k) => riskBandCounts[k] !== undefined);
  const data = labels.map((k) => riskBandCounts[k]);

  if (labels.length === 0) {
    labels.push("no data yet");
    data.push(0);
  }

  const backgroundColor = labels[0] === "no data yet" ? ["#3f3f46"] : labels.map((l) => colors[l]);

  if (riskChart) {
    riskChart.data.labels = labels;
    riskChart.data.datasets[0].data = data;
    riskChart.data.datasets[0].backgroundColor = backgroundColor;
    riskChart.update("none");
    return;
  }

  riskChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ data, backgroundColor, borderWidth: 0, barThickness: 18 }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#71717a", precision: 0, font: MONO_FONT },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#a1a1aa", font: MONO_FONT },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

// Plain thin lines, no fill/gradient — verify in near-white, settle in the
// site's one accent color, so the two series read clearly against a flat
// background instead of a glowing area chart.
function renderActivityChart(points, bucket) {
  const canvas = document.getElementById("activity-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = points.map((p) =>
    bucket === "day"
      ? new Date(p.bucket).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : new Date(p.bucket).toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
  );
  const verify = points.map((p) => p.verifyCount);
  const settle = points.map((p) => p.settleCount);

  if (activityChart) {
    activityChart.data.labels = labels;
    activityChart.data.datasets[0].data = verify;
    activityChart.data.datasets[1].data = settle;
    activityChart.update("none");
    return;
  }

  activityChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Verify requests",
          data: verify,
          borderColor: "#d4d4d8",
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          label: "Settlements",
          data: settle,
          borderColor: "#4ade80",
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#71717a", maxTicksLimit: 8, font: MONO_FONT } },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#71717a", precision: 0, font: MONO_FONT },
        },
      },
      plugins: {
        legend: { labels: { color: "#a1a1aa", font: MONO_FONT, boxWidth: 12 } },
      },
    },
  });
}

async function pollStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error(`stats ${res.status}`);
    const stats = await res.json();
    renderStats(stats);
    setLiveStatus(true);
  } catch (err) {
    console.error("stats poll failed", err);
    setLiveStatus(false);
  }
}

async function pollTimeseries() {
  const range = RANGES[activeRange] ?? RANGES["1d"];
  try {
    const res = await fetch(`${API_BASE}/stats/timeseries?hours=${range.hours}&bucket=${range.bucket}`);
    if (!res.ok) throw new Error(`timeseries ${res.status}`);
    const body = await res.json();
    renderActivityChart(body.points ?? [], body.bucket ?? range.bucket);
  } catch (err) {
    console.error("timeseries poll failed", err);
  }
}

function setActiveRange(key) {
  if (!RANGES[key] || key === activeRange) return;
  activeRange = key;
  setText("activity-range-label", `Verify and settlement requests, ${RANGES[key].label} — real timestamps, no simulated data.`);
  document.querySelectorAll("#activity-range-select [data-range]").forEach((btn) => {
    btn.classList.toggle("term-btn-active", btn.dataset.range === key);
  });
  pollTimeseries();
}

function initRangeSelector() {
  const container = document.getElementById("activity-range-select");
  if (!container) return;
  container.querySelectorAll("[data-range]").forEach((btn) => {
    if (btn.dataset.range === activeRange) btn.classList.add("term-btn-active");
    btn.addEventListener("click", () => setActiveRange(btn.dataset.range));
  });
}

function initScrollReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || items.length === 0) {
    items.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  items.forEach((el) => observer.observe(el));
}

function initYear() {
  setText("footer-year", String(new Date().getFullYear()));
}

document.addEventListener("DOMContentLoaded", () => {
  initScrollReveal();
  initYear();
  initRangeSelector();
  pollStats();
  pollTimeseries();
  setInterval(pollStats, STATS_POLL_MS);
  setInterval(pollTimeseries, TIMESERIES_POLL_MS);
});
