const {
  InstanceBase,
  Regex,
  runEntrypoint,
  TCPHelper,
} = require("@companion-module/base");

// Toggle to enable verbose network debugging logs
const NETWORK_DEBUG = false;

class ChristieDHD800Instance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.socket = undefined;
    this.pollTimer = undefined;
    this.powerState = undefined;
    this.inputState = undefined;
  }

  requestState(socket, onFinish) {
    let step = 0;
    const responses = [];
    const parse = (str) => {
      const match =
        step === 0 ? str.match(/([0-9A-F]{2})/i) : str.match(/([0-9A-F])/i);
      if (match) {
        responses.push(match[1]);
        if (NETWORK_DEBUG) {
          this.log(
            "debug",
            `Status response ${match[1]} (all: ${responses.join(",")})`,
          );
        }
        if (step === 0) {
          step = 1;
          socket.send("CR1\r");
        } else {
          if (typeof socket.removeListener === "function") {
            socket.removeListener("data", parse);
          } else if (typeof socket.off === "function") {
            socket.off("data", parse);
          }
          this.powerState = responses[0];
          this.inputState = responses[1];
          this.checkFeedbacksById("power_state", "input_source");
          if (onFinish) onFinish();
        }
      }
    };
    socket.on("data", (d) => parse(d.toString()));
    socket.send("CR0\r");
  }

  init(config) {
    if (NETWORK_DEBUG) {
      this.log("debug", "Initializing module");
    }
    this.updateStatus("ok");
    this.config = config;
    this.updateActions();
    this.updateFeedbacks();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.pollTimer = setInterval(() => this.queryState(), 30000);
    this.queryState();
  }

  async destroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.socket) {
      if (NETWORK_DEBUG) {
        this.log("debug", "Destroying active socket");
      }
      this.socket.destroy();
      delete this.socket;
    }
  }

  async configUpdated(config) {
    if (NETWORK_DEBUG) {
      this.log("debug", "Configuration updated, reinitializing TCP");
    }
    this.config = config;
    this.initTCP();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => this.queryState(), 30000);
    this.queryState();
  }

  initTCP() {
    if (this.socket) {
      if (NETWORK_DEBUG) {
        this.log("debug", "initTCP called, cleaning up existing socket");
      }
      this.socket.destroy();
      delete this.socket;
    }
    if (NETWORK_DEBUG) {
      this.log("debug", "TCP state reset");
    }
    this.updateStatus("ok");
  }

  getConfigFields() {
    return [
      {
        type: "textinput",
        id: "host",
        label: "Projector IP",
        width: 6,
        regex: Regex.HOSTNAME,
      },
      {
        type: "textinput",
        id: "port",
        label: "Port",
        width: 6,
        regex: Regex.PORT,
        default: 10000,
      },
      {
        type: "textinput",
        id: "password",
        label: "Password",
        width: 6,
        default: "",
      },
    ];
  }

  updateActions() {
    const actions = {
      power_on: {
        name: "Power On",
        options: [],
        callback: () => this.sendCommand("C00"),
      },
      power_off: {
        name: "Power Off",
        options: [],
        callback: () => this.sendCommand("C01"),
      },
      input_1: {
        name: "Select Input 1",
        options: [],
        callback: () => this.sendCommand("C05"),
      },
      input_2: {
        name: "Select Input 2",
        options: [],
        callback: () => this.sendCommand("C06"),
      },
      input_3: {
        name: "Select Input 3",
        options: [],
        callback: () => this.sendCommand("C07"),
      },
      input_4: {
        name: "Select Input 4",
        options: [],
        callback: () => this.sendCommand("C08"),
      },
      menu_on: {
        name: "Menu On",
        options: [],
        callback: () => this.sendCommand("C1C"),
      },
      menu_off: {
        name: "Menu Off",
        options: [],
        callback: () => this.sendCommand("C1D"),
      },
    };

    this.setActionDefinitions(actions);
  }

  updateFeedbacks() {
    const feedbacks = {
      power_state: {
        type: "boolean",
        name: "Power State",
        options: [
          {
            type: "dropdown",
            id: "state",
            label: "State",
            default: "00",
            choices: [
              { id: "00", label: "Power ON" },
              { id: "80", label: "Standby" },
              { id: "40", label: "Countdown" },
              { id: "20", label: "Cooling" },
              { id: "10", label: "Failure" },
            ],
          },
        ],
        defaultStyle: { bgcolor: "#00ff00" },
        callback: (fb) => this.powerState === fb.options.state,
      },
      input_source: {
        type: "boolean",
        name: "Input Source",
        options: [
          {
            type: "dropdown",
            id: "slot",
            label: "Input",
            default: "1",
            choices: [
              { id: "1", label: "Input 1" },
              { id: "2", label: "Input 2" },
              { id: "3", label: "Input 3" },
              { id: "4", label: "Input 4" },
            ],
          },
        ],
        defaultStyle: { bgcolor: "#0000ff" },
        callback: (fb) => this.inputState === fb.options.slot,
      },
    };

    this.setFeedbackDefinitions(feedbacks);
  }

  async executeAction(action) {
    switch (action.action) {
      case "power_on":
        this.sendCommand("C00");
        break;
      case "power_off":
        this.sendCommand("C01");
        break;
      case "input_1":
        this.sendCommand("C05");
        break;
      case "input_2":
        this.sendCommand("C06");
        break;
      case "input_3":
        this.sendCommand("C07");
        break;
      case "input_4":
        this.sendCommand("C08");
        break;
      case "menu_on":
        this.sendCommand("C1C");
        break;
      case "menu_off":
        this.sendCommand("C1D");
        break;
    }
  }

  sendCommand(cmd) {
    if (NETWORK_DEBUG) {
      this.log("debug", `sendCommand called with cmd='${cmd}'`);
    }
    if (!this.config.host) {
      this.log("error", "Host not configured");
      return;
    }

    if (this.socket) {
      if (NETWORK_DEBUG) {
        this.log(
          "debug",
          "Existing socket detected, destroying old connection",
        );
      }
      this.socket.destroy();
      this.socket = undefined;
    }

    if (NETWORK_DEBUG) {
      this.log(
        "debug",
        `Creating TCP connection to ${this.config.host}:${this.config.port || 10000}`,
      );
    }
    this.socket = new TCPHelper(this.config.host, this.config.port || 10000);

    this.socket.on("status_change", (status, message) => {
      if (NETWORK_DEBUG) {
        this.log("debug", `Status changed: ${status} ${message}`);
      }
      this.updateStatus(status, message);
    });

    this.socket.on("error", (err) => {
      this.log("error", `Network error: ${err.message}`);
      if (NETWORK_DEBUG) {
        this.log("debug", `Error details: ${JSON.stringify(err)}`);
      }
    });

    let passwordSent = false;
    let commandSent = false;
    const pass = this.config.password || "";

    this.socket.on("data", (data) => {
      const str = data.toString();
      if (NETWORK_DEBUG) {
        this.log("debug", `Received data: ${str}`);
      }

      if (!passwordSent && /PASSWORD:/i.test(str)) {
        if (NETWORK_DEBUG) {
          this.log("debug", `Sending password: '${pass}'`);
        }
        this.socket.send(pass + "\r");
        passwordSent = true;
      } else if (passwordSent && !commandSent && /HELLO/i.test(str)) {
        if (NETWORK_DEBUG) {
          this.log("debug", `Sending command: '${cmd}'`);
        }
        this.socket.send(cmd + "\r");
        commandSent = true;
        this.requestState(this.socket);
        setTimeout(() => {
          if (NETWORK_DEBUG) {
            this.log("debug", "Command sent, destroying socket");
          }
          this.socket.destroy();
          if (NETWORK_DEBUG) {
            this.log("debug", "Socket destroyed");
          }
          this.socket = undefined;
        }, 1000);
      }
    });

    this.socket.on("connect", () => {
      if (NETWORK_DEBUG) {
        this.log("debug", "Socket connected");
      }
      // Wait for PASSWORD: prompt before sending anything
    });
  }

  queryState() {
    if (!this.config?.host) return;

    const sock = new TCPHelper(this.config.host, this.config.port || 10000, {
      reconnect: false,
    });

    let passwordSent = false;
    let helloReceived = false;
    const pass = this.config.password || "";

    const processData = (str) => {
      if (!passwordSent && /PASSWORD:/i.test(str)) {
        sock.send(pass + "\r");
        passwordSent = true;
      } else if (passwordSent && !helloReceived && /HELLO/i.test(str)) {
        helloReceived = true;
        this.requestState(sock, () => sock.destroy());
      } else if (helloReceived) {
        // waiting for state responses handled in requestState
      }
    };

    sock.on("data", (d) => processData(d.toString()));
    sock.on("error", () => {});
  }
}

runEntrypoint(ChristieDHD800Instance);
