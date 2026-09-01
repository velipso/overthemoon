// SPDX-License-Identifier: 0BSD
#include "Spr.hpp"
#include "util/ctz32.hpp"
#include "util/sin14.hpp"
#include "gba/atomic.hpp"
#include "gba/mem.hpp"
#include <stdlib.h>

#ifdef TESTS
#include <random>
#include <stdio.h>
static bool g_verbose;
static bool g_doubleFree;
#define log(fmt, ...) if (g_verbose) printf(fmt, ##__VA_ARGS__)

// dummy animation data for tests
struct SprEntry;
typedef bool (*f_animFireHandler)(int8_t handle, SprEntry &spr, int param);

namespace AnimData {
  const f_animFireHandler handlers[] = {0};
  const uint8_t *const spritesheets[] = {0};
  const uint32_t jumpAnimations[] = {0};
  const uint16_t data[] = {
    // global STOP and DESTROY
    0x0000, 0x0001,
    // test animation
    0x0000
  };
}

namespace Anim {
  static constexpr uint32_t test = 2;
}
#else
#include "data/animations.hpp"
#define log(fmt, ...)
#endif

static inline u8 sprRand(Spr *spr) {
  spr->seed = spr->seed * 1664525u + 1013904223u;
  return spr->seed >> 24;
}

static inline int sprRand8(Spr *spr, int low, int high) {
  return low + ((sprRand(spr) * (high - low + 1)) >> 8);
}

static inline int sprRand12(Spr *spr, int low, int high) {
  u32 r = (sprRand(spr) << 8) | sprRand(spr);
  return low + ((r * (high - low + 1)) >> 16);
}

