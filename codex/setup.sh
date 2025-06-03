#!/bin/bash
set -e

# Ensure externals are available
git submodule update --init --checkout --recursive

# Activate Yarn via corepack at the version specified in package.json
corepack enable
corepack prepare yarn@4.9.1 --activate

# Install dependencies for this project and the companion submodule
yarn install

pushd externals/companion
yarn install
popd
