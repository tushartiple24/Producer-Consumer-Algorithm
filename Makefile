# Convenience wrapper: delegates to simulator/Makefile
all run race test clean:
	$(MAKE) -C simulator $@
.PHONY: all run race test clean
