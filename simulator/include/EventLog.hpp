#pragma once
#include "Request.hpp"
#include <cstdio>
#include <iostream>
#include <mutex>
#include <string>

// Thread-safe, timestamped event log: "[SS.mmm] message".
class EventLog {
public:
    EventLog() : start_(SimClock::now()) {}
    void log(const std::string& msg) {
        std::lock_guard<std::mutex> lock(m_);
        char ts[32];
        std::snprintf(ts, sizeof ts, "[%06.3f] ", elapsedMs() / 1000.0);
        std::cout << ts << msg << '\n';
    }
    double elapsedMs() const {
        return std::chrono::duration<double, std::milli>(SimClock::now() - start_).count();
    }
private:
    SimClock::time_point start_;
    std::mutex m_;
};
