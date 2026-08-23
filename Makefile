# SPDX-License-Identifier: 0BSD

# -----

NAME               := overthemoon
GAME_TITLE         := "OVERTHEMOON"
GAME_CODE          := "COTE"
MAKER_CODE         := "77"
VERSION            := 0

# -----

ROOT_DIR           := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SRC_DIR            := $(ROOT_DIR)/src
GBA_DIR            := $(ROOT_DIR)/gba
DATA_DIR           := $(ROOT_DIR)/data
TYPES_DIR          := $(ROOT_DIR)/types
TESTS_DIR          := $(ROOT_DIR)/tests
XFORM_DIR          := $(ROOT_DIR)/xform
SCRIPTS_DIR        := $(ROOT_DIR)/scripts
TGT_DIR            := $(ROOT_DIR)/tgt
TGT_TYPES_DIR      := $(TGT_DIR)/types
TGT_TYPES_SRC_DIR  := $(TGT_TYPES_DIR)/types
TGT_TYPES_ARM_DIR  := $(TGT_TYPES_DIR)/arm
TGT_TYPES_TESTS_DIR:= $(TGT_TYPES_DIR)/tests
TGT_TYPES_XFORM_DIR:= $(TGT_TYPES_DIR)/xform
TGT_TESTS_DIR      := $(TGT_DIR)/tests
TGT_XFORM_DIR      := $(TGT_DIR)/xform
TGT_SRC_DIR        := $(TGT_DIR)/src
TGT_GBA_DIR        := $(TGT_DIR)/gba

TESTS              := $(TGT_TESTS_DIR)/tests
XFORM              := $(TGT_XFORM_DIR)/xform

GBA_ELF            := $(TGT_DIR)/$(NAME).elf
GBA_DUMP           := $(TGT_DIR)/$(NAME).dump
GBA_ROM            := $(TGT_DIR)/$(NAME).gba
GBA_MAP            := $(TGT_DIR)/$(NAME).map

# -----

TESTS_C            := gcc
TESTS_CFLAGS       :=     \
	-Wall                   \
	-O3                     \
	-std=gnu23              \
	-DTESTS                 \
	-I$(TESTS_DIR)          \
	-I$(TGT_TYPES_DIR)      \
	-I$(SRC_DIR)            \
	-I$(ROOT_DIR)
TESTS_CPP          := g++
TESTS_CPPFLAGS     :=     \
	-Wall                   \
	-Wno-unused-function    \
	-O3                     \
	-std=gnu++20            \
	-DTESTS                 \
	-I$(TESTS_DIR)          \
	-I$(TGT_TYPES_DIR)      \
	-I$(SRC_DIR)            \
	-I$(ROOT_DIR)

# -----

XFORM_C            := gcc
XFORM_CFLAGS       :=     \
	-Wall                   \
	-O3                     \
	-std=gnu23              \
	-I$(XFORM_DIR)          \
	-I$(TGT_TYPES_DIR)
XFORM_CPP          := g++
XFORM_CPPFLAGS     :=     \
	-Wall                   \
	-Wno-unused-function    \
	-O3                     \
	-std=gnu++20            \
	-I$(XFORM_DIR)          \
	-I$(TGT_TYPES_DIR)

# -----

ARM_COMMON_FLAGS   :=     \
	-mcpu=arm7tdmi          \
	-mtune=arm7tdmi         \
	-mthumb-interwork       \
	-ffunction-sections     \
	-fdata-sections
ARM_C              := arm-none-eabi-gcc
ARM_CFLAGS         :=     \
	-Wall                   \
	-O3                     \
	-std=gnu23              \
	-mthumb                 \
	$(ARM_COMMON_FLAGS)     \
	-I$(SRC_DIR)            \
	-I$(ROOT_DIR)           \
	-I$(TGT_TYPES_DIR)
ARM_CPP            := arm-none-eabi-g++
ARM_CPPFLAGS       :=     \
	-Wall                   \
	-Wno-unused-function    \
	-O3                     \
	-std=gnu++20            \
	-fno-exceptions         \
	-fno-rtti               \
	-ffreestanding          \
	-fno-threadsafe-statics \
	-mthumb                 \
	$(ARM_COMMON_FLAGS)     \
	-I$(SRC_DIR)            \
	-I$(ROOT_DIR)           \
	-I$(TGT_TYPES_DIR)
