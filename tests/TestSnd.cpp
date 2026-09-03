// SPDX-License-Identifier: 0BSD
#include "TestSnd.hpp"

#include "gba/Snd.cpp"
#include "gba/Snd.iwram.cpp"

TestSnd::TestSnd() {
  Test::name = "Snd";
}

int TestSnd::run(bool verbose) {
  return Snd::test(verbose);
}
