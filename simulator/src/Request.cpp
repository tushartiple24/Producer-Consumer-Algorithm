#include "Request.hpp"

Request makeRequest(int clientId, int processingMs) {
    Request r;
    r.id = clientId;
    r.clientId = clientId;
    r.processingMs = processingMs;
    switch (clientId % 5) {
        case 1: case 2: r.method = "POST"; r.endpoint = "/purchase"; break; // touches shared state
        case 3:         r.method = "GET";  r.endpoint = "/profile";  break;
        default:        r.method = "GET";  r.endpoint = "/data";     break;
    }
    return r;
}
