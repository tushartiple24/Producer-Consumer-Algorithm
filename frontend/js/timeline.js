// Server execution timeline: a Gantt-style time chart per worker, built from recorded segments.
// Time is SERVER TIME (the virtual clock), so blocks are proportional to real durations and line
// up across rows: reading down one column shows what every worker was doing at that instant.
function renderTimeline(S, workerCount) {
  const el = $("timeline");
  const scaleEl = $("timelineScale");
  el.innerHTML = "";   // rebuild from scratch (rows are re-appended below)
  const nRows = (S && S.workers) ? S.workers.length : workerCount;

  const workers = S ? S.workers : Array.from({ length: nRows }, (_, i) => ({ id: i + 1, segs: [] }));
  let T = 0;
  workers.forEach(w => (w.segs || []).forEach(s => { T = Math.max(T, s.end || 0); }));
  T = Math.max(T, S ? S.clock : 0);

  if (T <= 0) {
    el.innerHTML = '<span class="muted">No completed requests yet — run the simulation.</span>';
    scaleEl.innerHTML = "";
    return;
  }

  // shared time axis above the rows (percent-based, so it survives resizes)
  const ticks = [];
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * T;
    ticks.push(`<span style="left:${(i / 6 * 100).toFixed(2)}%">${(t / 1000).toFixed(1)}s</span>`);
  }
  scaleEl.innerHTML = ticks.join("");

  workers.forEach(w => {
    const row = document.createElement("div");
    row.className = "timeline-row";
    const cells = (w.segs || []).filter(s => s.end > s.start).map(s => {
      const blocked = s.request == null;
      const cls = blocked ? "blocked" : s.status === 409 ? "rejected" : s.status == null ? "running" : "done";
      const what = blocked ? (s.why === "mutex" ? "blocked: queue mutex" : "blocked: buffer empty") : `R${s.request} ${s.status === 409 ? "→ HTTP 409" : s.status == null ? "(processing…)" : "→ HTTP 200"}`;
      const title = `Worker ${w.id} · ${what} · ${(s.start / 1000).toFixed(2)}s → ${(s.end / 1000).toFixed(2)}s (${Math.round(s.end - s.start)} ms)`;
      return `<div class="timeline-cell ${cls}" style="left:${(s.start / T * 100).toFixed(2)}%;width:${((s.end - s.start) / T * 100).toFixed(2)}%" title="${title}">${blocked ? "" : "R" + s.request}</div>`;
    }).join("");
    row.innerHTML = `<span class="timeline-label">Worker ${w.id}</span><div class="timeline-track">${cells}</div>`;
    el.appendChild(row);
  });
}
