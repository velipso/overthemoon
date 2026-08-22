// SPDX-License-Identifier: 0BSD
#pragma once
#include "xform.hpp"

struct CmdGbaFix : Command {
  CmdGbaFix();
  void help() override;
  int main(int argc, const char **argv) override;
};
