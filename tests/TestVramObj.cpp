// SPDX-License-Identifier: 0BSD
#include "TestVramObj.hpp"

#include "gba/VramObj.cpp"

TestVramObj::TestVramObj() {
  Test::name = "VramObj";
}

int TestVramObj::run(bool verbose) {
  return VramObj::test(verbose);
}
