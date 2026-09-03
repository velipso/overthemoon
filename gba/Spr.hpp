// SPDX-License-Identifier: 0BSD
#pragma once
#include "Oam.hpp"
#include "VramObj.hpp"
#include "types/gba/Spr.hpp"
#include <stdint.h>

struct SprCopy {
  int handle;
  const uint8_t *src;
};

struct Spr {
  Oam &oam;
  VramObj &vramObj;
  uint32_t avail[4];
  SprEntry entries[128];
  u32 seed;
  int worldXValue;
  int worldYValue;
  SprCopy *copyList;
  int copyListSize;
  int copyListTotal;

  Spr &reset();
  Spr(Oam &oam, VramObj &vramObj) : oam(oam), vramObj(vramObj), copyList(nullptr), copyListSize(0),
    copyListTotal(0) { reset(); }
  int8_t alloc(int width, int height, uint8_t priority, bool is256);
  int8_t clone(int8_t handle);
  bool isEmpty();
  Spr &free(int8_t handle);
  int tileWidth(int8_t handle);
  int tileHeight(int8_t handle);
  Spr &queueCopyTiles(int8_t handle, const uint8_t *src);
  Spr &copyTiles(int8_t handle, const uint8_t *src);
  Spr &flushQueue();
  Spr &tick();

  int width(int8_t handle) {
    return tileWidth(handle) << 3;
  }

  int height(int8_t handle) {
    return tileHeight(handle) << 3;
  }

  bool is256(int8_t handle) {
    return oam.is256(entries[handle].oamHandle1());
  }

  SprEntry &entry(int8_t handle) {
    return entries[handle];
  }

  Spr &stop(int8_t handle) {
    entries[handle].pc(0); // global STOP
    return *this;
  }

  Spr &destroy(int8_t handle) {
    entries[handle].pc(1); // global DESTROY
    return *this;
  }

  int worldX() {
    return worldXValue;
  }

  Spr &worldX(int x) {
    worldXValue = x;
    for (int i = 0; i < 128; i++) {
      SprEntry &e = entries[i];
      if (e.oamHandle1() >= 0 && e.worldSpace()) e.xyDirty(1);
    }
    return *this;
  }

  int worldY() {
    return worldYValue;
  }

  Spr &worldY(int y) {
    worldYValue = y;
    for (int i = 0; i < 128; i++) {
      SprEntry &e = entries[i];
      if (e.oamHandle1() >= 0 && e.worldSpace()) e.xyDirty(1);
    }
    return *this;
  }

  Spr &worldPos(int x, int y) {
    worldXValue = x;
    worldYValue = y;
    for (int i = 0; i < 128; i++) {
      SprEntry &e = entries[i];
      if (e.oamHandle1() >= 0 && e.worldSpace()) e.xyDirty(1);
    }
    return *this;
  }

  int originX(int8_t handle) {
    return entries[handle].originX();
  }

  Spr &originX(int8_t handle, int x) {
    entries[handle].originX(x).xyDirty(1);
    return *this;
  }

  int originY(int8_t handle) {
    return entries[handle].originY();
  }

  Spr &originY(int8_t handle, int y) {
    entries[handle].originY(y).xyDirty(1);
    return *this;
  }

  Spr &originPos(int8_t handle, int x, int y) {
    entries[handle].originX(x).originY(y).xyDirty(1);
    return *this;
  }

  Spr &anim(int8_t handle, u32 pc) {
    entries[handle].pc(pc);
    return *this;
  }

  uint8_t priority(int8_t handle) {
    return oam.priority(entries[handle].oamHandle1());
  }

  Spr &priority(int8_t handle, uint8_t priority) {
    SprEntry &e = entries[handle];
    oam.priority(e.oamHandle1(), priority);
    if (e.oamHandle2() >= 0) {
      oam.priority(e.oamHandle2(), priority);
    }
    return *this;
  }

#ifdef TESTS
  static int test(bool verbose);
#endif
};
