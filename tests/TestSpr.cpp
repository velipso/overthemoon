// SPDX-License-Identifier: 0BSD
#include "TestSpr.hpp"

#include "gba/Spr.cpp"

TestSpr::TestSpr() {
  Test::name = "Spr";
}

int TestSpr::run(bool verbose) {
  return Spr::test(verbose);
}
