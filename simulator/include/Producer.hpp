#pragma once
#include "SimContext.hpp"

// A client thread: generates one request and inserts it into the bounded buffer.
class Producer {
public:
    Producer(int clientId, SimContext& ctx) : clientId_(clientId), ctx_(ctx) {}
    void operator()();
private:
    int clientId_;
    SimContext& ctx_;
};
