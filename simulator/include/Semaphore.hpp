#pragma once
#include <condition_variable>
#include <mutex>

// Classic counting semaphore (C++17 has none; std::counting_semaphore is C++20).
// Blocks with a condition variable -- no busy waiting.
class Semaphore {
public:
    explicit Semaphore(int initial) : count_(initial) {}

    // P / wait: block until count > 0, then decrement.
    void acquire() {
        std::unique_lock<std::mutex> lock(m_);
        cv_.wait(lock, [&] { return count_ > 0; });
        --count_;
    }
    // Non-blocking P. Returns false if the caller would have to wait.
    bool tryAcquire() {
        std::lock_guard<std::mutex> lock(m_);
        if (count_ > 0) { --count_; return true; }
        return false;
    }
    // V / signal: increment and wake one waiter.
    void release() {
        { std::lock_guard<std::mutex> lock(m_); ++count_; }
        cv_.notify_one();
    }
    int value() const {
        std::lock_guard<std::mutex> lock(m_);
        return count_;
    }
private:
    mutable std::mutex m_;
    std::condition_variable cv_;
    int count_;
};
