#pragma once
#include "SimContext.hpp"

// A server worker thread: removes requests, uses the shared resource, replies.
class Consumer {
public:
    Consumer(int workerId, SimContext& ctx) : workerId_(workerId), ctx_(ctx) {}
    void operator()();
private:
    int workerId_;
    SimContext& ctx_;
};
