// SPDX-License-Identifier: 0BSD
#pragma once

namespace Swi {
  /* 00 */ void softReset();
  /* 01 */ void registerRamReset();
  /* 02 */ void halt();
  /* 03 */ void stop();
  /* 04 */ void intrWait();
  /* 05 */ void vblankIntrWait();
}
