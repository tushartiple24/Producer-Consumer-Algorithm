#include "SharedResource.hpp"
#include <chrono>
#include <thread>

SharedResource::SharedResource(int tickets, bool synchronized, int raceWindowMs, EventLog& log)
    : initial_(tickets), synchronized_(synchronized), windowMs_(raceWindowMs),
      log_(log), available_(tickets) {}

PurchaseResult SharedResource::purchase(int workerId, int requestId) {
    if (synchronized_) {
        // MUTEX PROTECTION: the whole read -> check -> write sequence is one critical
        // section, so a second worker can only read after the first has written.
        std::lock_guard<std::mutex> lock(mutex_);
        return readCheckWrite(workerId, requestId);
    }
    // UNSYNCHRONIZED: two workers can both read the same value before either writes.
    return readCheckWrite(workerId, requestId);
}

PurchaseResult SharedResource::readCheckWrite(int workerId, int requestId) {
    const std::string who = "Worker " + std::to_string(workerId) + " (R" + std::to_string(requestId) + ")";

    const int observed = available_.load();                       // READ
    log_.log(who + " read tickets=" + std::to_string(observed));

    // Simulated database latency: the window in which another worker can interleave.
    std::this_thread::sleep_for(std::chrono::milliseconds(windowMs_));

    if (observed > 0) {                                           // CHECK (on a possibly stale value)
        const int soldNow = ++sold_;
        available_.store(observed - 1);                           // WRITE (lost update if stale)
        log_.log(who + " PURCHASED a ticket (tickets now " + std::to_string(observed - 1) + ")");
        if (soldNow > initial_) {
            ++races_;
            log_.log("RACE CONDITION DETECTED - " + std::to_string(soldNow) + " tickets sold but only " +
                     std::to_string(initial_) + " existed (unsynchronized shared-state access)");
        }
        return PurchaseResult::Purchased;
    }
    log_.log(who + " REJECTED - sold out (observed 0)");
    return PurchaseResult::SoldOut;
}
