// SPDX-License-Identifier: 0BSD
#pragma once
#ifndef TESTS
#include "mem.hpp"
#endif
#include <stdint.h>

struct Oam {
  uint16_t shadow[512];        // shadow OAM
  uint32_t handleAvail[4];     // 128 bits flagging if a handle is available
  uint32_t rotateAvail;        // 32 bits flagging if a rotate slot is available
  int8_t handleToIndex[128];
  int8_t indexToHandle[128];
  uint8_t handlePriority[128]; // top 2 bits GBA priority, lower 6 bits are internal and affect sort
  int8_t totalEntries;

  void reset();
  Oam() { reset(); }
  int8_t alloc(uint8_t priority); // allocates entry; returns handle (0-127) or -1 for out of memory
  void free(int8_t handle);
  int8_t allocRotate(); // allocates rotation slot; returns index (0-31) or -1 for out of memory
  void freeRotate(int8_t index);

  uint16_t attr0AtIndex(int index) {
    return shadow[index * 4 + 0];
  }

  void attr0AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 0] = value;
  }

  uint16_t attr1AtIndex(int index) {
    return shadow[index * 4 + 1];
  }

  void attr1AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 1] = value;
  }

  uint16_t attr2AtIndex(int index) {
    return shadow[index * 4 + 2];
  }

  void attr2AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 2] = value;
  }

  uint16_t attr0(int8_t handle) {
    return attr0AtIndex(handleToIndex[handle]);
  }

  void attr0(int8_t handle, uint16_t value) {
    attr0AtIndex(handleToIndex[handle], value);
  }

  uint16_t attr1(int8_t handle) {
    return attr1AtIndex(handleToIndex[handle]);
  }

  void attr1(int8_t handle, uint16_t value) {
    attr1AtIndex(handleToIndex[handle], value);
  }

  uint16_t attr2(int8_t handle) {
    return attr2AtIndex(handleToIndex[handle]);
  }

  void attr2(int8_t handle, uint16_t value) {
    attr2AtIndex(handleToIndex[handle], value);
  }

  int16_t PA(int8_t index) {
    return shadow[index * 16 + 3];
  }

  void PA(int8_t index, int16_t value) {
    shadow[index * 16 + 3] = value;
  }

  int16_t PB(int8_t index) {
    return shadow[index * 16 + 7];
  }

  void PB(int8_t index, int16_t value) {
    shadow[index * 16 + 7] = value;
  }

  int16_t PC(int8_t index) {
    return shadow[index * 16 + 11];
  }

  void PC(int8_t index, int16_t value) {
    shadow[index * 16 + 11] = value;
  }

  int16_t PD(int8_t index) {
    return shadow[index * 16 + 15];
  }

  void PD(int8_t index, int16_t value) {
    shadow[index * 16 + 15] = value;
  }

#ifndef TESTS
  __attribute__((always_inline)) inline void copy() {
    memcpy32(reinterpret_cast<uint16_t *>(0x07000000u), shadow, 1024);
  }
#endif

#ifdef TESTS
  static int test(bool verbose);
#endif
};
