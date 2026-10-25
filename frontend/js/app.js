// Simulation engine + controller.
// The engine mirrors simulator/ (C++): empty/full counting semaphores, a queue mutex and a
// separate resource mutex. Blocking is event-driven (waiters are queued and woken), not polling.
//
// Everything runs on a VIRTUAL clock so the run can be paused, resumed, speeded up (0.25×–16×)
// or advanced one event at a time. Rendering and logs are driven by the same event stream.
const CRITICAL_SECTION_MS = 8;      // time spent holding the queue mutex (so LOCKED is visible)
const RACE_WINDOW_MS = 150;         // read -> write latency on the shared resource
const DEFAULTS = { clients: 15, capacity: 10, workers: 3, processing: 600, arrival: 30, tickets: 1, sync: "safe" };

class Semaphore {
  constructor(n) { this.n = n; this.waiters = []; }
  tryAcquire() { if (this.n > 0) { this.n--; return true; } return false; }
  // acquire(sim) — a blocked waiter is also woken when the simulation is killed (reset),
  // so no thread is ever left hanging on a dead run.
  acquire(sim) {
    if (this.tryAcquire()) return Promise.resolve();
    return new Promise(resolve => {
      this.waiters.push(resolve);
      sim.abort.promise.then(() => {
        const i = this.waiters.indexOf(resolve);
        if (i !== -1) { this.waiters.splice(i, 1); resolve(); }
      });
    });
  }
  release() { const w = this.waiters.shift(); if (w) w(); else this.n++; } // hand the unit to a waiter
}

function makeAbort() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }

// ---------- virtual clock ----------
// sim.clock is simulated MILLISECONDS of server time. It advances by a fixed quantum
// (TICK_MS × speed) per interval tick — never by wall-time deltas. Pausing freezes it.
const TICK_MS = 40;
// Heartbeat that survives background-tab timer throttling: a tiny Worker keeps ticking even
// when the page is hidden or occluded (page timers would be slowed to ~1 Hz).
// Server-time quantum per tick adapts to speed: fine resolution (10ms) at 1× for faithful
// stats, coarser (≈4ms·speed) at high speeds where the tick rate hits the browser floor.
const tickQ = sim => Math.max(10, Math.round(4.2 * sim.speed));
function makeTicker(onTick, delayMs) {
  try {
    const src = `let id=null;const go=d=>{clearInterval(id);id=setInterval(()=>postMessage(0),d)};onmessage=e=>{e.data==='stop'?clearInterval(id):go(e.data)};`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
    w.onmessage = onTick;
    w.postMessage(delayMs);
    return { rate: d => w.postMessage(d), stop: () => w.postMessage("stop"), kill: () => w.terminate(), worker: true };
  } catch (e) {                          // Worker/Blob unavailable (e.g. strict CSP): fall back
    let id = setInterval(onTick, delayMs);
    return { rate: d => { clearInterval(id); id = setInterval(onTick, d); }, stop: () => {}, kill: () => clearInterval(id), worker: false };
  }
}
function applyTickerRate(sim) {
  sim.tickQ = tickQ(sim);
  if (sim.ticker) sim.ticker.rate(Math.max(4, Math.round(sim.tickQ / sim.speed)));
}
function startClock(sim, onFrame) {
  sim.paused = false;
  const frame = () => {
    if (sim.dead || sim.done) return;
    if (!sim.paused) {
      sim.clock += sim.tickQ;
      // fire every virtual timer whose deadline has passed, in deadline order (catch-up)
      sim.vmTimers.sort((a, b) => a.fire - b.fire);
      while (sim.vmTimers.length && sim.vmTimers[0].fire <= sim.clock) {
        const t = sim.vmTimers.shift();
        if (t.cancelled) continue;
        t.cancelled = true;
        t.wake();
      }
      if (onFrame) onFrame(sim);
    }
  };
  sim.ticker = makeTicker(frame, 10);
  applyTickerRate(sim);
}
function pauseClock(sim) {
  if (sim.paused) return;
  sim.paused = true;                                      // clock is frozen exactly here
  sim.vmTimers.forEach(t => { if (t.fire <= sim.clock) { t.cancelled = true; t.wake(); } }); // timers already due fire now
  sim.vmTimers = sim.vmTimers.filter(t => !t.cancelled);
  if (sim.ticker) sim.ticker.stop();
}
function resumeClock(sim) {
  if (!sim.paused) return;
  sim.paused = false;
  applyTickerRate(sim);
}
function stopClock(sim) {
  pauseClock(sim);
  if (sim.ticker) { sim.ticker.kill(); sim.ticker = null; }
}
// one virtual sleep — resolves after `ms` simulated ms (also resolves immediately on reset/abort)
function sleep(sim, ms) {
  return new Promise(resolve => {
    const entry = { fire: sim.clock + ms, wake: resolve, cancelled: false };
    sim.vmTimers.push(entry);
    sim.abort.promise.then(() => { if (!entry.cancelled) { entry.cancelled = true; resolve(); } });
  });
}