ARM_IWRAM_CPPFLAGS :=     \
	-Wall                   \
	-Wno-unused-function    \
	-O3                     \
	-std=gnu++20            \
	-fno-exceptions         \
	-fno-rtti               \
	-ffreestanding          \
	-fno-threadsafe-statics \
	-marm                   \
	$(ARM_COMMON_FLAGS)     \
	-I$(SRC_DIR)            \
	-I$(ROOT_DIR)           \
	-I$(TGT_TYPES_DIR)
ARM_ASFLAGS        :=     \
	-x assembler-with-cpp   \
	-mthumb                 \
	$(ARM_COMMON_FLAGS)
ARM_LDFLAGS        :=     \
	-Wl,-Map,$(GBA_MAP)     \
	-Wl,--gc-sections       \
	-specs=nano.specs       \
	-T $(GBA_DIR)/link.ld   \
	-Wl,--start-group       \
	-lc                     \
	-Wl,--end-group         \
	$(ARM_COMMON_FLAGS)
ARM_OBJDUMP        := arm-none-eabi-objdump
ARM_OBJCOPY        := arm-none-eabi-objcopy

# -----

.PHONY: all clean dump tests test test-v xform
.DEFAULT_GOAL := all
.SECONDARY:

all: $(GBA_ROM)

tests: $(TESTS)

test: $(TESTS)
	$(TESTS) $(FILTER)

test-v: $(TESTS)
	$(TESTS) -v $(FILTER)

xform: $(XFORM)

clean:
	rm -rf $(TGT_DIR)

dump: $(GBA_DUMP)

# -----

TYPELIB_HPP        := $(TGT_TYPES_SRC_DIR)/typelib.hpp
TYPELIB_CPP        := $(TGT_TYPES_SRC_DIR)/typelib.cpp
TYPELIB_JS         := $(TGT_TYPES_SRC_DIR)/typelib.js
TYPELIB_ARM_OBJ    := $(TGT_TYPES_ARM_DIR)/typelib.cpp.o
TYPELIB_TESTS_OBJ  := $(TGT_TYPES_TESTS_DIR)/typelib.cpp.o
TYPELIB_XFORM_OBJ  := $(TGT_TYPES_XFORM_DIR)/typelib.cpp.o

$(TYPELIB_HPP) \
$(TYPELIB_CPP) \
$(TYPELIB_JS): $(SCRIPTS_DIR)/typelib.ts
	@mkdir -p $(@D)
	node $(SCRIPTS_DIR)/typelib.ts -s $@

$(TYPELIB_ARM_OBJ): $(TYPELIB_CPP) $(TYPELIB_HPP)
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TYPELIB_TESTS_OBJ): $(TYPELIB_CPP) $(TYPELIB_HPP)
	@mkdir -p $(@D)
	$(TESTS_CPP) $(TESTS_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TYPELIB_XFORM_OBJ): $(TYPELIB_CPP) $(TYPELIB_HPP)
	@mkdir -p $(@D)
	$(XFORM_CPP) $(XFORM_CPPFLAGS) -MMD -MP -c -o $@ $<

# -----

TYPES              := $(shell find $(TYPES_DIR) -type f -name '*.type')
TYPE_CPP           := $(patsubst $(TYPES_DIR)/%.type,$(TGT_TYPES_SRC_DIR)/%.cpp,$(TYPES))
TYPE_HPP           := $(patsubst $(TYPES_DIR)/%.type,$(TGT_TYPES_SRC_DIR)/%.hpp,$(TYPES))
TYPE_JS            := $(patsubst $(TYPES_DIR)/%.type,$(TGT_TYPES_SRC_DIR)/%.js,$(TYPES))
TYPE_ARM_OBJS      := $(patsubst $(TGT_TYPES_SRC_DIR)/%.cpp,$(TGT_TYPES_ARM_DIR)/%.cpp.o,$(TYPE_CPP))
TYPE_TESTS_OBJS    := $(patsubst $(TGT_TYPES_SRC_DIR)/%.cpp,$(TGT_TYPES_TESTS_DIR)/%.cpp.o,$(TYPE_CPP))
TYPE_XFORM_OBJS    := $(patsubst $(TGT_TYPES_SRC_DIR)/%.cpp,$(TGT_TYPES_XFORM_DIR)/%.cpp.o,$(TYPE_CPP))

$(TGT_TYPES_SRC_DIR)/%.cpp: $(TYPES_DIR)/%.type $(SCRIPTS_DIR)/typelib.ts
	@mkdir -p $(@D)
	node $(SCRIPTS_DIR)/typelib.ts -i $< -o $@

