#include "Consumer.hpp"
#include <chrono>
#include <thread>

void Consumer::operator()() {
    const std::string who = "Worker " + std::to_string(workerId_);

    // Each iteration first *claims* one of the cfg.clients requests that will ever exist.
    // Exactly that many consume() calls happen in total, so no worker is left blocked
    // forever on an empty buffer after the last request has been taken (no deadlock).
    while (ctx_.claimed.fetch_add(1) < ctx_.cfg.clients) {
        bool waited = false;
        // wait(full) -> lock(mutex) -> remove -> unlock(mutex) -> signal(empty)
        Request r = ctx_.buffer.consume(waited, [&] {
            ++ctx_.stats.consumerWaits;
            ctx_.log.log("BUFFER EMPTY - " + who + " waiting for a request");
        });
        const auto start = SimClock::now();
        ctx_.log.log(who + " consumed " + r.label() + "  [empty=" + std::to_string(ctx_.buffer.freeSlots()) +
                     " full=" + std::to_string(ctx_.buffer.queuedItems()) + "]");

        int status = 200;
        if (r.isPurchase()) {
            if (ctx_.resource.purchase(workerId_, r.id) == PurchaseResult::SoldOut) {
                status = 409;
                ++ctx_.stats.rejected;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(r.processingMs));  // serve the request
        ctx_.stats.recordCompletion(workerId_, r, start, SimClock::now());
        ctx_.log.log(who + " completed " + r.label() + " - HTTP " + std::to_string(status) +
                     (status == 200 ? " OK" : " Conflict") + " response sent");
    }
}
