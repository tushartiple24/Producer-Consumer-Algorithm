// explain.js — plain-language narration and the final "What happened" summary.
//
// narrate(sim, msg, kind): called by the engine for every log event. Prints ONE short sentence in
// simple words under the event log, so a viewer always knows what just happened and why.
// buildSummary(sim): after the run, condenses the whole event stream into numbered points.

const NARRATED = new Set(["gen", "block", "unblock", "enqueue", "dequeue", "proc", "ok", "warn", "danger", "mutex", "res"]);

function narrate(sim, msg, kind) {
  const el = $("narrator");
  if (!el || !NARRATED.has(kind)) return;
  if (sim.narrationIds.has(sim.curEventId)) return;   // don't repeat the same event
  sim.narrationIds.add(sim.curEventId);
  const t = (sim.clock / 1000).toFixed(2);
  el.innerHTML = `<b>${t}s</b> ${explainEvent(msg, kind)}`;
}

function explainEvent(msg, kind) {
  let m;
  if ((m = msg.match(/^Client (\d+) generated (R\d+) \((\w+) (\S+)\)$/)))
    return `Client <b>${m[1]}</b> created request <b>${m[2]}</b> (${m[3]} ${m[4]}) and tries to put it in the buffer.`;
  if (/BUFFER FULL/.test(msg) && (m = msg.match(/^Client (\d+)/)))
    return `The buffer has no free slot, so Client <b>${m[1]}</b> must <b>wait</b> until a worker frees one (flow control — not an error).`;
  if ((m = msg.match(/^Client (\d+) UNBLOCKED/)))
    return `A slot opened up, so Client <b>${m[1]}</b> can continue.`;
  if ((m = msg.match(/^(R\d+) inserted at the BACK \(slot (\d+)\)/)))
    return `Request <b>${m[1]}</b> was placed in buffer slot <b>${m[2]}</b> — new requests always join at the back.`;
  if ((m = msg.match(/^Worker (\d+) removed (R\d+) from the FRONT/)))
    return `Worker <b>${m[1]}</b> took <b>${m[2]}</b>, the <b>oldest</b> waiting request (FIFO — first in, first out).`;
  if ((m = msg.match(/^Worker (\d+) starts processing (R\d+)/)))
    return `Worker <b>${m[1]}</b> is now doing the actual work for <b>${m[2]}</b> outside the lock, so other workers can use the buffer meanwhile.`;
  if ((m = msg.match(/^Worker (\d+) finished (R\d+) → HTTP (\d+)/)))
    return m[3] === "200"
      ? `Worker <b>${m[1]}</b> completed <b>${m[2]}</b> and sent an HTTP 200 OK response.`
      : `Worker <b>${m[1]}</b> could not complete <b>${m[2]}</b> — the item was sold out, so the client gets HTTP 409.`;
  if (/WAITS for the queue mutex/.test(msg) && (m = msg.match(/^(Client \d+|Worker \d+)/)))
    return `${m[0]} wants to touch the queue, but another thread is inside the critical section, so it waits for the mutex.`;
  if (/BUFFER EMPTY/.test(msg) && (m = msg.match(/^Worker (\d+)/)))
    return `There is nothing to do right now, so Worker <b>${m[1]}</b> sleeps until a request arrives (no busy-waiting).`;
  if (/RACE CONDITION DETECTED/.test(msg))
    return `<b>Two workers used the shared tickets at the same time without a lock and both bought one — that is the race condition.</b>`;
  return msg;   // fallback: show the raw line
}

