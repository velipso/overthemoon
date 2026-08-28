// SPDX-License-Identifier: 0BSD
#include "Spr.hpp"
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

Spr &Spr::reset() {
  for (int i = 0; i < 4; i++) {
    avail[i] = 0xffffffffu;
  }
  return *this;
}

const struct {
  uint8_t fullW;
  uint8_t fullH;
  uint8_t smallW;
} spriteSizes[] = {
  // regular, single OAM entry sizes
  // this table is compact because we can calculate the missing dimensions with the info provided
  {  8,  8,  8 },
  { 16, 16, 16 },
  { 32, 32, 32 }, // a (32)x(32) sprite is (32)x32
  { 64, 64, 64 },
  {  8, 16,  8 },
  {  8, 32,  8 },
  { 16, 32, 16 },
  { 32, 64, 32 },

  // synthetic sizes made by combining two OAM entries
  { 24,  8,  8 }, // a (24)x(8) sprite is a (8)x8 + 16x8
  { 40,  8,  8 },
  { 48,  8, 16 },
  { 64,  8, 32 },

  { 24, 16,  8 },
  { 40, 16,  8 },
  { 48, 16, 16 },
  { 64, 16, 32 },

  { 24, 32,  8 },
  { 40, 32,  8 },
  { 48, 32, 16 }, // a (48)x(32) sprite is a (16)x32 + 32x32
  { 72, 32,  8 },
  { 80, 32, 16 },
  { 96, 32, 32 },
  {128, 32, 64 },

  { 96, 64, 32 },
  {128, 64, 64 },

  {  0,  0,  0 },
  {  0,  0,  0 },
  {  0,  0,  0 }, // extra entries to align to 4 bytes
};

int8_t Spr::alloc(int width, int height, uint8_t priority, bool is256) {
  // find sprite size entry for these dimensions
  int w1, h1, w2, h2;
  for (int i = 0; spriteSizes[i].fullW; i++) {
    if (spriteSizes[i].fullW == width && spriteSizes[i].fullH == height) {
      // direct match
      w1 = spriteSizes[i].smallW;
      h1 = spriteSizes[i].fullH;
      w2 = spriteSizes[i].fullW - spriteSizes[i].smallW;
      h2 = w2 ? spriteSizes[i].fullH : 0;
      goto found_sizes;
    } else if (spriteSizes[i].fullH == width && spriteSizes[i].fullW == height) {
      // match with swapped x/y
      h1 = spriteSizes[i].smallW;
      w1 = spriteSizes[i].fullH;
      h2 = spriteSizes[i].fullW - spriteSizes[i].smallW;
      w2 = h2 ? spriteSizes[i].fullH : 0;
      goto found_sizes;
    }
  }
  return -1;
found_sizes:

  int8_t handle = -1;
  bool didRetry = false;
retry:
  for (int i = 0; i < 4; i++) {
    if (avail[i]) {
      int index = ctz32(avail[i]);
      uint32_t mask = 1u << index;
      if (atomicBitClear(&avail[i], mask)) {
        handle = (i << 5) + index;
        break;
      } else if (!didRetry) {
        didRetry = true;
        goto retry;
      }
    }
  }
  if (handle < 0) return -1;

  int8_t oamHandle1 = -1;
  int8_t oamHandle2 = -1;
  int16_t vramObjHandle1 = -1;
  int16_t vramObjHandle2 = -1;
  bool stackedWidth = height == h2;

  oamHandle1 = oam.alloc(priority);
  if (oamHandle1 < 0) goto fail;
  vramObjHandle1 = vramObj.alloc(w1, h1, is256);
  if (vramObjHandle1 < 0) goto fail;
  if (w2) {
    oamHandle2 = oam.alloc(priority);
    if (oamHandle2 < 0) goto fail;
    vramObjHandle2 = vramObj.alloc(w2, h2, is256);
    if (vramObjHandle2 < 0) goto fail;
  }

  // everything allocated!
  entries[handle]
    .pc(0)
    .wait(0)
    .loop(0)
    .sheet(0)
    .flags(0)
    .xyDirty(1)
    .stackedWidth(stackedWidth)
    .oamHandle1(oamHandle1)
    .oamHandle2(oamHandle2)
    .vramObjHandle1(vramObjHandle1)
    .vramObjHandle2(vramObjHandle2)
    .gravity(0)
    .offsetX(0)
    .offsetY(0)
    .offsetDX(0)
    .offsetDY(0)
    .originX(0)
    .originY(0)
    .rotateOriginX(0)
    .rotateOriginY(0)
    .rotateAngle(0)
    .rotateFlags(0);

  return handle;
fail:
  oam.free(oamHandle1);
  oam.free(oamHandle2);
  vramObj.free(vramObjHandle1);
  vramObj.free(vramObjHandle2);
  avail[handle >> 5] |= 1 << (handle & 0x1f);
  return -1;
}

bool Spr::isEmpty() {
  for (int i = 0; i < 4; i++) {
    if (avail[i] != 0xffffffffu) return false;
  }
  return true;
}

Spr &Spr::free(int8_t handle) {
  if (handle < 0) return *this;
  int i = handle >> 5;
  uint32_t mask = 1u << (handle & 31);
#ifdef TESTS
  if (avail[i] & mask) {
    log("double free detected\n");
    g_doubleFree = true;
  }
#endif
  SprEntry &e = entries[handle];
  if (e.rotateAlloc()) {
    oam.freeRotate(e.rotateIndex());
  }
  oam.free(e.oamHandle1());
  oam.free(e.oamHandle2());
  vramObj.free(e.vramObjHandle1());
  vramObj.free(e.vramObjHandle2());
  avail[i] |= mask;
  return *this;
}

int Spr::width(int8_t handle) {
  SprEntry &entry = entries[handle];
  int result = vramObj.width(entry.vramObjHandle1());
  if (entry.vramObjHandle2() >= 0 && entry.stackedWidth()) {
    result += vramObj.width(entry.vramObjHandle2());
  }
  return result;
}

int Spr::height(int8_t handle) {
  SprEntry &entry = entries[handle];
  int result = vramObj.height(entry.vramObjHandle1());
  if (entry.vramObjHandle2() >= 0 && !entry.stackedWidth()) {
    result += vramObj.height(entry.vramObjHandle2());
  }
  return result;
}

#ifdef TESTS
static std::mt19937 rng(std::random_device{}());

static int rand(int size) {
  if (size <= 1) return 0;
  return std::uniform_int_distribution<int>(0, size - 1)(rng);
}

int Spr::test(bool verbose) {
  Oam oam;
  VramObj vramObj;
  Spr spr(oam, vramObj);
  for (int i = 0; spriteSizes[i].fullW; i++) {
    int w = spriteSizes[i].fullW;
    int h = spriteSizes[i].fullH;
    int handle = spr.alloc(w, h, 0, true);
    if (handle < 0) {
      log("failed to allocate %dx%d\n", w, h);
      return 1;
    }
    if (spr.width(handle) != w || spr.height(handle) != h) {
      log("created sprite has wrong dimensions\n");
      return 1;
    }
    spr.free(handle);
  }
  if (!spr.isEmpty() || !vramObj.isEmpty() || !oam.isEmpty()) {
    log("failed to free resources\n");
    return 1;
  }
  return 0;
}
#endif