let S = null;      // current simulation state

function makeRequest(id) {
  const k = id % 5;   // same request mix as the C++ engine
  const [method, endpoint] = k === 1 || k === 2 ? ["POST", "/purchase"] : k === 3 ? ["GET", "/profile"] : ["GET", "/data"];
  return { id, client: id, method, endpoint };
}
const fmtSec = ms => (ms / 1000).toFixed(1) + "s";
const fmtStamp = ms => (ms / 1000).toFixed(3).padStart(6, "0");

// The single event stream: log text, live narrator and the step controller all read from it.
function log(sim, msg, kind = "info") {
  if (sim.dead) return;
  sim.curEventId = ++sim.evSeq;
  sim.events.push({ id: sim.curEventId, t: sim.clock, msg, kind });
  const el = $("log");
  el.textContent += `[${fmtStamp(sim.clock)}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
  narrate(sim, msg, kind);   // defined in explain.js (safe no-op if absent)
}

// ---------- shared application resource (used by the simulation AND the race page) ----------
// sim = { res, cfg:{sync,window}, resMutex, log(msg,kind), event?(wid,type,data), dead, ...clock }
async function purchase(sim, wid, rid) {
  const who = `Worker ${wid} (R${rid})`;
  const criticalSection = async () => {
    const observed = sim.res.available;                                   // READ
    sim.log(`${who} READ tickets=${observed}`, "res");
    sim.event && sim.event(wid, "read", observed);
    await sleep(sim, sim.cfg.window);                                     // latency window
    if (sim.dead) return "DEAD";
    if (observed > 0) {                                                   // CHECK (maybe stale)
      sim.res.sold++;
      sim.res.available = observed - 1;                                   // WRITE (lost update if stale)
      sim.log(`${who} PURCHASED a ticket (tickets now ${observed - 1})`, "res");
      sim.event && sim.event(wid, "purchased", observed - 1);
      if (sim.res.sold > sim.res.initial) {
        sim.res.races++;
        sim.log(`RACE CONDITION DETECTED — ${sim.res.sold} tickets sold but only ${sim.res.initial} existed (unsynchronized shared-state access)`, "danger");
      }
      return "OK";
    }
    sim.log(`${who} REJECTED — sold out (observed 0)`, "res");
    sim.event && sim.event(wid, "rejected", 0);
    return "SOLD_OUT";
  };
  if (!sim.cfg.sync) return criticalSection();            // no lock: both workers can read before either writes
  if (!sim.resMutex.tryAcquire()) {                       // mutex held by another worker: block
    sim.event && sim.event(wid, "blocked");
    sim.log(`${who} BLOCKED — waiting for the resource mutex`, "mutex");
    await sim.resMutex.acquire(sim);
    if (sim.dead) return "DEAD";
  }
  try { return await criticalSection(); } finally { sim.resMutex.release(); }
}

// ---------- rendering ----------
function mutexLabel(S) { return S.qMutex.n > 0 ? "UNLOCKED" : "LOCKED"; }
function renderMutex(S) { renderSems(S.empty.n, S.full.n, mutexLabel(S), S.csHolder); }
function render(S) {
  if (!S || S.dead) return;
  renderBuffer(S.buffer, S.cfg.cap, S.waitingClients.length);
  renderMutex(S);
  renderMetrics({ generated: S.stats.generated, processed: S.stats.processed, waiting: S.waitingClients.length, full: S.stats.fullEvents, empty: S.stats.emptyEvents });
  renderWorkers(S.workers);
  renderWaitingClients(S.waitingClients);
}

// ---------- configuration ----------
function readConfig() {
  const clamp = (id, lo, hi) => {
    const input = $(id); let v = parseInt(input.value, 10);
    if (Number.isNaN(v)) v = DEFAULTS[id] ?? lo;
    const c = Math.min(hi, Math.max(lo, v));
    if (c !== v || input.value === "") { input.value = c; $("cfgHint").textContent = `Value adjusted to the allowed range (${lo}–${hi}).`; }
    return c;
  };
  $("cfgHint").textContent = "";
  return {
    clients: clamp("clients", 1, 100), cap: clamp("capacity", 1, 20), workers: clamp("workers", 1, 10),
    processing: clamp("processing", 50, 3000), arrival: clamp("arrival", 0, 1000), tickets: clamp("tickets", 0, 20),
    sync: $("syncMode").value === "safe", window: RACE_WINDOW_MS,
  };
}
function loadDefault() {
  $("clients").value = DEFAULTS.clients; $("capacity").value = DEFAULTS.capacity; $("workers").value = DEFAULTS.workers;
  $("processing").value = DEFAULTS.processing; $("arrival").value = DEFAULTS.arrival; $("tickets").value = DEFAULTS.tickets;
  $("syncMode").value = DEFAULTS.sync;
  reset();
}

// ---------- reset ----------
function reset() {
  if (S) { S.dead = true; if (S.abort) S.abort.resolve(); stopClock(S); }   // stops every in-flight async thread
  S = null; window.__running = false;
  const cap = parseInt($("capacity").value, 10) || DEFAULTS.capacity;
  const w = parseInt($("workers").value, 10) || DEFAULTS.workers;
  setControls("idle");
  $("statusPill").textContent = "IDLE";
  $("log").textContent = "";
  $("simTime").textContent = "0.0s";
  renderMetrics({ generated: 0, processed: 0, waiting: 0, full: 0, empty: 0 });
  renderBuffer([], cap, 0);
  renderWorkers(Array.from({ length: w }, (_, i) => ({ id: i + 1, status: "IDLE", progress: 0 })));
  renderWaitingClients([]);
  renderSems(cap, 0, "UNLOCKED", null);
  renderTimeline({ clock: 0, workers: [] }, w);
  clearStats();
  clearSummary();
}

// ---------- threads ----------
function setWorkerMutexWait(S, reqId, on) {
  const w = S.workers.find(x => x.request && x.request.id === reqId);
  if (w) { w.mutexWait = on; renderWorkers(S.workers); }
}

// Queue mutex acquire, with narration. who = "Client 3" | "Worker 2", reqId optional (worker case).
async function lockQueue(S, who, reqId) {
  if (!S.qMutex.tryAcquire()) {
    S.stats.mutexWaits++;
    log(S, `${who} WAITS for the queue mutex (held by ${S.csHolder || "another thread"}) — only one thread may touch the queue at a time`, "mutex");
    if (reqId != null) setWorkerMutexWait(S, reqId, true);
    renderMutex(S);
    await S.qMutex.acquire(S);
    if (S.dead) return false;
    if (reqId != null) setWorkerMutexWait(S, reqId, false);
    log(S, `${who} got the queue mutex`, "mutex");
  }
  S.csHolder = who;
  renderMutex(S);
  await sleep(S, CRITICAL_SECTION_MS);
  return !S.dead;
}
function unlockQueue(S) { S.csHolder = null; S.qMutex.release(); renderMutex(S); }

async function producer(S, id) {
  await sleep(S, (id - 1) * S.cfg.arrival);
  if (S.dead) return;
  const r = makeRequest(id);
  r.created = S.clock;
  S.produced++; S.stats.generated = S.produced;
  log(S, `Client ${id} generated R${id} (${r.method} ${r.endpoint})`, "gen");
  r.isNew = true; render(S);
  setTimeout(() => { r.isNew = false; }, 900);   // cosmetic "NEW" tag

  // wait(empty): block while the buffer is full
  if (!S.empty.tryAcquire()) {
    S.stats.producerWaits++; S.waitingClients.push(id);
    log(S, `Client ${id}: BUFFER FULL — no free slot, so Client ${id} BLOCKS and waits`, "block");
    render(S);
    await S.empty.acquire(S);
    if (S.dead) return;
    const wi = S.waitingClients.indexOf(id); if (wi !== -1) S.waitingClients.splice(wi, 1);
    log(S, `Client ${id} UNBLOCKED — a consumer freed a slot`, "unblock");
  }
  // PRODUCER CRITICAL SECTION (queue mutex)
  if (!(await lockQueue(S, `Client ${id}`))) return;
  r.enqueued = S.clock;
  S.buffer.push(r);                                        // FIFO: insert at the BACK
  S.stats.peak = Math.max(S.stats.peak, S.buffer.length);
  const nowFull = S.buffer.length === S.cfg.cap;
  if (nowFull) S.stats.fullEvents++;
  unlockQueue(S);
  S.full.release();                                        // signal(full)
  log(S, `R${id} inserted at the BACK (slot ${S.buffer.length}) — buffer ${S.buffer.length}/${S.cfg.cap} [empty=${S.empty.n} full=${S.full.n}]`, "enqueue");
  if (nowFull) log(S, `Buffer is FULL (${S.cfg.cap}/${S.cfg.cap}) — further producers must wait`, "warn");
  render(S);
}

async function consumer(S, w) {
  // Each worker claims one of the `clients` requests before waiting, so exactly that many
  // consume operations happen and nobody stays blocked after the last request (no deadlock).
  while (!S.dead && S.claimed < S.cfg.clients) {
    S.claimed++;
    if (!S.full.tryAcquire()) {                             // wait(full): block while the buffer is empty
      S.stats.consumerWaits++;
      w.status = "WAITING"; w.request = null; w.progress = 0;
      log(S, `Worker ${w.id}: BUFFER EMPTY — nothing to process, Worker ${w.id} BLOCKS`, "block");
      render(S);
      await S.full.acquire(S);
      if (S.dead) return;
      log(S, `Worker ${w.id} UNBLOCKED — a request arrived in the buffer`, "unblock");
    }
    // CONSUMER CRITICAL SECTION (queue mutex)
    if (!(await lockQueue(S, `Worker ${w.id}`, /*reqId*/ null))) return;
    const r = S.buffer.shift();                             // FIFO: remove from the FRONT (oldest first)
    r.dequeued = S.clock;
    if (S.buffer.length === 0) S.stats.emptyEvents++;
    unlockQueue(S);
    S.empty.release();                                      // signal(empty)
    log(S, `Worker ${w.id} removed R${r.id} from the FRONT (oldest request) — ${S.buffer.length} left in buffer [empty=${S.empty.n} full=${S.full.n}]`, "dequeue");

    const start = S.clock;
    w.status = "PROCESSING"; w.request = r; w.progress = 0; w.segStart = S.clock;
    log(S, `Worker ${w.id} starts processing R${r.id} (${r.method} ${r.endpoint}) — about ${S.cfg.processing} ms of work`, "proc");
    render(S);

    let status = 200;
    if (r.method === "POST") {
      const res = await purchase(S, w.id, r.id);
      if (S.dead) return;
      if (res === "SOLD_OUT") { status = 409; S.stats.rejected++; }
    }
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await sleep(S, S.cfg.processing / steps);
      if (S.dead) return;
      w.progress = i * 100 / steps;
      renderWorkers(S.workers);
    }
    w.segs.push({ start: w.segStart, end: S.clock, request: r.id, status });   // for the time-based Gantt
    w.busy += S.clock - start;
    S.stats.processed++;
    S.stats.totalQueueWait += r.dequeued - r.enqueued;
    S.stats.totalResponse += S.clock - r.created;
    S.records.push({ id: r.id, wait: r.dequeued - r.enqueued });
    S.history.push({ worker: w.id, request: r.id, method: r.method, endpoint: r.endpoint, status });
    w.status = "IDLE"; w.request = null; w.progress = 0;
    log(S, `Worker ${w.id} finished R${r.id} → HTTP ${status} ${status === 200 ? "OK" : "Conflict (sold out)"} response sent`, status === 200 ? "ok" : "warn");
    renderTimeline(S, S.cfg.workers);
    render(S);
  }
  if (!S.dead) { w.status = "DONE"; render(S); }
}

// ---------- controls (pause / resume / speed / step) ----------
function setControls(state) {
  // state: idle | running | paused | stepping | done
  const active = state !== "idle" && state !== "done";
  $("pauseBtn").textContent = (state === "paused" || state === "stepping") ? "▶ Resume" : "⏸ Pause";
  $("pauseBtn").disabled = !active;
  $("stepBtn").disabled = !active;
  $("speedRange").disabled = state === "idle";
  if (state === "idle") { $("speedRange").value = 1; $("speedVal").textContent = "1×"; }
  $("runBtn").textContent = state === "idle" ? "Start Simulation" : "Restart";
}
function freezeProcessingSeg(S) {
  // close the running worker's timeline segment at the current instant so the Gantt stays exact
  const w = S.workers.find(x => x.status === "PROCESSING" && x.request);
  if (w) {
    if (!w.segs.length || w.segs[w.segs.length - 1].end !== S.clock || w.segs[w.segs.length - 1].request !== w.request.id)
      w.segs.push({ start: w.segStart, end: S.clock, request: w.request.id, status: null });
    w.segStart = S.clock;
  }
}
function pauseSim(S) {
  freezeProcessingSeg(S);
  pauseClock(S);
  if (!S.dead && !S.done) {
    $("statusPill").textContent = "PAUSED";
    setControls("paused");
  }
  renderTimeline(S, S.cfg.workers);
}
function resumeSim(S) {
  resumeClock(S);
  const w = S.workers.find(x => x.status === "PROCESSING");
  if (w) w.segStart = S.clock;
  setControls("running");
  $("statusPill").textContent = S.cfg.sync ? "SYNCHRONIZED · RUNNING" : "UNSYNCHRONIZED · RUNNING";
}

// STEP: advance exactly one event instant. We jump the clock straight to the earliest
// scheduled wake, synchronously fire every timer due at that instant (and only those), let
// the woken threads emit their events (microtasks), then freeze again. No interval frames
// are involved, so one Step can never overshoot.
function stepOnce(sim) {
  const pending = sim.vmTimers.filter(t => !t.cancelled);
  if (!pending.length) { finish(sim); return; }        // nothing left that can ever wake
  sim.clock = Math.max(sim.clock, Math.min(...pending.map(t => t.fire)));
  sim.paused = true;                                   // clock stays frozen at this instant
  sim.vmTimers.sort((a, b) => a.fire - b.fire);
  while (sim.vmTimers.length && sim.vmTimers[0].fire <= sim.clock) {
    const t = sim.vmTimers.shift();
    if (t.cancelled) continue;
    t.cancelled = true;
    t.wake();
  }
  $("simTime").textContent = fmtSec(sim.clock);
  setControls("stepping");
  // microtasks of the woken threads run before this callback, so all events of this
  // instant are already narrated/logged when we settle the UI
  setTimeout(() => {
    if (sim.dead || sim.done) return;
    pauseSim(sim);
  }, 0);
}

async function run() {
  reset();
  const cfg = readConfig();
  const sim = {
    cfg, dead: false, done: false, paused: false, speed: 1, clock: 0,
    raf: null, vmTimers: [], abort: makeAbort(),
    buffer: [], waitingClients: [], claimed: 0, produced: 0,
    empty: new Semaphore(cfg.cap), full: new Semaphore(0), qMutex: new Semaphore(1), resMutex: new Semaphore(1),
    res: { available: cfg.tickets, sold: 0, initial: cfg.tickets, races: 0 },
    stats: { generated: 0, processed: 0, rejected: 0, producerWaits: 0, consumerWaits: 0, mutexWaits: 0, fullEvents: 0, emptyEvents: 0, peak: 0, totalQueueWait: 0, totalResponse: 0 },
    workers: Array.from({ length: cfg.workers }, (_, i) => ({ id: i + 1, status: "IDLE", request: null, progress: 0, busy: 0, segs: [], segStart: 0, mutexWait: false })),
    history: [], records: [], events: [], evSeq: 0, csHolder: null,
    narrationIds: new Set(),
  };
  sim.log = (msg, kind) => log(sim, msg, kind);
  S = sim; window.__running = true;
  setControls("running");
  renderTimeline(sim, cfg.workers);
  $("statusPill").textContent = cfg.sync ? "SYNCHRONIZED · RUNNING" : "UNSYNCHRONIZED · RUNNING";
  log(sim, `Server started — ${cfg.clients} producers, buffer ${cfg.cap}, ${cfg.workers} consumers, synchronization ${cfg.sync ? "ON" : "OFF"}`, "ok");
  render(sim);

  startClock(sim, s => {
    $("simTime").textContent = fmtSec(s.clock);
    if (s.workers.some(w => w.status === "PROCESSING")) renderWorkers(s.workers);   // progress bars animate
  });

  const consumers = sim.workers.map(w => consumer(sim, w));
  const producers = Array.from({ length: cfg.clients }, (_, i) => producer(sim, i + 1));
  await Promise.all([...producers, ...consumers]);
  finish(sim);
}

function finish(sim) {
  if (sim.dead || sim.done) return;
  sim.done = true;
  stopClock(sim);
  window.__running = false;
  setControls("done");
  $("simTime").textContent = fmtSec(sim.clock);
  $("statusPill").textContent = "COMPLETE";
  log(sim, `Simulation complete — ${sim.stats.processed}/${sim.cfg.clients} requests processed in ${fmtSec(sim.clock)} of server time` + (sim.res.races ? ` — ${sim.res.races} RACE CONDITION(S) DETECTED` : ""), sim.res.races ? "danger" : "ok");
  render(sim);
  renderTimeline(sim, sim.cfg.workers);
  renderStats(sim, sim.clock);
  buildSummary(sim);   // point-by-point "what happened" (explain.js)
}

// ---------- race-condition page ----------
let raceBusy = false;
async function race(safe) {
  if (raceBusy) return;
  raceBusy = true;
  const ctx = {
    res: { available: 1, sold: 0, initial: 1, races: 0 }, cfg: { sync: safe, window: 900 },
    resMutex: new Semaphore(1), dead: false, done: false, paused: false, speed: 1, clock: 0,
    vmTimers: [], abort: makeAbort(), lines: [],
    log(msg) { this.lines.push(`[${fmtStamp(this.clock)}] ${msg}`); $("raceTrace").textContent = this.lines.join("\n"); },
    event(w, type, v) {
      const el = $("raceW" + w);
      if (type === "read") el.textContent = `READ = ${v}`;
      if (type === "blocked") el.textContent = "BLOCKED — waiting for mutex";
      if (type === "purchased") { el.textContent = "PURCHASED"; $("ticketValue").textContent = v; }
      if (type === "rejected") el.textContent = "REJECTED (observed 0)";
      $("soldValue").textContent = `Tickets sold: ${ctx.res.sold}`;
    },
  };
  // run the race experiment in real time (it is short and self-contained): a ticker advances
  // the wall clock AND fires the due virtual timers that purchase() schedules via sleep()
  ctx.ticker = makeTicker(() => {
    if (ctx.dead) return;
    ctx.clock = performance.now() - ctx.t0;
    ctx.vmTimers.sort((a, b) => a.fire - b.fire);
    while (ctx.vmTimers.length && ctx.vmTimers[0].fire <= ctx.clock) {
      const t = ctx.vmTimers.shift();
      if (t.cancelled) continue;
      t.cancelled = true;
      t.wake();
    }
  }, 40);
  $("ticketValue").textContent = "1"; $("soldValue").textContent = "Tickets sold: 0";
  $("raceW1").textContent = "READING…"; $("raceW2").textContent = "READING…";
  $("raceTrace").textContent = "";
  $("raceResult").className = "race-result";
  $("raceResult").textContent = safe ? "Running with mutex…" : "Running without mutex…";
  $("raceUnsafe").disabled = $("raceSafe").disabled = true;

  await Promise.all([purchase(ctx, 1, 1), purchase(ctx, 2, 2)]);   // two workers start at the same instant
  ctx.dead = true; ctx.ticker.kill();

  $("soldValue").textContent = `Tickets sold: ${ctx.res.sold} (stock was 1)`;
  const res = $("raceResult");
  if (ctx.res.races > 0) {
    res.className = "race-result bad";
    res.textContent = `⚠ RACE CONDITION DETECTED — both workers read the same stale value (1) and both completed the purchase: ${ctx.res.sold} tickets sold from a stock of 1.`;
  } else {
    res.className = "race-result good";
    res.textContent = `✓ RACE CONDITION PREVENTED — the mutex serialized the critical section: ${ctx.res.sold} purchase succeeded and the second worker observed 0 and was rejected.`;
  }
  $("raceUnsafe").disabled = $("raceSafe").disabled = false;
  raceBusy = false;
}

// ---------- wiring ----------
$("runBtn").onclick = run;
$("pauseBtn").onclick = () => { if (!S || S.dead || S.done) return; S.paused ? resumeSim(S) : pauseSim(S); };
$("stepBtn").onclick = () => {
  if (!S || S.dead || S.done) return;
  if (!S.paused) pauseSim(S);                          // stepping always happens while paused
  stepOnce(S);
};
$("speedRange").oninput = e => {
  const v = parseFloat(e.target.value);
  $("speedVal").textContent = v + "×";
  if (S && !S.dead && !S.done) { S.speed = v; if (!S.paused) applyTickerRate(S); }   // live rate change; a frozen clock stays frozen
};
$("heroStart").onclick = () => { loadDefault(); location.hash = "#simulation"; run(); };
$("resetBtn").onclick = reset;
$("defaultBtn").onclick = loadDefault;
$("raceUnsafe").onclick = () => race(false);
$("raceSafe").onclick = () => race(true);
$("clearLog").onclick = () => { $("log").textContent = ""; };
$("themeBtn").onclick = () => {
  const dark = document.body.classList.toggle("dark");
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) { /* storage unavailable */ }
};
["capacity", "workers"].forEach(id => $(id).addEventListener("change", () => { if (!window.__running) reset(); }));
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch (e) { /* ignore */ }
  if (t ? t === "dark" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) document.body.classList.add("dark");
})();
reset();
