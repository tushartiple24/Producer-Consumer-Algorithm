#pragma once
#include "EventLog.hpp"
#include <atomic>
#include <mutex>

enum class PurchaseResult { Purchased, SoldOut };

// Shared application state ("database"): a stock of tickets.
// synchronized == true  -> a mutex covers the whole read-check-write sequence.
// synchronized == false -> no lock: a classic check-then-act race (lost update).
class SharedResource {
public:
    SharedResource(int tickets, bool synchronized, int raceWindowMs, EventLog& log);

    PurchaseResult purchase(int workerId, int requestId);

    int available() const { return available_.load(); }
    int sold() const { return sold_.load(); }
    int initial() const { return initial_; }
    int raceCount() const { return races_.load(); }   // purchases beyond the real stock

private:
    PurchaseResult readCheckWrite(int workerId, int requestId);

    const int initial_;
    const bool synchronized_;
    const int windowMs_;
    EventLog& log_;
    std::mutex mutex_;                 // resource mutex (separate from the queue mutex)
    // Atomics keep the program free of formal C++ data-race UB while preserving the
    // *logical* race: read and write are separate steps, so updates can be lost.
    std::atomic<int> available_;
    std::atomic<int> sold_{0};
    std::atomic<int> races_{0};
};
