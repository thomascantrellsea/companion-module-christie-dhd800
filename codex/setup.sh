#!/bin/bash
set -e

# Ensure externals are available
git submodule update --init --checkout --recursive

# Install Node.js 22 and build tooling
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs build-essential

# Activate Yarn via corepack at the version specified in package.json
corepack enable
corepack prepare yarn@4.9.1 --activate

# Install dependencies for this project and the companion submodule
yarn install

pushd externals/companion
yarn install
popd

echo "Setup complete."
