const mockSend = jest.fn();
const mockOn = jest.fn();
const mockDestroy = jest.fn();
const mockSetVariableDefinitions = jest.fn();
const mockSetVariableValues = jest.fn();
let InstanceClass;

jest.mock("@companion-module/base", () => {
  class MockInstanceBase {
    constructor() {}
    setActionDefinitions(defs) {
      this.actionDefinitions = defs;
    }
    setFeedbackDefinitions(defs) {
      this.feedbackDefinitions = defs;
    }
    setVariableDefinitions(defs) {
      mockSetVariableDefinitions(defs);
    }
    setVariableValues(vals) {
      mockSetVariableValues(vals);
    }
    checkFeedbacksById() {}
    updateStatus() {}
    log() {}
  }
  class MockTCPHelper {
    constructor() {
      this.send = mockSend;
      this.on = (evt, cb) => {
        mockOn(evt, cb);
        if (evt === "connect") {
          this.connectCb = cb;
        } else if (evt === "data") {
          this.dataCb = cb;
        }
      };
      this.destroy = mockDestroy;
    }
    get isConnected() {
      return true;
    }
  }
  return {
    InstanceBase: MockInstanceBase,
    Regex: { HOSTNAME: /.+/, PORT: /^\d+$/ },
    combineRgb: (r, g, b) => (r << 16) | (g << 8) | b,
    TCPHelper: MockTCPHelper,
    runEntrypoint: jest.fn((cls) => {
      InstanceClass = cls;
    }),
  };
});

require("../main.js");

describe("ChristieDHD800Instance", () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSetVariableDefinitions.mockClear();
    mockSetVariableValues.mockClear();
  });

  test("updateActions defines expected actions", () => {
    const instance = new InstanceClass({});
    const setDefsSpy = jest.spyOn(instance, "setActionDefinitions");
    instance.updateActions();
    expect(setDefsSpy).toHaveBeenCalled();
    const defs = setDefsSpy.mock.calls[0][0];
    expect(defs).toHaveProperty("power_on");
    expect(defs).toHaveProperty("power_off");
    expect(defs).toHaveProperty("input_1");
    expect(defs).toHaveProperty("menu_off");
    // ensure callbacks are present
    expect(typeof defs.power_on.callback).toBe("function");
  });

  test("executeAction waits for prompts before sending command", () => {
    jest.useFakeTimers();
    const instance = new InstanceClass({});
    instance.config = { host: "127.0.0.1", port: 10000, password: "" };

    instance.executeAction({ action: "power_on" });

    const connectCall = mockOn.mock.calls.find((c) => c[0] === "connect");
    const dataCall = mockOn.mock.calls.find((c) => c[0] === "data");
    expect(connectCall).toBeDefined();
    expect(dataCall).toBeDefined();

    connectCall[1]();

    expect(mockSend).not.toHaveBeenCalled();

    dataCall[1]("PASSWORD:");
    expect(mockSend).toHaveBeenCalledWith("\r");
    mockSend.mockClear();

    dataCall[1]("Hello");
    expect(mockSend).toHaveBeenCalledWith("C00\r");

    jest.runAllTimers();
    expect(mockDestroy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test("sendCommand logs error when host missing", () => {
    const instance = new InstanceClass({});
    const logSpy = jest.spyOn(instance, "log");
    instance.config = {};
    instance.sendCommand("ABC");
    expect(logSpy).toHaveBeenCalledWith("error", "Host not configured");
  });

  test("sendCommand captures state", () => {
    jest.useFakeTimers();
    const instance = new InstanceClass({});
    instance.config = { host: "127.0.0.1", port: 10000, password: "" };
    const spy = jest.spyOn(instance, "checkFeedbacksById");
    instance.sendCommand("C00");
    let handlers = mockOn.mock.calls
      .filter((c) => c[0] === "data")
      .map((c) => c[1]);
    const first = handlers[0];
    expect(first).toBeDefined();
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test("requestState sets variables", () => {
    const instance = new InstanceClass({});
    let dataHandler;
    const socket = {
      send: jest.fn(),
      on: jest.fn((evt, cb) => {
        if (evt === "data") dataHandler = cb;
      }),
    };
    instance.requestState(socket);
    dataHandler("00");
    expect(socket.send).toHaveBeenCalledWith("CR1\r");
    dataHandler("3");
    expect(mockSetVariableValues).toHaveBeenCalledWith({
      power_state: "Power ON",
      input_source: 3,
    });
  });

  test("requestState triggers feedback check", () => {
    const instance = new InstanceClass({});
    const spy = jest.spyOn(instance, "checkFeedbacksById");
    let dataHandler;
    const socket = {
      send: jest.fn(),
      on: jest.fn((evt, cb) => {
        if (evt === "data") dataHandler = cb;
      }),
    };
    instance.requestState(socket);
    dataHandler("00");
    dataHandler("3");
    expect(spy).toHaveBeenCalledWith("power_state", "input_source");
  });
});
