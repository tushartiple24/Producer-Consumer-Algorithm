// Final statistics and charts. Every number is computed from recorded simulation events.
function renderStats(S, elapsedMs) {
  const st = S.stats, n = st.processed;
  const avgWait = n ? st.totalQueueWait / n : 0;
  const avgResp = n ? st.totalResponse / n : 0;
  const thr = elapsedMs > 0 ? n / (elapsedMs / 1000) : 0;
  const util = S.workers.map(w => elapsedMs > 0 ? 100 * w.busy / elapsedMs : 0);
  const avgUtil = util.reduce((a, b) => a + b, 0) / (util.length || 1);
  const items = [
    ["Total clients", S.cfg.clients], ["Total requests", st.generated], ["Processed requests", n],
    ["Rejected requests (HTTP 409)", st.rejected], ["Producer wait events", st.producerWaits],
    ["Consumer wait events", st.consumerWaits], ["Mutex wait events", st.mutexWaits || 0],
    ["Buffer full events", st.fullEvents], ["Buffer empty events", st.emptyEvents],
    ["Peak buffer usage", `${st.peak} / ${S.cfg.cap}`],
    ["Avg queue waiting time", avgWait.toFixed(0) + " ms"], ["Avg response time", avgResp.toFixed(0) + " ms"],
    ["Throughput", thr.toFixed(2) + " req/s"], ["Avg worker utilization", avgUtil.toFixed(0) + " %"],
    ["Tickets sold / stock", `${S.res.sold} / ${S.res.initial}`],
    ["Race-condition count", S.res.races + (S.res.races ? " ⚠" : "")],
  ];
  $("stats").innerHTML = items.map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join("");
  $("resultsNote").textContent = `${S.cfg.sync ? "Synchronized" : "Unsynchronized"} run · ${(elapsedMs / 1000).toFixed(2)} s server time`;

  $("utilChart").innerHTML = util.map((u, i) =>
    `<div class="bar-row"><span>Worker ${i + 1}</span><div class="bar-track"><i style="width:${Math.min(100, u).toFixed(1)}%"></i></div><em>${u.toFixed(0)}%</em></div>`).join("");

  const max = Math.max(1, ...S.records.map(r => r.wait));
  $("waitChart").innerHTML = S.records.slice().sort((a, b) => a.id - b.id).map(r =>
    `<div class="vbar" title="R${r.id}: waited ${r.wait.toFixed(0)} ms in queue"><i style="height:${Math.max(2, 100 * r.wait / max).toFixed(0)}%"></i><span>${r.id}</span></div>`).join("");
}

function clearStats() {
  $("stats").innerHTML = ""; $("utilChart").innerHTML = ""; $("waitChart").innerHTML = "";
  $("resultsNote").textContent = "Appears when a run completes";
}
