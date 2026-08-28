// SPDX-License-Identifier: 0BSD
#include "Oam.hpp"
#include "util/ctz32.hpp"
#include "gba/atomic.hpp"

#ifdef TESTS
#include <random>
#include <stdio.h>
static bool g_verbose;
static bool g_doubleFree;
#define log(fmt, ...) if (g_verbose) printf(fmt, ##__VA_ARGS__)
#else
#define log(fmt, ...)
#endif

Oam &Oam::reset() {
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
  return *this;
}

static inline void oamMove(Oam &oam, int dstIndex, int srcIndex) {
  // move mapping
  int handle = oam.indexToHandle[srcIndex];
  oam.indexToHandle[srcIndex] = -1;
  oam.indexToHandle[dstIndex] = handle;
  oam.handleToIndex[handle] = dstIndex;
  // move shadow OAM
  uint16_t *dst = &oam.shadow[dstIndex * 4];
  uint16_t *src = &oam.shadow[srcIndex * 4];
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

int8_t Oam::alloc(uint8_t priority) {
  int8_t handle = -1;
  bool didRetry = false;
  for (int i = 0; i < 4; i++) {
retry:
    if (handleAvail[i]) {
      int index = ctz32(handleAvail[i]);
      uint32_t mask = 1u << index;
      if (atomicBitClear(&handleAvail[i], mask)) {
        handle = (i << 5) + index;
        break;
      } else if (!didRetry) {
        didRetry = true;
        goto retry;
      }
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
    oamMove(*this, i + 1, i);
  }

  // install at `insert`
  indexToHandle[insert] = handle;
  handleToIndex[handle] = insert;
  handlePriority[handle] = priority;
  insert *= 4;
  shadow[insert + 0] = 1u << 9; // hide
  shadow[insert + 1] = 0;
  shadow[insert + 2] = (priority >> 6) << 10; // set GBA priority
  totalEntries++;
  return handle;
}

bool Oam::isEmpty() {
  for (int i = 0; i < 4; i++) {
    if (handleAvail[i] != 0xffffffffu) return false;
  }
  return true;
}

Oam &Oam::priority(int8_t handle, uint8_t priority) {
  uint8_t old = handlePriority[handle];
  if (old == priority) return *this;
  handlePriority[handle] = priority;

  int index = handleToIndex[handle];

  // update GBA priority immediately
  shadow[index * 4 + 2] = (shadow[index * 4 + 2] & 0xf3ff) | ((priority >> 6) << 10);
  uint16_t buffer[3] = {
    shadow[index * 4 + 0],
    shadow[index * 4 + 1],
    shadow[index * 4 + 2],
  };

  if (priority < old) {
    // move this entry up, so move other entries down
    int start = index;
    // while we can check the sprite previous to start...
    while (start > 0) {
      start--;
      if (handlePriority[indexToHandle[start]] <= priority) {
        start++;
        break;
      }
    }

    // check if anything to actually move
    if (start == index) return *this;

    // move entries down to make room for sprite
    int di = index;
    int si = index - 1;
    while (si >= start) {
      oamMove(*this, di, si);
      si--;
      di--;
    }

    // set new slot
    index = start;
  } else {
    // move sprite down, so move entries up
    int end = index + 1;
    // while we can check the sprite at end...
    while (end < totalEntries) {
      if (priority <= handlePriority[indexToHandle[end]]) {
        break;
      }
      end++;
    }

    // check if anything to actually move
    if (end == index + 1) return *this;

    // move entries up to make room for sprite
    int di = index;
    int si = index + 1;
    while (si < end) {
      oamMove(*this, di, si);
      si++;
      di++;
    }

    // set new slot
    index = di;
  }

  // copy buffer into destination slot and overwrite GBA priority
  handleToIndex[handle] = index;
  indexToHandle[index] = handle;
  uint16_t *o = &shadow[index * 4];
  o[0] = buffer[0];
  o[1] = buffer[1];
  o[2] = buffer[2];
  return *this;
}

Oam &Oam::free(int8_t handle) {
  if (handle < 0) return *this;
  int i = handle >> 5;
  uint32_t mask = 1u << (handle & 31);
#ifdef TESTS
  if (handleAvail[i] & mask) {
    log("double free detected\n");
    g_doubleFree = true;
  }
#endif
  handleAvail[i] |= mask;
  totalEntries--;

  int index = handleToIndex[handle];
  while (index < totalEntries) {
    oamMove(*this, index, index + 1);
    index++;
  }
  handleToIndex[handle] = -1;
  indexToHandle[index] = -1;
  index *= 4;
  shadow[index + 0] = 1u << 9; // set OBJ disable
  shadow[index + 1] = 0;
  shadow[index + 2] = 0;
  return *this;
}

int8_t Oam::allocRotate() {
  bool didRetry = false;
retry:
  if (!rotateAvail) return -1;
  int index = ctz32(rotateAvail);
  uint32_t mask = 1u << index;
  if (atomicBitClear(&rotateAvail, mask)) {
    return index;
  } else if (!didRetry) {
    didRetry = true;
    goto retry;
  }
  return -1;
}

bool Oam::isEmptyRotate() {
  return rotateAvail == 0xffffffffu;
}

Oam &Oam::freeRotate(int8_t index) {
  if (index < 0) return *this;
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
  return *this;
}

#ifdef TESTS
static std::mt19937 rng(std::random_device{}());

static int rand(int size) {
  if (size <= 1) return 0;
  return std::uniform_int_distribution<int>(0, size - 1)(rng);
}

static int randomRun() {
  log("testing oam\n");
  Oam oam;

  // generate a list of priorities 0-127 in random order
  uint8_t priority[128];
  for (int i = 0; i < 128; i++) {
    priority[i] = i * 2;
  }
  for (int i = 0; i < 1000; i++) {
    int a = rand(128);
    int b = rand(128);
    if (a != b) {
      int t = priority[a];
      priority[a] = priority[b];
      priority[b] = t;
    }
  }

  // allocate the entries
  int handle[128];
  for (int i = 0; i < 128; i++) {
    handle[i] = oam.alloc(priority[i]);
    if (handle[i] < 0) {
      log("failed to allocate oam entry\n");
      return 1;
    }
  }

  // validate we can't alloc more
  if (oam.alloc(0) >= 0) {
    log("allocated more than 128 handles?\n");
    return 1;
  }

  // validate priorities are correctly set
  for (int i = 0; i < 128; i++) {
    if (oam.priority(handle[i]) != priority[i]) {
      log("failed to persist priority\n");
      return 1;
    }
  }

  // validate priorities are in order
  for (int i = 0; i < 128; i++) {
    int shadowPriority = (oam.shadow[i * 4 + 2] >> 10) & 3;
    int handlePriority = oam.handlePriority[oam.indexToHandle[i]];
    int expectedPriority = i * 2;

    if (shadowPriority != (handlePriority >> 6)) {
      log("shadow priority doesn't match handle priority\n");
      return 1;
    }
    if (handlePriority != expectedPriority) {
      log("handle priority is out of order\n");
      return 1;
    }
  }

  // re-assign random priorities
  for (int i = 0; i < 128; i++) {
    int newPriority = rand(256);
    oam.priority(handle[i], newPriority);
    priority[i] = newPriority;
  }

  // validate priorities are ascending
  for (int i = 0, lastPriority = 0; i < 128; i++) {
    int p = oam.handlePriority[oam.indexToHandle[i]];
    if (p < lastPriority) {
      log("priorities are out of order\n");
      return 1;
    }
    if (i != oam.handleToIndex[oam.indexToHandle[i]]) {
      log("handle to index to handle mapping invalid\n");
      return 1;
    }
    if (((oam.shadow[i * 4 + 2] >> 10) & 3) != (p >> 6)) {
      log("new priority wasn't written to shadow\n");
      return 1;
    }
    if (oam.handlePriority[handle[i]] != priority[i]) {
      log("new priority wasn't saved\n");
      return 1;
    }
    lastPriority = p;
  }

  // free half the handles
  for (int i = 0; i < 64; i++) {
    int hi = rand(128);
    while (handle[hi] < 0) hi = rand(128);
    int h = handle[hi];
    handle[hi] = -1;
    oam.free(h);
  }
  if (oam.totalEntries != 64) {
    log("invalid total entries after free\n");
    return 1;
  }

  // validate priorities are ascending
  for (int i = 0, lastPriority = 0; i < 64; i++) {
    int p = oam.handlePriority[oam.indexToHandle[i]];
    if (p < lastPriority) {
      log("priorities are out of order\n");
      return 1;
    }
    if (i != oam.handleToIndex[oam.indexToHandle[i]]) {
      log("handle to index to handle mapping invalid\n");
      return 1;
    }
    if (((oam.shadow[i * 4 + 2] >> 10) & 3) != (p >> 6)) {
      log("new priority wasn't written to shadow\n");
      return 1;
    }
    lastPriority = p;
  }

  // free everything
  for (int i = 0; i < 128; i++) {
    if (handle[i] >= 0) oam.free(handle[i]);
  }
  if (oam.totalEntries != 0) {
    log("invalid total entries after freeing all\n");
    return 1;
  }
  if (
    oam.handleAvail[0] != 0xffffffffu ||
    oam.handleAvail[1] != 0xffffffffu ||
    oam.handleAvail[2] != 0xffffffffu ||
    oam.handleAvail[3] != 0xffffffffu
  ) {
    log("handle avail is wrong\n");
    return 1;
  }

  int rotateIndex[32];
  for (int i = 0; i < 32; i++) {
    rotateIndex[i] = oam.allocRotate();
    if (rotateIndex[i] < 0) {
      log("failed to alloc rotate\n");
      return 1;
    }
  }
  if (oam.allocRotate() >= 0) {
    log("failed to alloc all rotate slots\n");
    return 1;
  }
  if (oam.rotateAvail != 0) {
    log("failed to flag all rotate slots\n");
    return 1;
  }

  // free them in random order
  for (int i = 0; i < 32; i++) {
    int r = rand(32);
    while (rotateIndex[r] < 0) r = rand(32);
    oam.freeRotate(rotateIndex[r]);
    rotateIndex[r] = -1;
  }
  if (oam.rotateAvail != 0xffffffffu) {
    log("failed to free all rotate slots\n");
    return 1;
  }

  return g_doubleFree ? 1 : 0;
}

int Oam::test(bool verbose) {
  g_verbose = verbose;

  for (int i = 0; i < 100; i++) {
    if (randomRun()) return 1;
  }

  return 0;
}
#endif
