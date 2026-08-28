// SPDX-License-Identifier: 0BSD
#include "VramObj.hpp"
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

VramObj &VramObj::reset() {
  for (int i = 0; i < 32; i++) {
    avail[i] = 0xffffffffu;
  }
  return *this;
}

VramObj &VramObj::resetBitmap() {
  int i = 0;
  for (; i < 16; i++) {
    avail[i] = 0;
  }
  for (; i < 32; i++) {
    avail[i] = 0xffffffffu;
  }
  return *this;
}

bool VramObj::isEmpty() {
  for (int i = 0; i < 32; i++) {
    if (avail[i] != 0xffffffffu) return false;
  }
  return true;
}

bool VramObj::isEmptyBitmap() {
  for (int i = 16; i < 32; i++) {
    if (avail[i] != 0xffffffffu) return false;
  }
  return true;
}

bool VramObj::isFull() {
  for (int i = 0; i < 32; i++) {
    if (avail[i]) return false;
  }
  return true;
}

static inline void setAvail(uint32_t *avail, int i, uint32_t mask) {
#ifdef TESTS
  if (avail[i] & mask) {
    log("double free detected\n");
    g_doubleFree = true;
  }
#endif
  avail[i] |= mask;
}

template <typename F>
static inline int scanBits(int pos, int slots, F &&func) {
  while (slots) {
    int i = pos >> 5;
    int b = pos & 0x1f;
    int n = slots < 32 - b ? slots : 32 - b;
    uint32_t m = n == 32 ? 0xffffffffu : ((1u << n) - 1) << b;
    if (!func(i, m)) return pos;
    pos += n;
    slots -= n;
  }
  return -1;
}

int16_t VramObj::alloc(int slots, int mask) {
  bool is256 = VramObj::is256(mask);
  bool didRetry = false;
retry:
  for (int w = 0; w < 32; w++) {
    uint32_t bits = avail[w];
    while (bits) {
      // find next available 1 bit
      int start = (w << 5) + ctz32(bits);
      bits &= bits - 1; // trick to clear the lowest 1
      if (is256 && (start & 1)) continue; // if 256 color, tiles must be aligned to 2
      if (start + slots > 1024) return -1; // not enough space, so don't bother

      // see if we can find 'slots' bits available
      if (scanBits(start, slots, [&](int i, uint32_t m) {
        // if all bits in m are set, then keep going
        return (avail[i] & m) == m;
      }) >= 0) {
        // found bits that weren't set, so try next 1 in bits
        continue;
      }

      // go through same area and clear the bits
      int pos = scanBits(start, slots, [&](int i, uint32_t m) {
        // clear the bits atomically
        return atomicBitClear(&avail[i], m);
      });
      if (pos >= 0) {
        // failed to clear bits, so rollback the ones we already cleared
        scanBits(start, pos - start, [&](int i, uint32_t m) {
          setAvail(avail, i, m);
          return true;
        });
        if (!didRetry) {
          didRetry = true;
          goto retry;
        }
        return -1;
      }
      return mask | start;
    }
  }
  return -1;
}

VramObj &VramObj::free(int16_t handle) {
  if (handle < 0) return *this;
  int tw = VramObj::tileWidth(handle);
  int th = VramObj::tileHeight(handle);
  int size = tw * th;
  if (VramObj::is256(handle)) size <<= 1;
  int pos = VramObj::tile(handle);
  scanBits(pos, size, [&](int i, uint32_t m) {
    setAvail(avail, i, m);
    return true;
  });
  return *this;
}

#ifdef TESTS
static std::mt19937 rng(std::random_device{}());

static int rand(int size) {
  if (size <= 1) return 0;
  return std::uniform_int_distribution<int>(0, size - 1)(rng);
}

static int randomRun() {
  VramObj vram;

  int handles[1025];
  int size = 0;
  int widthHeight[] = { 8, 16, 32, 64 };

  // allocate random sized objects until we fail
  for (;;) {
    int width = widthHeight[rand(4)];
    int height = widthHeight[rand(4)];
    if (!VramObj::validSize(width, height)) continue;
    bool is256 = rand(2);
    int handle = is256
      ? vram.alloc256(width, height)
      : vram.alloc16(width, height);
    if (handle < 0) break;
    if (is256 && (VramObj::tile(handle) & 1)) {
      log("cannot have odd tile for 8bpp allocation\n");
      return 1;
    }
    if (
      VramObj::width(handle) != width ||
      VramObj::height(handle) != height ||
      VramObj::is256(handle) != is256
    ) {
      log("handle failed to encode settings\n");
      return 1;
    }
    handles[size++] = handle;
  }

  // fill all the remaining gaps
  while (!vram.isFull()) {
    int handle = vram.alloc16(8, 8);
    if (handle < 0) {
      log("isFull was false, but can't allocate 8x8 4bpp\n");
      return 1;
    }
    handles[size++] = handle;
  }

  log("allocated %d items\n", size);

  // shuffle items
  for (int i = 0; i < 1000; i++) {
    int a = rand(size);
    int b = rand(size);
    if (a != b) {
      int h = handles[a];
      handles[a] = handles[b];
      handles[b] = h;
    }
  }

  // free items in random order
  for (int i = 0; i < size; i++) {
    vram.free(handles[i]);
  }

  // verify we're now empty
  if (!vram.isEmpty()) {
    log("failed to free all items\n");
    return 1;
  }

  return 0;
}

int VramObj::test(bool verbose) {
  g_verbose = verbose;
  g_doubleFree = false;

  for (int is256 = 0; is256 < 2; is256++) {
    for (int h = 8; h <= 64; h *= 2) {
      for (int w = 8; w <= 64; w *= 2) {
        if (!VramObj::validSize(w, h)) continue;
        VramObj vram;
        int count = 1024 / (((w >> 3) * (h >> 3)) * (is256 ? 2 : 1));
        log("allocating %dx%d %s %d times\n", w, h, is256 ? "8bpp" : "4bpp", count);
        for (int i = 0; i < count; i++) {
          if ((is256 ? vram.alloc256(w, h) : vram.alloc16(w, h)) < 0) {
            log("failed to alloc %dx%d %s\n", w, h, is256 ? "8bpp" : "4bpp");
            return 1;
          }
        }
        if (!vram.isFull()) {
          log("vram isn't full when it should be for %dx%d %s\n", w, h, is256 ? "8bpp" : "4bpp");
          return 1;
        }
      }
    }
  }

  for (int i = 0; i < 100; i++) {
    if (randomRun()) return 1;
  }

  return g_doubleFree ? 1 : 0;
}
#endif
