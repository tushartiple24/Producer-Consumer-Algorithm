#include "Producer.hpp"
#include <chrono>
#include <thread>

void Producer::operator()() {
    if (ctx_.cfg.arrivalDelayMs > 0)
        std::this_thread::sleep_for(std::chrono::milliseconds((clientId_ - 1) * ctx_.cfg.arrivalDelayMs));

    Request r = makeRequest(clientId_, ctx_.cfg.processingMs);
    r.created = SimClock::now();
    ++ctx_.stats.generated;
    const std::string who = "Client " + std::to_string(clientId_);
    ctx_.log.log(who + " generated " + r.label() + " (" + r.method + " " + r.endpoint + ")");

    // wait(empty) -> lock(mutex) -> insert -> unlock(mutex) -> signal(full)
    const bool blocked = ctx_.buffer.produce(r, [&] {
        ++ctx_.stats.producerWaits;
        ctx_.log.log("BUFFER FULL - " + who + " blocked (waiting for a free slot)");
    });
    if (blocked) ctx_.log.log(who + " unblocked");

    const std::size_t n = ctx_.buffer.size();
    ctx_.log.log(r.label() + " inserted - buffer " + std::to_string(n) + "/" + std::to_string(ctx_.buffer.capacity()) +
                 "  [empty=" + std::to_string(ctx_.buffer.freeSlots()) +
                 " full=" + std::to_string(ctx_.buffer.queuedItems()) + "]");
    if (n == ctx_.buffer.capacity()) ctx_.log.log("BUFFER FULL - " + std::to_string(n) + "/" + std::to_string(n));
}
