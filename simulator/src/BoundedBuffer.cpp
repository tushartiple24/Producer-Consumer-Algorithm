#include "BoundedBuffer.hpp"
#include <algorithm>
#include <stdexcept>

BoundedBuffer::BoundedBuffer(std::size_t capacity)
    : capacity_(capacity), empty_(static_cast<int>(capacity)), full_(0) {
    if (capacity == 0) throw std::invalid_argument("Buffer capacity must be > 0");
}

bool BoundedBuffer::produce(const Request& request, const std::function<void()>& onFull) {
    bool blocked = false;

    // wait(empty): if no free slot, the producer blocks here (no busy waiting).
    if (!empty_.tryAcquire()) {
        blocked = true;
        if (onFull) onFull();
        empty_.acquire();
    }

    // ---- PRODUCER CRITICAL SECTION: only one thread touches queue_ at a time ----
    {
        std::lock_guard<std::mutex> lock(mutex_);
        Request item = request;
        item.enqueued = SimClock::now();
        queue_.push(item);
        const int n = static_cast<int>(queue_.size());
        int p = peak_.load();
        while (n > p && !peak_.compare_exchange_weak(p, n)) {}
        if (queue_.size() == capacity_) ++fullEvents_;
    }
    // ---- end critical section ----

    full_.release();   // signal(full): wake one waiting consumer
    return blocked;
}

Request BoundedBuffer::consume(bool& waited, const std::function<void()>& onEmpty) {
    waited = false;

    // wait(full): if no queued request, the consumer blocks here.
    if (!full_.tryAcquire()) {
        waited = true;
        if (onEmpty) onEmpty();
        full_.acquire();
    }

    Request request;
    // ---- CONSUMER CRITICAL SECTION ----
    {
        std::lock_guard<std::mutex> lock(mutex_);
        request = queue_.front();
        queue_.pop();
        request.dequeued = SimClock::now();
        if (queue_.empty()) ++emptyEvents_;
    }
    // ---- end critical section ----

    empty_.release();  // signal(empty): a slot is free, wake one blocked producer
    return request;
}

std::size_t BoundedBuffer::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}
