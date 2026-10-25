// Rendering of the buffer, workers, semaphore state and live metrics.
const $ = id => document.getElementById(id);

// REQUEST BUFFER — rendered as a FIFO queue:
//   slot 1 (leftmost) = FRONT = the OLDEST request = the next one a worker takes.
//   New requests are always inserted at the BACK (rightmost occupied slot).
function renderBuffer(items, cap, waitingProducers) {
  const el = $("buffer");
  el.innerHTML = "";
  const visible = Math.min(cap, 10);
  el.style.gridTemplateColumns = `repeat(${visible}, 1fr)`;

  for (let i = 0; i < cap; i++) {
    const s = document.createElement("div");
    const r = items[i];
    s.className = "slot" + (r ? " filled" : "") + (r && r.method === "POST" ? " post" : "") + (r && r.isNew ? " is-new" : "");
    s.dataset.slot = i + 1;
    if (r) {
      s.innerHTML = `<em>${i === 0 ? "FRONT" : i === items.length - 1 ? "BACK" : ""}</em><b>R${r.id}</b><span>${r.method}</span>`;
      s.title = `Slot ${i + 1} · R${r.id} from Client ${r.client} · ${r.method} ${r.endpoint}` +
        (i === 0 ? " · FRONT: the next request a worker will remove" : "") +
        (i === items.length - 1 ? " · BACK: the most recently inserted request" : "");
    } else {
      s.innerHTML = `<em>free</em><b>·</b><span>—</span>`;
      s.title = `Slot ${i + 1} · free`;
    }
    el.appendChild(s);
  }
  if (cap > 10) {
    const more = document.createElement("div");
    more.className = "slot more";
    more.textContent = `+${cap - 10} more`;
    el.appendChild(more);
  }
  const label = `${items.length} / ${cap}`;
  $("bufferLabel").textContent = label;
  $("mBuffer").textContent = label;
  $("bufferCapLbl").textContent = cap;

  const banner = $("bufferBanner");
  if (items.length >= cap) {
    banner.hidden = false; banner.className = "banner full";
    banner.textContent = `BUFFER FULL — ${cap}/${cap}. ${waitingProducers ? waitingProducers + " producer client(s) are BLOCKED, waiting for a free slot." : "Additional producers would have to wait."}`;
  } else if (items.length === 0 && window.__running) {
    banner.hidden = false; banner.className = "banner empty";
    banner.textContent = "BUFFER EMPTY — consumer workers are BLOCKED, waiting for a request.";
  } else {
    banner.hidden = true;
  }

  // row of clients whose producers are blocked because the buffer was full
  const row = $("waitingRow");
  if (waitingProducers && waitingProducers.length) {
    row.innerHTML = `<span class="wrow-title">⏸ Blocked producers (buffer was full):</span>` +
      waitingProducers.map(id => `<span class="wchip">Client ${id}</span>`).join("");
    row.hidden = false;
  } else {
    row.innerHTML = ""; row.hidden = true;
  }
}

function renderWaitingClients(list) { /* folded into renderBuffer (waitingRow) */ }

function renderWorkers(workers) {
  const el = $("workersView");
  el.innerHTML = "";
  workers.forEach(w => {
    const d = document.createElement("div");
    const mutexSuffix = w.mutexWait ? " · ⏳ queue mutex" : "";
    d.className = "worker " + w.status.toLowerCase();
    const text = w.status === "PROCESSING" && w.request
      ? `PROCESSING R${w.request.id} — ${w.request.method} ${w.request.endpoint}${mutexSuffix}`
      : w.status === "WAITING" ? "WAITING — buffer empty, blocked on the full semaphore"
      : w.status === "DONE" ? "DONE — all work finished" : w.status;
    d.innerHTML = `<b>Worker ${w.id}</b><span>${text}</span><div class="bar"><i style="width:${w.progress || 0}%"></i></div>`;
    el.appendChild(d);
  });
}

function renderSems(empty, full, mutex, csHolder) {
  $("emptySem").textContent = empty;
  $("fullSem").textContent = full;
  const m = $("mutexState");
  m.textContent = csHolder ? `LOCKED · ${csHolder}` : mutex;
  m.className = mutex === "LOCKED" ? "locked" : "";
}

function renderMetrics(m) {
  $("mGenerated").textContent = m.generated;
  $("mProcessed").textContent = m.processed;
  $("mWaiting").textContent = m.waiting;
  $("mFull").textContent = m.full;
  $("mEmpty").textContent = m.empty;
}
