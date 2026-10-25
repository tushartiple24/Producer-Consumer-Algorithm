#include "Statistics.hpp"
#include <iomanip>
#include <iostream>

using Ms = std::chrono::duration<double, std::milli>;

void Statistics::recordCompletion(int worker, const Request& r, SimClock::time_point start, SimClock::time_point done) {
    std::lock_guard<std::mutex> lock(m);
    totalQueueWaitMs += Ms(r.dequeued - r.enqueued).count();
    totalResponseMs  += Ms(done - r.created).count();
    busyMs[worker]   += Ms(done - start).count();
    timeline.emplace_back(worker, r.id);
    ++processed;
}

void printStatistics(const Statistics& s, const SimConfig& cfg) {
    const int n = s.processed.load();
    const double avgWait = n ? s.totalQueueWaitMs / n : 0.0;
    const double avgResp = n ? s.totalResponseMs / n : 0.0;
    const double thr = s.elapsedMs > 0 ? n / (s.elapsedMs / 1000.0) : 0.0;

    std::cout << "\n---------- WORKER TIMELINE (completion order) ----------\n";
    for (int w = 1; w <= cfg.workers; ++w) {
        std::cout << "Worker " << w << " |";
        for (auto& e : s.timeline) if (e.first == w) std::cout << " R" << e.second << " |";
        std::cout << '\n';
    }

    std::cout << std::fixed << std::setprecision(1);
    std::cout << "\n========== SIMULATION RESULTS ==========\n"
              << "Mode                     : " << (cfg.synchronized ? "SYNCHRONIZED" : "UNSYNCHRONIZED") << "\n"
              << "Clients / producers      : " << cfg.clients << "\n"
              << "Buffer capacity          : " << cfg.capacity << "\n"
              << "Server workers           : " << cfg.workers << "\n"
              << "Requests generated       : " << s.generated.load() << "\n"
              << "Requests processed       : " << n << "\n"
              << "Requests rejected (409)  : " << s.rejected.load() << "\n"
              << "Producer wait events     : " << s.producerWaits.load() << "\n"
              << "Consumer wait events     : " << s.consumerWaits.load() << "\n"
              << "Buffer full events       : " << s.fullEvents << "\n"
              << "Buffer empty events      : " << s.emptyEvents << "\n"
              << "Peak buffer usage        : " << s.peakBuffer << " / " << cfg.capacity << "\n"
              << "Avg queue waiting time   : " << avgWait << " ms\n"
              << "Avg response time        : " << avgResp << " ms\n"
              << "Total time               : " << s.elapsedMs << " ms\n"
              << "Throughput               : " << std::setprecision(2) << thr << " req/s\n"
              << std::setprecision(1);
    for (int w = 1; w <= cfg.workers; ++w) {
        double u = s.elapsedMs > 0 ? 100.0 * s.busyMs[w] / s.elapsedMs : 0.0;
        std::cout << "Worker " << w << " utilization  : " << u << " %\n";
    }
    std::cout << "Tickets (initial / sold) : " << s.ticketsInitial << " / " << s.ticketsSold << "\n"
              << "Race-condition count     : " << s.raceCount
              << (s.raceCount ? "   <-- RACE CONDITION DETECTED" : "") << "\n"
              << "========================================\n";
}
