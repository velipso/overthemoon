// SPDX-License-Identifier: 0BSD
#include "gvmain.hpp"
#include "gba/gba.hpp"
#include "types/Player.hpp"

static volatile uint16_t *pal = (uint16_t *)0x05000000;

static void irq_vblank() {
  *pal = *pal + 1;
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

  for (;;) {
    Swi::vblankIntrWait();
  }
}
