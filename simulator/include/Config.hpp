#pragma once
// Run-time configuration for one simulation.
struct SimConfig {
    int  clients       = 15;   // producer threads (one request each)
    int  capacity      = 10;   // bounded buffer slots
    int  workers       = 3;    // consumer threads
    int  processingMs  = 150;  // time a worker spends serving one request
    int  arrivalDelayMs= 0;    // client i starts (i-1)*arrivalDelayMs after t=0
    int  tickets       = 1;    // shared application resource: tickets in stock
    int  raceWindowMs  = 50;   // latency between "read stock" and "write stock"
    bool synchronized  = true; // true = mutex protects the shared resource
};
