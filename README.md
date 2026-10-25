# SERVER//SYNC — Producer–Consumer & Synchronization Simulator

An Operating Systems lab simulator for concurrent web-server request processing.

```text
15 client producers → 10-slot bounded buffer → 3 server workers → shared resource → HTTP response
```

## Project layout

```text
Server-Sync-Simulator/
├── frontend/            browser visualizer (HTML + CSS + JS, no build step)
│   ├── index.html
│   ├── css/style.css
│   └── js/  app.js (engine + controller) · visualization.js · timeline.js · charts.js
├── simulator/           native C++17 implementation (authoritative OS demonstration)
│   ├── include/  Config · Semaphore · EventLog · Request · BoundedBuffer · SharedResource
│   │             Statistics · SimContext · Producer · Consumer · Server  (.hpp)
│   ├── src/      matching .cpp files + main.cpp
│   ├── tests/check.sh · check.ps1   automated checks (Linux / Windows)
│   ├── Makefile · CMakeLists.txt
├── assets/architecture.txt
├── Makefile · CMakeLists.txt     (delegate to simulator/)
└── PROMPT_FOR_OTHER_AI.md        original specification
```

The browser UI and the C++ program are independent. The C++ program uses real OS threads. The browser version re-implements the same model (same semaphores, mutexes, request mix and statistics) so it can be animated.

## Build and run the C++ simulator — Windows (PowerShell)

Windows has no `make`, and PowerShell 5 does not accept `&&` (use `;` or separate lines). Pick **one** option:

**A. g++ (MSYS2 / WinLibs / MinGW-w64)** — check with `g++ --version`; install from https://www.msys2.org (then `pacman -S mingw-w64-ucrt-x86_64-gcc`) or https://winlibs.com and add it to PATH.

```powershell
cd simulator
.\build.ps1 -Test           # build + run the automated checks
# or manually:
g++ -std=c++17 -O2 -pthread -Iinclude (Get-ChildItem src\*.cpp).FullName -o server_sync.exe
.\server_sync.exe
.\server_sync.exe --race
```

**B. Visual Studio / Build Tools + CMake** (open "x64 Native Tools Command Prompt" or any shell with `cmake` and MSVC):

```powershell
cmake -S . -B build
cmake --build build --config Release
.\build\simulator\Release\server_sync.exe
.\tests\check.ps1 -Exe .\build\simulator\Release\server_sync.exe   # run from the simulator folder
```

**C. WSL** (Ubuntu): `sudo apt install g++ make`, then use the Linux commands below inside the project folder.

## Build and run the C++ simulator (Linux / WSL / macOS)

```bash
cd simulator
make              # or: g++ -std=c++17 -pthread -Iinclude src/*.cpp -o server_sync
./server_sync     # default: 15 clients, 10 slots, 3 workers, mutex ON
```

With CMake:

```bash
cmake -S . -B build && cmake --build build && ./build/simulator/server_sync   # from the project root
```

Command line:

```text
./server_sync [clients capacity workers sync processingMs arrivalDelayMs tickets]
./server_sync --race        # deterministic race-condition experiment (both modes)
```

| Example | What it shows |
|---|---|
| `./server_sync` | default scenario, synchronized |
| `./server_sync 15 10 3 0` | unsynchronized: overselling (race) is detected |
| `./server_sync --race` | two workers buy the last ticket: unsafe vs safe |
| `./server_sync 15 1 3` | tiny buffer: many producer blocks |
| `./server_sync 15 10 1 1 400` | one slow worker: buffer fills and stays full |

## Frontend

Open `frontend/index.html` in a browser (or serve the folder with any static server).
Pages: **Overview · Simulation · Race Condition · Theory**, with a dark-mode toggle. Use **Start Simulation**, **Reset** and **Load Default Scenario**; all configuration fields affect the run.

## How synchronization works

| Primitive | Initial value | Role |
|---|---|---|
| `empty` semaphore | capacity (10) | counts free slots; producers `wait(empty)` and block when the buffer is full |
| `full` semaphore | 0 | counts queued requests; consumers `wait(full)` and block when it is empty |
| queue mutex | unlocked | only one thread at a time may insert or remove from the queue |
| resource mutex | unlocked | protects the ticket read–check–write sequence (safe mode only) |

Producer: `wait(empty)` → lock → insert → unlock → `signal(full)`.
Consumer: `wait(full)` → lock → remove → unlock → `signal(empty)` → process → use shared resource → respond.
All blocking uses condition variables inside `Semaphore`; there is no busy-waiting.

**Termination:** each worker first *claims* one of the `clients` requests that will ever exist, then consumes. Exactly that many consume calls happen, so no worker is left blocked forever after the last request.

## Race condition vs. buffer full

- **Buffer full** (all 10 slots occupied): the extra producers block until a slot is freed. This is normal flow control, *not* a race condition.
- **Race condition**: two workers read the ticket count (1) before either writes it back, so both purchase. It happens only in unsynchronized mode, when concurrent workers access shared application state without a lock. With the mutex only one purchase succeeds and the other request gets HTTP 409.

In the full simulation the race depends on timing (R1 and R2 are both `POST /purchase`, so they overlap when two workers pick them up together). `--race` and the frontend's Race Condition page start both workers at the same instant, so the outcome is reproducible.

## Statistics (all measured, none hard-coded)

Processed and rejected requests, producer/consumer wait events, buffer full/empty events, peak buffer usage, average queue waiting time, average response time, throughput, per-worker utilization, tickets sold vs. stock, and race-condition count. The C++ program also prints a per-worker timeline.

## Tests / demo checklist

```bash
cd simulator && make test      # Linux/WSL/macOS: 13 automated checks
```
```powershell
cd simulator; .\tests\check.ps1   # Windows PowerShell (after building server_sync.exe)
```

The checks cover: 15/15 processed with no hang, buffer reaching 10/10, producer and consumer blocking, no race with the mutex, race detected without it, `--race`, several configurations, and input validation. Also verified with ThreadSanitizer (`-fsanitize=thread`): no reports in synchronized mode.

For the frontend: click **Run default scenario** and watch the BUFFER FULL banner, blocked clients in the log, worker progress bars and the timeline; then switch Synchronization to OFF and run again to see the race count; finally use the **Race Condition** buttons.

## Terminology

- Producer = client thread; produced item = request.
- Buffer = bounded server request queue; consumer = server worker thread.
- Full buffer = all slots occupied, producers wait. Empty buffer = no pending requests, consumers wait.
- Race condition = unsynchronized concurrent access to shared application state.
