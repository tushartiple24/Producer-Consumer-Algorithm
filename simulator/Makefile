CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -O2 -pthread
INCLUDES = -Iinclude
SRC = $(wildcard src/*.cpp)
TARGET = server_sync

all: $(TARGET)

$(TARGET): $(SRC) $(wildcard include/*.hpp)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(SRC) -o $(TARGET)

run: all
	./$(TARGET)

race: all
	./$(TARGET) --race

test: all
	bash tests/check.sh

clean:
	rm -f $(TARGET)
	rm -rf build

.PHONY: all run race test clean
