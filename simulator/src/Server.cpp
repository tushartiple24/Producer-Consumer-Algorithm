#include "Server.hpp"
#include "Consumer.hpp"
#include "Producer.hpp"
#include <future>
#include <iostream>
#include <thread>
#include <vector>

ServerSimulation::ServerSimulation(const SimConfig& cfg) : ctx_(std::make_unique<SimContext>(cfg)) {}

void ServerSimulation::run() {
    std::vector<std::thread> producers, consumers;
    const auto t0 = SimClock::now();
    ctx_->log.log("Server started - " + std::to_string(ctx_->cfg.clients) + " producers, buffer " +
                  std::to_string(ctx_->cfg.capacity) + ", " + std::to_string(ctx_->cfg.workers) + " consumers");

    for (int w = 1; w <= ctx_->cfg.workers; ++w) consumers.emplace_back(Consumer(w, *ctx_));
    for (int c = 1; c <= ctx_->cfg.clients; ++c) producers.emplace_back(Producer(c, *ctx_));

    for (auto& t : producers) t.join();
    for (auto& t : consumers) t.join();

    Statistics& s = ctx_->stats;
    s.elapsedMs = std::chrono::duration<double, std::milli>(SimClock::now() - t0).count();
    s.peakBuffer = ctx_->buffer.peak();
    s.fullEvents = ctx_->buffer.fullEvents();
    s.emptyEvents = ctx_->buffer.emptyEvents();
    s.ticketsInitial = ctx_->resource.initial();
    s.ticketsSold = ctx_->resource.sold();
    s.raceCount = ctx_->resource.raceCount();
    ctx_->log.log("Simulation complete - " + std::to_string(s.processed.load()) + "/" +
                  std::to_string(ctx_->cfg.clients) + " requests processed");
}

RaceOutcome runRaceExperiment(bool synchronized, int raceWindowMs) {
    EventLog log;
    SharedResource resource(1, synchronized, raceWindowMs, log);
    std::cout << "\n--- Shared-resource experiment: AVAILABLE TICKETS = 1, "
              << (synchronized ? "WITH mutex" : "WITHOUT mutex") << " ---\n";

    std::promise<void> go;                       // both workers wait here, then start together
    std::shared_future<void> gate = go.get_future().share();
    auto worker = [&](int id) { gate.wait(); resource.purchase(id, id); };
    std::thread w1(worker, 1), w2(worker, 2);
    go.set_value();
    w1.join();
    w2.join();

    RaceOutcome out{resource.sold(), resource.available(), resource.raceCount() > 0};
    std::cout << "Tickets sold: " << out.sold << " (stock was 1), remaining: " << out.available << "\n"
              << (out.detected ? "RACE CONDITION DETECTED" : "RACE CONDITION PREVENTED") << "\n";
    return out;
}
