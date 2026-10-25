#pragma once
#include <chrono>
#include <string>

using SimClock = std::chrono::steady_clock;

// One HTTP-like request produced by a client thread.
struct Request {
    int id{};
    int clientId{};
    std::string method;
    std::string endpoint;
    int processingMs{500};
    SimClock::time_point created{};   // client generated it
    SimClock::time_point enqueued{};  // inserted into the buffer
    SimClock::time_point dequeued{};  // removed by a worker

    bool isPurchase() const { return method == "POST" && endpoint == "/purchase"; }
    std::string label() const { return "R" + std::to_string(id); }
};

// Builds the request for a client. Mix: POST /purchase, GET /profile, GET /data.
Request makeRequest(int clientId, int processingMs);
