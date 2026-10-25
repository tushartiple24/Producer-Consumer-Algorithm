#include "Server.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

static int num(const char* text) {
    try { return std::stoi(text); }
    catch (const std::exception&) { throw std::invalid_argument(std::string("not a number: ") + text); }
}

static void usage() {
    std::cout <<
        "Usage: server_sync [clients capacity workers sync processingMs arrivalDelayMs tickets]\n"
        "       server_sync --race        deterministic race-condition experiment (both modes)\n"
        "Defaults: 15 10 3 1 150 0 1     (sync: 1 = mutex ON, 0 = OFF)\n";
}

int main(int argc, char** argv) {
    try {
        if (argc > 1 && (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) { usage(); return 0; }
        if (argc > 1 && std::string(argv[1]) == "--race") {
            RaceOutcome unsafe = runRaceExperiment(false);
            RaceOutcome safe = runRaceExperiment(true);
            return (unsafe.detected && !safe.detected) ? 0 : 1;
        }

        SimConfig cfg;
        if (argc > 1) cfg.clients = num(argv[1]);
        if (argc > 2) cfg.capacity = num(argv[2]);
        if (argc > 3) cfg.workers = num(argv[3]);
        if (argc > 4) cfg.synchronized = num(argv[4]) != 0;
        if (argc > 5) cfg.processingMs = num(argv[5]);
        if (argc > 6) cfg.arrivalDelayMs = num(argv[6]);
        if (argc > 7) cfg.tickets = num(argv[7]);
        if (cfg.clients < 1 || cfg.clients > 1000 || cfg.capacity < 1 || cfg.workers < 1 ||
            cfg.workers > 64 || cfg.processingMs < 0 || cfg.arrivalDelayMs < 0 || cfg.tickets < 0)
            throw std::invalid_argument("argument out of range");

        std::cout << "SERVER//SYNC\nProducer-Consumer Web Server Simulation\n"
                  << "Clients=" << cfg.clients << ", Buffer=" << cfg.capacity << ", Workers=" << cfg.workers
                  << ", Synchronization=" << (cfg.synchronized ? "ON" : "OFF") << "\n\n";

        ServerSimulation sim(cfg);
        sim.run();
        printStatistics(sim.stats(), cfg);
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        usage();
        return 2;
    }
}
