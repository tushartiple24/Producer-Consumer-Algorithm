#pragma once
#include "Config.hpp"
#include "Request.hpp"
#include <atomic>
#include <mutex>
#include <utility>
#include <vector>

// All numbers are measured from simulation events -- nothing is hard-coded.
struct Statistics {
    explicit Statistics(int workers) : busyMs(workers + 1, 0.0) {}

    std::atomic<int> generated{0};
    std::atomic<int> processed{0};
    std::atomic<int> rejected{0};       // purchases answered with HTTP 409 (sold out)
    std::atomic<int> producerWaits{0};  // producers that blocked on a full buffer
    std::atomic<int> consumerWaits{0};  // consumers that blocked on an empty buffer

    // Filled in once all threads are joined.
    int peakBuffer = 0, fullEvents = 0, emptyEvents = 0;
    int ticketsInitial = 0, ticketsSold = 0, raceCount = 0;
    double elapsedMs = 0.0;

    void recordCompletion(int worker, const Request& r, SimClock::time_point start, SimClock::time_point done);

    std::mutex m;                                  // guards the fields below
    double totalQueueWaitMs = 0.0, totalResponseMs = 0.0;
    std::vector<double> busyMs;                    // index = worker id
    std::vector<std::pair<int, int>> timeline;     // (worker, request) in completion order
};

void printStatistics(const Statistics& stats, const SimConfig& cfg);
