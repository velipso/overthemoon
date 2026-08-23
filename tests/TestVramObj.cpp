// SPDX-License-Identifier: 0BSD
#include "TestVramObj.hpp"
#include <stdio.h>

#include "gba/util.cpp"
#include "gba/VramObj.cpp"

TestVramObj::TestVramObj() {
  Test::name = "VramObj";
}

int TestVramObj::run(bool verbose) {
  return VramObj::test(verbose);
}