$(TGT_TYPES_SRC_DIR)/%.hpp: $(TYPES_DIR)/%.type $(SCRIPTS_DIR)/typelib.ts
	@mkdir -p $(@D)
	node $(SCRIPTS_DIR)/typelib.ts -i $< -o $@

$(TGT_TYPES_SRC_DIR)/%.js: $(TYPES_DIR)/%.type $(SCRIPTS_DIR)/typelib.ts
	@mkdir -p $(@D)
	node $(SCRIPTS_DIR)/typelib.ts -i $< -o $@

$(TGT_TYPES_ARM_DIR)/%.cpp.o: $(TGT_TYPES_SRC_DIR)/%.cpp $(TGT_TYPES_SRC_DIR)/%.hpp
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_CPPFLAGS) -I$(TGT_TYPES_SRC_DIR) -MMD -MP -c -o $@ $<

$(TGT_TYPES_TESTS_DIR)/%.cpp.o: $(TGT_TYPES_SRC_DIR)/%.cpp $(TGT_TYPES_SRC_DIR)/%.hpp
	@mkdir -p $(@D)
	$(TESTS_CPP) $(TESTS_CPPFLAGS) -MMD -MP -I$(TGT_TYPES_SRC_DIR) -c -o $@ $<

$(TGT_TYPES_XFORM_DIR)/%.cpp.o: $(TGT_TYPES_SRC_DIR)/%.cpp $(TGT_TYPES_SRC_DIR)/%.hpp
	@mkdir -p $(@D)
	$(XFORM_CPP) $(XFORM_CPPFLAGS) -MMD -MP -I$(TGT_TYPES_SRC_DIR) -c -o $@ $<

# -----

TESTS_SRC_C        := $(shell find $(TESTS_DIR) -type f -name '*.c')
TESTS_SRC_CPP      := $(shell find $(TESTS_DIR) -type f -name '*.cpp')
TESTS_OBJS         := \
	$(patsubst $(TESTS_DIR)/%.c,$(TGT_TESTS_DIR)/%.c.o,$(TESTS_SRC_C)) \
	$(patsubst $(TESTS_DIR)/%.cpp,$(TGT_TESTS_DIR)/%.cpp.o,$(TESTS_SRC_CPP)) \
	$(TYPELIB_TESTS_OBJ) \
	$(TYPE_TESTS_OBJS)
TESTS_DEPS         := $(TESTS_OBJS:.o=.d)

$(TGT_TESTS_DIR)/%.c.o: $(TESTS_DIR)/%.c
	@mkdir -p $(@D)
	$(TESTS_C) $(TESTS_CFLAGS) -MMD -MP -c -o $@ $<

$(TGT_TESTS_DIR)/%.cpp.o: $(TESTS_DIR)/%.cpp
	@mkdir -p $(@D)
	$(TESTS_CPP) $(TESTS_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TESTS_OBJS): $(TYPELIB_HPP) $(TYPE_HPP)

$(TESTS): $(TESTS_OBJS)
	$(TESTS_CPP) -o $@ $(TESTS_OBJS)

# -----

XFORM_SRC_C        := $(shell find $(XFORM_DIR) -type f -name '*.c')
XFORM_SRC_CPP      := $(shell find $(XFORM_DIR) -type f -name '*.cpp')
XFORM_OBJS         := \
	$(patsubst $(XFORM_DIR)/%.c,$(TGT_XFORM_DIR)/%.c.o,$(XFORM_SRC_C)) \
	$(patsubst $(XFORM_DIR)/%.cpp,$(TGT_XFORM_DIR)/%.cpp.o,$(XFORM_SRC_CPP)) \
	$(TYPELIB_XFORM_OBJ) \
	$(TYPE_XFORM_OBJS)
XFORM_DEPS         := $(XFORM_OBJS:.o=.d)

$(TGT_XFORM_DIR)/%.c.o: $(XFORM_DIR)/%.c
	@mkdir -p $(@D)
	$(XFORM_C) $(XFORM_CFLAGS) -MMD -MP -c -o $@ $<

