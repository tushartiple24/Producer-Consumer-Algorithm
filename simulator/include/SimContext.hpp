#pragma once
#include "BoundedBuffer.hpp"
#include "Config.hpp"
#include "EventLog.hpp"
#include "SharedResource.hpp"
#include "Statistics.hpp"
#include <atomic>

// Everything the producer and consumer threads share. (Member order matters:
// log is constructed before resource, which keeps a reference to it.)
struct SimContext {
    explicit SimContext(const SimConfig& c)
        : cfg(c), buffer(c.capacity), resource(c.tickets, c.synchronized, c.raceWindowMs, log), stats(c.workers) {}

    SimConfig cfg;
    EventLog log;
    BoundedBuffer buffer;
    SharedResource resource;
    Statistics stats;
    std::atomic<int> claimed{0};  // consume "tickets": exactly cfg.clients are handed out
};
