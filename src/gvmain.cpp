// SPDX-License-Identifier: 0BSD
#include "gvmain.hpp"
#include "gba/gba.hpp"
#include "types/Player.hpp"
#include "data/palette.hpp"
#include "data/spritesheets/digits.8x8.hpp"

static Oam g_oam;
static VramObj g_vramObj;
static Spr g_spr(g_oam, g_vramObj);

static void irq_vblank() {
  g_oam.copy();
}

extern "C" void gvmain() {
  Irq::init();
  Irq::vblank(irq_vblank);

  Reg::DISPCNT::write()
    .mode(2)
    .bg2(1)
    .bg3(1)
    .obj(1)
    .done();
  Reg::DISPSTAT::update()
    .vblank(1)
    .done();
  Reg::IE::update()
    .vblank(1)
    .done();
  Reg::IME::set(1);

  int vh = g_vramObj.alloc256(8, 8);
  int oh = g_oam.alloc(0);

  g_vramObj.copy(vh, dataSpritesheetsDigits8x8Bin);
  g_oam.entry(oh)
    .attr0(VramObj::oamAttr0(vh))
    .attr1(VramObj::oamAttr1(vh))
    .attr2(VramObj::oamAttr2(vh))
    .done();

  memcpy32((void *)0x05000000, dataPaletteBin, dataPaletteBinSize);
  memcpy32((void *)0x05000200, dataPaletteBin, dataPaletteBinSize);

  int x = 0;
  for (;;) {
    g_oam.x(oh, x++);
    Swi::vblankIntrWait();
  }
}
