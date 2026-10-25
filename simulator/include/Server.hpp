#pragma once
#include "Config.hpp"
#include "SimContext.hpp"
#include <memory>

// Owns the producer and consumer threads of one simulation run.
class ServerSimulation {
public:
    explicit ServerSimulation(const SimConfig& cfg);
    void run();
    const Statistics& stats() const { return ctx_->stats; }
    const SimConfig& config() const { return ctx_->cfg; }
private:
    std::unique_ptr<SimContext> ctx_;
};

struct RaceOutcome { int sold; int available; bool detected; };

// Deterministic experiment: two workers purchase the last ticket at the same instant.
RaceOutcome runRaceExperiment(bool synchronized, int raceWindowMs = 100);
