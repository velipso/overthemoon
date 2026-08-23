// SPDX-License-Identifier: 0BSD
#include "tests.hpp"

struct TestBasic : Test {
  TestBasic();
  int run(bool verbose) override;
};
