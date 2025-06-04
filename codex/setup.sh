#!/bin/bash
set -e

# Ensure externals are available
git submodule update --init --checkout --recursive --depth 1

# Install Node.js 22 and build tooling
#curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
#apt-get install -y nodejs build-essential

# Activate Yarn via corepack at the version specified in package.json
corepack enable
corepack prepare yarn@4.9.1 --activate

# Install dependencies for this project and the companion submodule
yarn install

pushd externals/companion
yarn install
popd

# Copy cached node files
pushd externals/companion
mkdir -p .cache/node
cp ../packages/node/*.tar.gz ./.cache/node
popd

# Install libusb-1.0.so.0
apt-get update 
env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libusb-1.0-0

echo "Setup complete."
