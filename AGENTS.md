# AGENTS

This repository contains a Bitfocus Companion module for controlling a Christie DHD800 projector.

Useful links:

- <https://github.com/bitfocus> – main Bitfocus GitHub organisation.
- <https://github.com/bitfocus/companion-module-template-js> – reference template module.

## Development notes

- Run `yarn format` before committing to ensure Prettier formatting is applied.
- Run `yarn test` to execute unit tests.
- Run `yarn test-companion` to verify Companion starts using the local externals.
  Note: test-companion can run for up to 5 minutes.

# yarn test-companion debugging
If `yarn test-companion` fails, recommend re-running with "yarn test-companion --keep-running" and use curl commands to introspect http://127.0.0.1:8000

## Important files

- `package.json` – defines Node dependencies, scripts and Companion metadata for the module.
- `companion/manifest.json` – Companion manifest describing the module and pointing to the entry file.
- `main.js` – module implementation loaded by Companion when the module starts.

## Relation to Companion

externals/companion is an external to https://github.com/bitfocus/companion.git, which is the parent
which runs this module and is used for integration testing. Code under externals/companion cannot 
be changed.
