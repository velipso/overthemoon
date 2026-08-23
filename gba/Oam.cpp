// SPDX-License-Identifier: 0BSD
#include "Oam.hpp"
#include "util/ctz32.hpp"

#ifdef TESTS
#include <random>
#include <stdio.h>
static bool g_verbose;
static bool g_doubleAlloc;
static bool g_doubleFree;
#define log(fmt, ...) if (g_verbose) printf(fmt, ##__VA_ARGS__)
#else
#define log(fmt, ...)
#endif

void Oam::reset() {
  uint16_t rot[] = { 256, 0, 0, 256 }; // identity transform
  uint16_t *o = shadow;
  for (int i = 0; i < 128; i++, o += 4) {
    o[0] = 1u << 9; // set OBJ disable
    o[1] = 0;
    o[2] = 0;
    o[3] = rot[i & 3]; // reset PA/PB/PC/PD
    indexToHandle[i] = handleToIndex[i] = -1;
  }
  handleAvail[0] = handleAvail[1] = handleAvail[2] = handleAvail[3] = rotateAvail = 0xffffffffu;
  totalEntries = 0;
}

static inline void oamMove(int dstIndex, int srcIndex) {
  // move mapping
  int handle = indexToHandle[srcIndex];
  indexToHandle[srcIndex] = -1;
  indexToHandle[dstIndex] = handle;
  handleToIndex[handle] = dstIndex;
  // move shadow OAM
  uint16_t *dst = &shadow[dstIndex * 4];
  uint16_t *src = &shadow[srcIndex * 4];
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

int8_t Oam::alloc(uint8_t priority) {
  int8_t handle = -1;
  for (int i = 0; i < 4; i++) {
    if (handleAvail[i]) {
      int index = ctz32(handleAvail[i]);
      handleAvail[i] &= ~(1u << index);
      handle = index + (i << 5);
      break;
    }
  }
  if (handle < 0) return -1;

  // find insertion point
  int insert = 0;
  for (; insert < totalEntries; insert++) {
    if (handlePriority[indexToHandle[insert]] >= priority) break;
  }
  // move everything below `insert` downwards
  for (int i = totalEntries - 1; i >= insert; i--) {
    oamMove(i, i + 1);
  }

  // install at `insert`
  indexToHandle[insert] = handle;
  handleToIndex[handle] = insert;
  handlePriority[handle] = priority;
  attr0AtIndex(insert, 1u << 9); // hide
  attr1AtIndex(insert, 0);
  attr2AtIndex(insert, (priority >> 6) << 10); // set GBA priority
  totalEntries++;
  return handle;
}

void Oam::free(int8_t handle) {
  if (handle < 0) return;
  int i = handle >> 5;
  uint32_t mask = 1u << (handle & 31);
#ifdef TESTS
  if (handleAvail[i] & mask) {
    log("double free detected\n");
    g_doubleFree = true;
  }
#endif
  // TODO: hide sprite? resort?
  totalEntries--;
  handleAvail[i] |= mask;
}

int8_t Oam::allocRotate() {
  if (!rotateAvail) return -1;
  int index = ctz32(rotateAvail);
  rotateAvail &= ~(1u << index);
  return index;
}

void Oam::freeRotate(int8_t index) {
  if (index < 0) return;
  uint32_t mask = 1u << index;
#ifdef TESTS
  if (rotateAvail & mask) {
    log("double free detected\n");
    g_doubleFree = true;
  }
#endif
  PA(index, 256);
  PB(index, 0);
  PC(index, 0);
  PD(index, 256);
  rotateAvail |= mask;
}

#ifdef TESTS
static std::mt19937 rng(std::random_device{}());

static int rand(int size) {
  if (size <= 1) return 0;
  return std::uniform_int_distribution<int>(0, size - 1)(rng);
}

int Oam::test(bool verbose) {
  g_verbose = verbose;
  return 0;
}
#endif
