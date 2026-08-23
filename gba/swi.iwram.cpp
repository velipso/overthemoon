// SPDX-License-Identifier: 0BSD
#include "Swi.hpp"

void Swi::softReset() {
  __asm__("swi #0x000000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}

void Swi::registerRamReset() {
  __asm__("swi #0x010000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}

void Swi::halt() {
  __asm__("swi #0x020000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}

void Swi::stop() {
  __asm__("swi #0x030000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}

void Swi::intrWait() {
  __asm__("swi #0x040000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}

void Swi::vblankIntrWait() {
  __asm__("swi #0x050000" ::: "r0", "r1", "r2", "r3", "r12", "lr", "memory", "cc");
}
