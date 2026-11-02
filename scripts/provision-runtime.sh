#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
mkdir -p resources/runtime
cp "$(command -v node)" resources/runtime/node
file resources/runtime/node
otool -L resources/runtime/node