static inline int clampU8(int v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

Spr &Spr::reset() {
  for (int i = 0; i < 4; i++) {
    avail[i] = 0xffffffffu;
  }
  for (int i = 0; i < 128; i++) {
    entries[i].oamHandle1(-1);
  }
  seed = 123;
  worldXValue = 0;
  worldYValue = 0;
  if (copyList) {
    ::free(copyList);
    copyList = nullptr;
    copyListSize = copyListTotal = 0;
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
  { 24,  8,  8 }, // a (24)x(8) sprite is an (8)x8 + 16x8
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

int8_t sprAlloc(Spr &spr, int width, int height, uint8_t priority, bool is256, int8_t clone) {
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
    if (spr.avail[i]) {
      int index = ctz32(spr.avail[i]);
      uint32_t mask = 1u << index;
      if (atomicBitClear(&spr.avail[i], mask)) {
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

  oamHandle1 = spr.oam.alloc(priority);
  if (oamHandle1 < 0) goto fail;
  if (clone >= 0) {
    vramObjHandle1 = spr.entries[clone].vramObjHandle1();
  } else {
    vramObjHandle1 = spr.vramObj.alloc(w1, h1, is256);
    if (vramObjHandle1 < 0) goto fail;
  }
  if (w2) {
    oamHandle2 = spr.oam.alloc(priority);
    if (oamHandle2 < 0) goto fail;
    if (clone >= 0) {
      vramObjHandle2 = spr.entries[clone].vramObjHandle2();
    } else {
      vramObjHandle2 = spr.vramObj.alloc(w2, h2, is256);
      if (vramObjHandle2 < 0) goto fail;
    }
  }

  // everything allocated!
  spr.entries[handle]
    .pc(0)
    .flags(0)
    .clone(clone >= 0)
    .repeat(0)
    .spritesheet(0)
    .stackedWidth(stackedWidth)
    .oamHandle1(oamHandle1)
    .oamHandle2(oamHandle2)
    .vramObjHandle1(vramObjHandle1)
    .vramObjHandle2(vramObjHandle2)
    .gravity(0)
    .localX(0)
    .localY(0)
    .localDX(0)
    .localDY(0)
    .originX(0)
    .originY(0)
    .rotateOriginX(0)
    .rotateOriginY(0)
    .rotateAngle(0)
    .rotateFlags(0);

  return handle;
fail:
  spr.oam.free(oamHandle1);
  spr.oam.free(oamHandle2);
  spr.vramObj.free(vramObjHandle1);
  spr.vramObj.free(vramObjHandle2);
  spr.avail[handle >> 5] |= 1 << (handle & 0x1f);
  return -1;
}

int8_t Spr::alloc(int width, int height, uint8_t priority, bool is256) {
  return sprAlloc(*this, width, height, priority, is256, -1);
}

int8_t Spr::clone(int8_t handle) {
  return sprAlloc(*this, width(handle), height(handle), priority(handle), is256(handle), handle);
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
  if (!e.clone()) {
    vramObj.free(e.vramObjHandle1());
    vramObj.free(e.vramObjHandle2());
  }
  e.oamHandle1(-1); // flag as unallocated
  avail[i] |= mask;
  return *this;
}

int Spr::tileWidth(int8_t handle) {
  SprEntry &entry = entries[handle];
  int result = vramObj.tileWidth(entry.vramObjHandle1());
  if (entry.vramObjHandle2() >= 0 && entry.stackedWidth()) {
    result += vramObj.tileWidth(entry.vramObjHandle2());
  }
  return result;
}

int Spr::tileHeight(int8_t handle) {
  SprEntry &entry = entries[handle];
  int result = vramObj.tileHeight(entry.vramObjHandle1());
  if (entry.vramObjHandle2() >= 0 && !entry.stackedWidth()) {
    result += vramObj.tileHeight(entry.vramObjHandle2());
  }
  return result;
}

Spr &Spr::queueCopyTiles(int8_t handle, const uint8_t *src) {
  if (copyListSize >= copyListTotal) {
    copyListTotal <<= 1;
    if (copyListTotal < 16) {
      copyListTotal = 16;
    }
    copyList = (SprCopy *)realloc((void *)copyList, sizeof(SprCopy) * copyListTotal);
  }
  copyList[copyListSize].handle = handle;
  copyList[copyListSize].src = src;
  copyListSize++;
  return *this;
}

Spr &Spr::copyTiles(int8_t handle, const uint8_t *src) {
  SprEntry &e = entries[handle];
  if (e.oamHandle2() >= 0) {
    // double entry
    if (e.stackedWidth()) {
      // erp... have to split up the copy across the two widths
      volatile uint8_t *dst1 = (volatile uint8_t *)VramObj::addr(e.vramObjHandle1());
      int tw1 = VramObj::tileWidth(e.vramObjHandle1());
      int th = VramObj::tileHeight(e.vramObjHandle1());
      volatile uint8_t *dst2 = (volatile uint8_t *)VramObj::addr(e.vramObjHandle2());
      int tw2 = VramObj::tileWidth(e.vramObjHandle2());
      if (VramObj::is256(e.vramObjHandle1())) {
        for (int y = 0; y < th; y++) {
          for (int x = 0; x < tw1; x++) {
            memcpy64bytes((void *)dst1, src);
            src += 64;
            dst1 += 64;
          }
          for (int x = 0; x < tw2; x++) {
            memcpy64bytes((void *)dst2, src);
            src += 64;
            dst2 += 64;
          }
        }
      } else {
        for (int y = 0; y < th; y++) {
          for (int x = 0; x < tw1; x++) {
            memcpy32bytes((void *)dst1, src);
            src += 32;
            dst1 += 32;
          }
          for (int x = 0; x < tw2; x++) {
            memcpy32bytes((void *)dst2, src);
            src += 32;
            dst2 += 32;
          }
        }
      }
    } else {
      // stacked height, so just copy them back to back
      VramObj::copy(e.vramObjHandle1(), src);
      VramObj::copy(e.vramObjHandle2(), src + VramObj::bytes(e.vramObjHandle1()));
    }
  } else {
    // single entry, copy directly
    VramObj::copy(e.vramObjHandle1(), src);
  }
  return *this;
}

Spr &Spr::flushQueue() {
  for (int i = 0; i < copyListSize; i++) {
    copyTiles(copyList[i].handle, copyList[i].src);
  }
  copyListSize = 0;
  return *this;
}

Spr &Spr::tick() {
  for (int handle = 0; handle < 128; handle++) {
    SprEntry &e = entries[handle];
    if (e.oamHandle1() < 0) continue;
    int randomState = 0; // unused, randomU8, randomI8, randomI12
    u32 randomLow = 0;

    // step through animation
    if (e.localDX() || e.localDY()) {
      e.localX(e.localX() + e.localDX());
      e.localY(e.localY() + e.localDY());
      e.xyDirty(1);
    }
    if (e.gravityAxisX()) {
      e.localDX(e.localDX() + e.gravity());
    } else {
      e.localDY(e.localDY() + e.gravity());
    }
    if (e.wait() > 0) {
      e.wait(e.wait() - 1);
      goto flush_entity;
    }
    if (e.pc() == 0) {
      goto flush_entity;
    }

    for (;;) {
      u32 cmd = AnimData::data[e.pc()];
      i32 param = cmd & 0x0fff;
      cmd >>= 12;
      if (randomState == 3) { // RANDOMI12
        randomState = 0;
        if (param >= 2048) param -= 4096;
        param = sprRand12(this, randomLow, param);
      }
      switch (cmd) {
        case 0x0: {
          cmd = param >> 8;
          param &= 0xff;
          if (randomState == 1) { // RANDOMU8
            randomState = 0;
            param = sprRand8(this, randomLow, param);
          } else if (randomState == 2) { // RANDOMI8
            randomState = 0;
            if (param >= 128) param -= 256;
            param = sprRand8(this, randomLow, param);
          }
          switch (cmd) {
            case 0x0: {
              cmd = param >> 4;
              param &= 0xf;
              switch (cmd) {
                case 0x0: {
                  switch (param) {
                    // no params
                    case 0x0: // STOP
                      e.pc(0);
                      goto flush_entity;
                    case 0x1: // DESTROY
                      Spr::free(handle);
                      goto next_entity;
                    case 0x2: // VISIBLEON
                      // TODO: handle rotation sprites
                      oam.show(e.oamHandle1(), true);
                      if (e.oamHandle2() >= 0) {
                        oam.show(e.oamHandle2(), true);
                      }
                      break;
                    case 0x3: // VISIBLEOFF
                      // TODO: handle rotation sprites
                      oam.show(e.oamHandle1(), false);
                      if (e.oamHandle2() >= 0) {
                        oam.show(e.oamHandle2(), false);
                      }
                      break;
                    case 0x4: // WORLDON
                      e.worldSpace(1);
                      e.xyDirty(1);
                      break;
                    case 0x5: // WORLDOFF
                      e.worldSpace(0);
                      e.xyDirty(1);
                      break;
                    case 0x6: // GRAVXON
                      e.gravityAxisX(1);
                      break;
                    case 0x7: // GRAVXOFF
                      e.gravityAxisX(0);
                      break;
                    case 0x8: // MOSAICON
                      oam.mosaic(e.oamHandle1(), true);
                      if (e.oamHandle2() >= 0) {
                        oam.mosaic(e.oamHandle2(), true);
                      }
                      break;
                    case 0x9: // MOSAICOFF
                      oam.mosaic(e.oamHandle1(), false);
                      if (e.oamHandle2() >= 0) {
                        oam.mosaic(e.oamHandle2(), false);
                      }
                      break;
                    case 0xa: // HFLIPON
                      if (e.rotateAlloc()) {
                        e.rotateHFlip(1);
                        e.xyDirty(1);
                        e.angDirty(1);
                      } else {
                        oam.hFlip(e.oamHandle1(), true);
                        if (e.oamHandle2() >= 0) {
                          oam.hFlip(e.oamHandle2(), true);
                          e.xyDirty(1);
                        }
                      }
                      break;
                    case 0xb: // HFLIPOFF
                      if (e.rotateAlloc()) {
                        e.rotateHFlip(0);
                        e.xyDirty(1);
                        e.angDirty(1);
                      } else {
                        oam.hFlip(e.oamHandle1(), false);
                        if (e.oamHandle2() >= 0) {
                          oam.hFlip(e.oamHandle2(), false);
                          e.xyDirty(1);
                        }
                      }
                      break;
                    case 0xc: // VFLIPON
                      if (e.rotateAlloc()) {
                        e.rotateVFlip(1);
                        e.xyDirty(1);
                        e.angDirty(1);
                      } else {
                        oam.vFlip(e.oamHandle1(), true);
                        if (e.oamHandle2() >= 0) {
                          oam.vFlip(e.oamHandle2(), true);
                          e.xyDirty(1);
                        }
                      }
                      break;
                    case 0xd: // VFLIPOFF
                      if (e.rotateAlloc()) {
                        e.rotateVFlip(0);
                        e.xyDirty(1);
                        e.angDirty(1);
                      } else {
                        oam.vFlip(e.oamHandle1(), false);
                        if (e.oamHandle2() >= 0) {
                          oam.vFlip(e.oamHandle2(), false);
                          e.xyDirty(1);
                        }
                      }
                      break;
                    case 0xe: // ANGOFF
                      if (e.rotateAlloc()) {
                        oam.freeRotate(e.rotateIndex());
                        e.rotateFlags(0);
                      }
                      break;
                    case 0xf: break; // reserved
                  }
                  break;
                }
                case 0x1: break; // reserved
                case 0x2: {
                  switch (param) {
                    // no params
                    case 0x0: // ISTRUE
                      e.jumpCondition(1);
                      break;
                    case 0x1: // ISREPEAT
                      if (e.repeat() > 0) {
                        e.jumpCondition(1);
                        e.repeat(e.repeat() - 1);
                      } else {
                        e.jumpCondition(0);
                      }
                      break;
                    case 0x2: // ISCLONE
                      e.jumpCondition(e.clone());
                      break;
                    case 0x3: // ISVISIBLE
                      // TODO: oam.show is invalid for rotation sprites
                      e.jumpCondition(oam.show(e.oamHandle1()) ? 1 : 0);
                      break;
                    case 0x4: // ISWORLD
                      e.jumpCondition(e.worldSpace());
                      break;
                    case 0x5: // ISGRAVX
                      e.jumpCondition(e.gravityAxisX());
                      break;
                    case 0x6: // ISROTATED
                      e.jumpCondition(e.rotateAlloc());
                      break;
                    case 0x7: // ISFIRERES
                      e.jumpCondition(e.fireResult());
                      break;
                    case 0x8: // ISMOSAIC
                      e.jumpCondition(oam.mosaic(e.oamHandle1()) ? 1 : 0);
                      break;
                    case 0x9: // ISHFLIP
                      e.jumpCondition(e.rotateAlloc()
                        ? e.rotateHFlip()
                        : (oam.hFlip(e.oamHandle1()) ? 1 : 0));
                      break;
                    case 0xa: // ISVFLIP
                      e.jumpCondition(e.rotateAlloc()
                        ? e.rotateVFlip()
                        : (oam.vFlip(e.oamHandle1()) ? 1 : 0));
                      break;
                    case 0xb: // ...reserved
                    case 0xc:
                    case 0xd:
                    case 0xe:
                    case 0xf: break;
                  }
                  break;
                }
                case 0x3: break; // reserved
                // 4-bit params
                case 0x4: // MODE
                  oam.mode(e.oamHandle1(), param);
                  if (e.oamHandle2() >= 0) {
                    oam.mode(e.oamHandle2(), param);
                  }
                  break;
                case 0x5: // ISMODE
                  e.jumpCondition(oam.mode(e.oamHandle1()) == param ? 1 : 0);
                  break;
                case 0x6: // WAIT
                  e.wait(param);
                  goto flush_entity;
                case 0x7: // REPEAT
                  e.repeat(clampU8(e.repeat() + param + 1));
                  break;
                case 0x8: // ...reserved
                case 0x9:
                case 0xa:
                case 0xb:
                case 0xc:
                case 0xd:
                case 0xe:
                case 0xf: break;
              }
              break;
            }
            // 8-bit params
            case 0x1: // RANDOMU8
              randomState = 1;
              randomLow = param;
              break;
            case 0x2: // RANDOMI8
              randomState = 2;
              if (param >= 128) param -= 256;
              randomLow = param;
              break;
            case 0x3: // SPRSHEET
              e.spritesheet(param);
              break;
            case 0x4: // COPY
              queueCopyTiles(handle, AnimData::spritesheets[param]);
              break;
            case 0x5: // JUMPANIM
              e.pc(AnimData::jumpAnimations[param] - 1);
              break;
            case 0x6: // ISRANDOM
              e.jumpCondition(sprRand(this) < param ? 1 : 0);
              break;
            case 0x7: // PRIORITYSET
              oam.priority(e.oamHandle1(), param);
              if (e.oamHandle2() >= 0) {
                oam.priority(e.oamHandle2(), param);
              }
              break;
            case 0x8: // PRIORITYADD
              if (param >= 128) param -= 256;
              param += oam.priority(e.oamHandle1());
              param = clampU8(param);
              oam.priority(e.oamHandle1(), param);
              if (e.oamHandle2() >= 0) {
                oam.priority(e.oamHandle2(), param);
              }
              break;
            case 0x9: // ROTATEOX
              if (param >= 128) param -= 256;
              e.rotateOriginX(param);
              e.angDirty(1);
              break;
            case 0xa: // ROTATEOY
              if (param >= 128) param -= 256;
              e.rotateOriginY(param);
              e.angDirty(1);
              break;
            case 0xb: // ANGSET
              while (param < 0) param += 120;
              while (param >= 120) param -= 120;
              e.rotateAngle(param);
              e.angDirty(1);
              // TODO: allocate rotate slot
              break;
            case 0xc: // ANGADD
              if (param >= 128) param -= 256;
              param += e.rotateAngle();
              while (param < 0) param += 120;
              while (param >= 120) param -= 120;
              e.rotateAngle(param);
              e.angDirty(1);
              // TODO: allocate rotate slot
              break;
            case 0xd: // ...reserved
            case 0xe:
            case 0xf: break;
          }
          break;
        }
        // 12-bit params
        case 0x1: // RANDOMI12
          randomState = 3;
          if (param >= 2048) param -= 4096;
          randomLow = param;
          break;
        case 0x2: // GRAVSET
          if (param >= 2048) param -= 4096;
          e.gravity(param);
          break;
        case 0x3: // GRAVADD
          if (param >= 2048) param -= 4096;
          e.gravity(e.gravity() + param);
          break;
        case 0x4: // LOCXSET
          if (param >= 2048) param -= 4096;
          e.localX(param << 4);
          e.xyDirty(1);
          break;
        case 0x5: // LOCXADD
          if (param >= 2048) param -= 4096;
          e.localX(e.localX() + (param << 4));
          e.xyDirty(1);
          break;
        case 0x6: // LOCYSET
          if (param >= 2048) param -= 4096;
          e.localY(param << 4);
          e.xyDirty(1);
          break;
        case 0x7: // LOCYADD
          if (param >= 2048) param -= 4096;
          e.localY(e.localY() + (param << 4));
          e.xyDirty(1);
          break;
        case 0x8: // LOCDXSET
          if (param >= 2048) param -= 4096;
          e.localDX(param << 4);
          break;
        case 0x9: // LOCDXADD
          if (param >= 2048) param -= 4096;
          e.localDX(e.localDX() + (param << 4));
          break;
        case 0xa: // LOCDYSET
          if (param >= 2048) param -= 4096;
          e.localDY(param << 4);
          break;
        case 0xb: // LOCDYADD
          if (param >= 2048) param -= 4096;
          e.localDY(e.localDY() + (param << 4));
          break;
        case 0xc: break; // reserved
        case 0xd: // FIRE
          e.fireResult(AnimData::handlers[param & 0xff](handle, e, (param << 20) >> 28) ? 1 : 0);
          break;
        case 0xe: // JUMPTRUE
          if (e.jumpCondition()) {
            if (param >= 2048) param -= 4096;
            e.pc(e.pc() + param - 1);
          }
          break;
        case 0xf: // JUMPFALSE
          if (!e.jumpCondition()) {
            if (param >= 2048) param -= 4096;
            e.pc(e.pc() + param - 1);
          }
          break;
      }

      // advance PC
      e.pc(e.pc() + 1);
    }
    flush_entity:
    if (e.xyDirty()) {
      e.xyDirty(0);
      int x = 240;
      int y = 160;
      if (e.rotateAlloc()) {
        // sprite has rotation
        /*
        int sx, sy, dx1, dy1;
        switch (spr->vram.size) {
          case OAM_8X8  : sx =  8; sy =  8; goto xyrot1;
          case OAM_16X16: sx = 16; sy = 16; goto xyrot1;
          case OAM_32X32: sx = 32; sy = 32; goto xyrot1;
          case OAM_64X64: sx = 64; sy = 64; goto xyrot1;
          case OAM_16X8 : sx = 16; sy =  8; goto xyrot1;
          case OAM_32X8 : sx = 32; sy =  8; goto xyrot1;
          case OAM_32X16: sx = 32; sy = 16; goto xyrot1;
          case OAM_64X32: sx = 64; sy = 32; goto xyrot1;
          case OAM_8X16 : sx =  8; sy = 16; goto xyrot1;
          case OAM_8X32 : sx =  8; sy = 32; goto xyrot1;
          case OAM_16X32: sx = 16; sy = 32; goto xyrot1;
          case OAM_32X64: sx = 32; sy = 64; goto xyrot1;
          case OAM_64X16:
            sx = 32;
            sy = 16;
            // try to remove gaps on rotation
            dx1 =
              spr->rotate.ang ==  0 ||
              spr->rotate.ang == 30 ||
              spr->rotate.ang == 60 ? 32 : 31;
            dy1 = 0;
            goto xyrot2;
          case OAM_16X64:
            sx = 16;
            sy = 32;
            dx1 = 0;
            // try to remove gaps on rotation
            dy1 =
              spr->rotate.ang ==  0 ||
              spr->rotate.ang == 60 ||
              spr->rotate.ang == 90 ? 32 : 31;
            goto xyrot2;
        }
        goto xyrot_done;

xyrot1:;
        // handle rotation for single OAM sprites
        if (!(spr->flags & SPR_FLAG_HIDE)) {
          if (spr->flags & SPR_FLAG_WORLD) {
            x = -g_spr_worldX;
            y = -g_spr_worldY;
          } else {
            x = y = 0;
          }
          x += spr->origin.x + (spr->offset.x >> 8);
          y += spr->origin.y + (spr->offset.y >> 8);
          // adjust x,y based on rotation angle and rotation origin
          int PA = sin14[spr->rotate.ang + 30]; // cos(ang);
          int PB = sin14[spr->rotate.ang];
          int PC = -PB;
          int PD = PA;

          int dx = spr->rotate.ox - (sx >> 1);
          int dy = spr->rotate.oy - (sy >> 1);
          int rx = (PA * dx - PB * dy) >> 14;
          int ry = (PD * dy - PC * dx) >> 14;

          x -= rx + sx - spr->rotate.ox;
          y -= ry + sy - spr->rotate.oy;
        }
        if (x < -64 || x > SCREEN_W) x = SCREEN_W;
        if (y < -64 || y > SCREEN_H) y = SCREEN_H;
        oam[0] = (y & 0x00ff) | (oam[0] & 0xff00);
        oam[1] = (x & 0x01ff) | (oam[1] & 0xfe00);
        goto xyrot_done;

xyrot2:;
        // handle rotation for double OAM sprites
        if (!(spr->flags & SPR_FLAG_HIDE)) {
          if (spr->flags & SPR_FLAG_WORLD) {
            x = -g_spr_worldX;
            y = -g_spr_worldY;
          } else {
            x = y = 0;
          }
          x += spr->origin.x + (spr->offset.x >> 8);
          y += spr->origin.y + (spr->offset.y >> 8);
          // adjust x,y based on rotation angle and rotation origin
          int PA = sin14[spr->rotate.ang + 30]; // cos(ang);
          int PB = sin14[spr->rotate.ang];
          int PC = -PB;
          int PD = PA;

          int dx = spr->rotate.ox - (sx >> 1);
          int dy = spr->rotate.oy - (sy >> 1);
          int rx = (PA * dx - PB * dy) >> 14;
          int ry = (PD * dy - PC * dx) >> 14;

          x -= rx + sx - spr->rotate.ox;
          y -= ry + sy - spr->rotate.oy;

          // rotate second OAM offset
          rx = (PA * dx1 - PB * dy1) >> 14;
          ry = (PD * dy1 - PC * dx1) >> 14;
          dx1 = rx;
          dy1 = ry;
        }

        int ox = x, oy = y;
        if (ox < -64 || ox > SCREEN_W) ox = SCREEN_W;
        if (oy < -64 || oy > SCREEN_H) oy = SCREEN_H;
        oam[0] = (oy & 0x00ff) | (oam[0] & 0xff00);
        oam[1] = (ox & 0x01ff) | (oam[1] & 0xfe00);
        x += dx1;
        y += dy1;
        if (x < -64 || x > SCREEN_W) x = SCREEN_W;
        if (y < -64 || y > SCREEN_H) y = SCREEN_H;
        oam[4] = (y & 0x00ff) | (oam[4] & 0xff00);
        oam[5] = (x & 0x01ff) | (oam[5] & 0xfe00);
        goto xyrot_done;

xyrot_done:;
        */
      } else {
        // sprite does not have rotation
        if (oam.show(e.oamHandle1())) {
          if (e.worldSpace()) {
            x = -worldXValue;
            y = -worldYValue;
          } else {
            x = y = 0;
          }
          x += e.originX() + (e.localX() >> 8);
          y += e.originY() + (e.localY() >> 8);
          if (x < -64 || x > 240) {
            x = 240;
          }
          if (y < -64 || y > 160) {
            y = 160;
          }
        }
        oam.x(e.oamHandle1(), x).y(e.oamHandle1(), y);
        if (e.oamHandle2() >= 0) {
          if (e.stackedWidth()) {
            x += oam.width(e.oamHandle1());
            if (x > 240) x = 240;
          } else {
            y += oam.height(e.oamHandle1());
            if (y > 160) y = 160;
          }
          oam.x(e.oamHandle2(), x).y(e.oamHandle2(), y);
        }
      }
    }
    if (e.angDirty()) {
      e.angDirty(0);
      int cos = sin14[e.rotateAngle() + 30] >> 6; // cos(ang);
      int sin = sin14[e.rotateAngle()] >> 6;
      oam.PABCD(e.rotateIndex(), cos, sin, -sin, cos);
    }
    next_entity:;
  }
  return *this;
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
