// SPDX-License-Identifier: 0BSD
#include "TestBasic.hpp"

TestBasic::TestBasic() {
  Test::name = "basic";
}

int TestBasic::run(bool verbose) {
  (void)verbose;
  // always pass
  return 0;
}