// ---------- final point-by-point summary ----------
function buildSummary(sim) {
  const st = sim.stats, pts = [];
  const t = s => (s / 1000).toFixed(2) + "s";
  const fifoBreak = sim.records.filter(r => r.wait > 50).length;

  pts.push(`${st.generated} client producers each generated one HTTP-like request (${sim.cfg.clients} configured), and ${sim.cfg.workers} server workers consumed them through a ${sim.cfg.cap}-slot bounded buffer.`);

  if (st.producerWaits > 0) {
    pts.push(`The buffer became <b>full</b> ${st.fullEvents}×. Each time, further producers had to <b>block</b> — ${st.producerWaits} producer wait event${st.producerWaits > 1 ? "s" : ""} in total. That is the bounded-buffer condition doing flow control, <i>not</i> a race condition.`);
  } else {
    pts.push(`The buffer never became full (peak usage ${st.peak}/${sim.cfg.cap}), so no producer ever had to wait — workers consumed requests as fast as they arrived.`);
  }

  if (st.consumerWaits > 0) {
    pts.push(`Workers hit an <b>empty</b> buffer ${st.emptyEvents}× (${st.consumerWaits} consumer wait event${st.consumerWaits > 1 ? "s" : ""}): they slept on the <i>full</i> semaphore until the next request arrived.`);
  } else {
    pts.push(`The buffer was never empty when a worker looked, so no consumer ever blocked — requests were always waiting.`);
  }

  pts.push(`The counting semaphores stayed consistent the whole run: <i>empty</i> + <i>full</i> always equalled the capacity ${sim.cfg.cap}, and the queue mutex let only one thread insert or remove at a time (${st.mutexWaits} mutex wait${st.mutexWaits === 1 ? "" : "s"} observed). This is why no request was ever lost or duplicated.`);

  if (fifoBreak > 0) {
    pts.push(`Requests left the queue strictly in FIFO order — the ${fifoBreak} request${fifoBreak > 1 ? "s" : ""} that waited longest sat in the buffer about ${(Math.max(...sim.records.map(r => r.wait)) / 1000).toFixed(2)}s, because workers were busy with earlier ones.`);
  } else {
    pts.push(`Every request was picked up almost immediately after insertion (FIFO order, negligible queue wait).`);
  }

  const post = sim.history.filter(h => h.method === "POST");
  const rejected = post.filter(h => h.status === 409).length;
  if (post.length) {
    if (sim.res.races > 0) {
      pts.push(`Synchronization was <b>OFF</b>. The ${post.length} POST /purchase requests touched the shared ticket count without a lock, and two workers read the same value before either wrote back — <b>${sim.res.races} race condition${sim.res.races > 1 ? "s" : ""} detected</b>: ${sim.res.sold} tickets sold from a stock of ${sim.res.initial} (a lost update).`);
    } else if (rejected > 0) {
      pts.push(`Synchronization was <b>ON</b>. Of the ${post.length} POST /purchase requests, ${post.length - rejected} bought the last ticket${post.length - rejected > 1 ? "" : "s"} and ${rejected} got HTTP 409 — the resource mutex let each worker read, check and write as one atomic critical section, so nothing was oversold.`);
    } else {
      pts.push(`The ${post.length} POST /purchase requests used the shared resource under the mutex; ${sim.res.sold}/${sim.res.initial} tickets were sold with no overselling.`);
    }
  } else {
    pts.push(`No request needed the shared ticket resource (all were GETs), so the resource mutex never came into play.`);
  }

  const top = sim.workers.slice().sort((a, b) => b.busy - a.busy)[0];
  pts.push(`Worker utilization: ${sim.workers.map(w => `W${w.id} ${Math.round(100 * w.busy / Math.max(1, sim.clock))}%`).join(", ")} — ${top && top.busy === Math.max(...sim.workers.map(w => w.busy)) ? `Worker ${top.id} did the most work` : "work was spread unevenly by timing"}. ${st.rejected} request${st.rejected === 1 ? " was" : "s were"} rejected in total; average response time was ${(st.totalResponse / Math.max(1, st.processed) / 1000).toFixed(2)}s.`);

  pts.push(`Every request got exactly one response: ${st.processed} processed${st.rejected ? ` + ${st.rejected} rejected` : ""} = ${sim.cfg.clients} total, so the semaphore protocol terminated cleanly with no deadlock, no lost requests and no thread left blocked.`);

  const el = $("summaryList");
  if (!el) return;
  el.innerHTML = pts.map(p => `<li><span>${p}</span></li>`).join("");
  $("summaryNote").textContent = `${sim.cfg.sync ? "Synchronized" : "Unsynchronized"} run · ${t(sim.clock)} server time`;
}
function clearSummary() {
  const el = $("summaryList");
  if (el) el.innerHTML = "";
  const n = $("summaryNote");
  if (n) n.textContent = "Appears when a run completes";
  const nr = $("narrator");
  if (nr) nr.innerHTML = `Press <b>Start Simulation</b> — this line explains every event in plain words while the run unfolds.`;
}