$(TGT_XFORM_DIR)/%.cpp.o: $(XFORM_DIR)/%.cpp
	@mkdir -p $(@D)
	$(XFORM_CPP) $(XFORM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(XFORM_OBJS): $(TYPELIB_HPP) $(TYPE_HPP)

$(XFORM): $(XFORM_OBJS)
	$(XFORM_CPP) -o $@ $(XFORM_OBJS)

# -----

SRC_S              := $(shell find $(SRC_DIR) -type f -name '*.s')
GBA_S              := $(shell find $(GBA_DIR) -type f -name '*.s')
SRC_C              := $(shell find $(SRC_DIR) -type f -name '*.c')
GBA_C              := $(shell find $(GBA_DIR) -type f -name '*.c')
SRC_IWRAM_CPP      := $(shell find $(SRC_DIR) -type f -name '*.iwram.cpp')
GBA_IWRAM_CPP      := $(shell find $(GBA_DIR) -type f -name '*.iwram.cpp')
SRC_CPP            := $(shell find $(SRC_DIR) -type f -name '*.cpp' ! -name '*.iwram.cpp')
GBA_CPP            := $(shell find $(GBA_DIR) -type f -name '*.cpp' ! -name '*.iwram.cpp')
ARM_OBJS           := \
	$(patsubst $(SRC_DIR)/%.s,$(TGT_SRC_DIR)/%.s.o,$(SRC_S)) \
	$(patsubst $(GBA_DIR)/%.s,$(TGT_GBA_DIR)/%.s.o,$(GBA_S)) \
	$(patsubst $(SRC_DIR)/%.c,$(TGT_SRC_DIR)/%.c.o,$(SRC_C)) \
	$(patsubst $(GBA_DIR)/%.c,$(TGT_GBA_DIR)/%.c.o,$(GBA_C)) \
	$(patsubst $(SRC_DIR)/%.iwram.cpp,$(TGT_SRC_DIR)/%.iwram.cpp.o,$(SRC_IWRAM_CPP)) \
	$(patsubst $(GBA_DIR)/%.iwram.cpp,$(TGT_GBA_DIR)/%.iwram.cpp.o,$(GBA_IWRAM_CPP)) \
	$(patsubst $(SRC_DIR)/%.cpp,$(TGT_SRC_DIR)/%.cpp.o,$(SRC_CPP)) \
	$(patsubst $(GBA_DIR)/%.cpp,$(TGT_GBA_DIR)/%.cpp.o,$(GBA_CPP)) \
	$(TYPELIB_ARM_OBJ) \
	$(TYPE_ARM_OBJS)
ARM_DEPS           := $(ARM_OBJS:.o=.d)

$(TGT_SRC_DIR)/%.s.o: $(SRC_DIR)/%.s
	@mkdir -p $(@D)
	$(ARM_C) $(ARM_ASFLAGS) -I$(dir $<) -MMD -MP -c -o $@ $<

$(TGT_GBA_DIR)/%.s.o: $(GBA_DIR)/%.s
	@mkdir -p $(@D)
	$(ARM_C) $(ARM_ASFLAGS) -I$(dir $<) -MMD -MP -c -o $@ $<

$(TGT_SRC_DIR)/%.c.o: $(SRC_DIR)/%.c
	@mkdir -p $(@D)
	$(ARM_C) $(ARM_CFLAGS) -MMD -MP -c -o $@ $<

$(TGT_GBA_DIR)/%.c.o: $(GBA_DIR)/%.c
	@mkdir -p $(@D)
	$(ARM_C) $(ARM_CFLAGS) -MMD -MP -c -o $@ $<

$(TGT_SRC_DIR)/%.iwram.cpp.o: $(SRC_DIR)/%.iwram.cpp
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_IWRAM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TGT_GBA_DIR)/%.iwram.cpp.o: $(GBA_DIR)/%.iwram.cpp
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_IWRAM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TGT_SRC_DIR)/%.cpp.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(TGT_GBA_DIR)/%.cpp.o: $(GBA_DIR)/%.cpp
	@mkdir -p $(@D)
	$(ARM_CPP) $(ARM_CPPFLAGS) -MMD -MP -c -o $@ $<

$(ARM_OBJS): $(TYPELIB_HPP) $(TYPE_HPP)

$(GBA_ELF): $(ARM_OBJS)
	$(ARM_CPP) -o $@ $(ARM_OBJS) $(ARM_LDFLAGS)

$(GBA_ROM): $(GBA_ELF) $(XFORM)
	$(ARM_OBJCOPY) -O binary $< $@
	$(XFORM) gbafix $@ -p -t $(GAME_TITLE) -g $(GAME_CODE) -m $(MAKER_CODE) -v $(VERSION)

$(GBA_DUMP): $(GBA_ELF)
	$(ARM_OBJDUMP) -h -C -S $< > $@

# -----

-include $(XFORM_DEPS)
-include $(TESTS_DEPS)
-include $(ARM_DEPS)
