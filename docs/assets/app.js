// VAPOR live dashboard — polls the facilitator's public, unauthenticated
// /stats and /stats/timeseries endpoints. No fabricated numbers: every
// value rendered here is exactly what the API returned.

const API_BASE = "https://x402.duckdns.org";

const STATS_POLL_MS = 8000;
const TIMESERIES_POLL_MS = 30000;

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
    label.classList.add("text-emerald-400");
  } else {
    dot.classList.remove("bg-emerald-500", "live-dot");
    dot.classList.add("bg-rose-500");
    label.textContent = "RECONNECTING";
    label.classList.remove("text-emerald-400");
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

function renderRiskChart(riskBandCounts) {
  const canvas = document.getElementById("risk-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const order = ["low", "medium", "high", "severe"];
  const colors = { low: "#34d399", medium: "#fbbf24", high: "#fb923c", severe: "#fb7185" };
  const labels = order.filter((k) => riskBandCounts[k] !== undefined);
  const data = labels.map((k) => riskBandCounts[k]);

  if (labels.length === 0) {
    labels.push("no data yet");
    data.push(1);
  }

  const backgroundColor = labels[0] === "no data yet" ? ["#27272a"] : labels.map((l) => colors[l]);

  if (riskChart) {
    riskChart.data.labels = labels;
    riskChart.data.datasets[0].data = data;
    riskChart.data.datasets[0].backgroundColor = backgroundColor;
    riskChart.update("none");
    return;
  }

  riskChart = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor, borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#a1a1aa", font: { family: "Space Grotesk" }, boxWidth: 10, padding: 14 },
        },
      },
    },
  });
}

function renderActivityChart(points) {
  const canvas = document.getElementById("activity-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = points.map((p) =>
    new Date(p.bucket).toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
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

  const ctx = canvas.getContext("2d");
  const verifyGradient = ctx.createLinearGradient(0, 0, 0, 360);
  verifyGradient.addColorStop(0, "rgba(34, 211, 238, 0.35)");
  verifyGradient.addColorStop(1, "rgba(34, 211, 238, 0)");
  const settleGradient = ctx.createLinearGradient(0, 0, 0, 360);
  settleGradient.addColorStop(0, "rgba(167, 139, 250, 0.35)");
  settleGradient.addColorStop(1, "rgba(167, 139, 250, 0)");

  activityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Verify requests",
          data: verify,
          borderColor: "#22d3ee",
          backgroundColor: verifyGradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Settlements",
          data: settle,
          borderColor: "#a78bfa",
          backgroundColor: settleGradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#71717a", maxTicksLimit: 8 } },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#71717a", precision: 0 },
        },
      },
      plugins: {
        legend: { labels: { color: "#a1a1aa", font: { family: "Space Grotesk" } } },
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
  try {
    const res = await fetch(`${API_BASE}/stats/timeseries?hours=48`);
    if (!res.ok) throw new Error(`timeseries ${res.status}`);
    const body = await res.json();
    renderActivityChart(body.points ?? []);
  } catch (err) {
    console.error("timeseries poll failed", err);
  }
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
  pollStats();
  pollTimeseries();
  setInterval(pollStats, STATS_POLL_MS);
  setInterval(pollTimeseries, TIMESERIES_POLL_MS);
});
