#pragma once
#include "Request.hpp"
#include "Semaphore.hpp"
#include <atomic>
#include <cstddef>
#include <functional>
#include <mutex>
#include <queue>

// Bounded request queue: the classic semaphore solution.
//   empty = free slots   (initially capacity)
//   full  = queued items (initially 0)
//   mutex_ = mutual exclusion on the queue itself
class BoundedBuffer {
public:
    explicit BoundedBuffer(std::size_t capacity);

    // Returns true if the producer had to block because the buffer was full.
    // onFull runs just before blocking (used for logging / statistics).
    bool produce(const Request& request, const std::function<void()>& onFull = nullptr);

    // Blocks while the buffer is empty. waited reports whether it had to block.
    Request consume(bool& waited, const std::function<void()>& onEmpty = nullptr);

    std::size_t size() const;
    std::size_t capacity() const { return capacity_; }
    int freeSlots() const { return empty_.value(); }   // value of 'empty'
    int queuedItems() const { return full_.value(); }  // value of 'full'

    int peak() const { return peak_.load(); }
    int fullEvents() const { return fullEvents_.load(); }   // times buffer reached capacity
    int emptyEvents() const { return emptyEvents_.load(); } // times a pop left it empty

private:
    std::size_t capacity_;
    std::queue<Request> queue_;
    mutable std::mutex mutex_;
    Semaphore empty_;
    Semaphore full_;
    std::atomic<int> peak_{0}, fullEvents_{0}, emptyEvents_{0};
};
