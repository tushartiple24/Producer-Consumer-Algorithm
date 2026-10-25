cmake_minimum_required(VERSION 3.16)
project(server_sync LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Threads REQUIRED)
add_executable(server_sync
    src/main.cpp
    src/Request.cpp
    src/BoundedBuffer.cpp
    src/SharedResource.cpp
    src/Producer.cpp
    src/Consumer.cpp
    src/Server.cpp
    src/Statistics.cpp
)
target_include_directories(server_sync PRIVATE include)
if(MSVC)
    target_compile_options(server_sync PRIVATE /W4 /utf-8)
else()
    target_compile_options(server_sync PRIVATE -Wall -Wextra)
endif()
target_link_libraries(server_sync PRIVATE Threads::Threads)
