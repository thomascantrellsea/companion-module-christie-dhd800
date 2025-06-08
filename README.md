# Christie DHD800 Companion Module

This module provides basic control over a Christie DHD800 projector using Bitfocus Companion.

It connects to the projector via Telnet on port `10000` and sends simple commands for
power, input selection and menu control.

The module now waits for the projector's `PASSWORD:` and `Hello` prompts before
sending commands. After issuing a command, it keeps the connection open for
around one second to ensure the projector processes the message.

## Configuration

- **Projector IP** – IP address of the projector.
- **Port** – Network port (default `10000`).
- **Password** – Optional network PIN code. Leave blank if none is set.

## Actions

The following actions are available:

- Power On / Off / Toggle
- Select Input 1–4
- Menu On / Off

Refer to the projector manual for further details.

## Testing with Companion

Run `yarn test-companion` to launch a local Companion instance and verify the
module loads correctly. By default it uses a mock projector. Pass
`--projector-ip <ip>` (or set the `PROJECTOR_IP` environment variable) to proxy
commands to a real projector at the given IP address instead of the mock
server.
