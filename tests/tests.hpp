// SPDX-License-Identifier: 0BSD
#pragma once

struct Test {
  const char *name = 0;
  virtual int run(bool verbose) = 0;
};

int main(int argc, const char **argv);
