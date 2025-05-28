const mockSend = jest.fn();
const mockOn = jest.fn();
let InstanceClass;

jest.mock("@companion-module/base", () => {
  class MockInstanceBase {
    constructor() {}
    setActionDefinitions(defs) {
      this.actionDefinitions = defs;
    }
    updateStatus() {}
    log() {}
  }
  class MockTCPHelper {
    constructor() {
      this.send = mockSend;
      this.on = mockOn;
      this.destroy = jest.fn();
    }
    get isConnected() {
      return true;
    }
  }
  return {
    InstanceBase: MockInstanceBase,
    Regex: { HOSTNAME: /.+/, PORT: /^\d+$/ },
    TCPHelper: MockTCPHelper,
    runEntrypoint: jest.fn((cls) => {
      InstanceClass = cls;
    }),
  };
});

require("../index.js");

describe("ChristieDHD800Instance", () => {
  beforeEach(() => {
    mockSend.mockClear();
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

  test("executeAction sends correct command", () => {
    const instance = new InstanceClass({});
    instance.socket = { send: mockSend, isConnected: true };
    instance.executeAction({ action: "power_on" });
    expect(mockSend).toHaveBeenCalledWith("C00\r");
  });

  test("sendCommand logs error when not connected", () => {
    const instance = new InstanceClass({});
    const logSpy = jest.spyOn(instance, "log");
    instance.socket = { send: mockSend, isConnected: false };
    instance.sendCommand("ABC");
    expect(logSpy).toHaveBeenCalledWith("error", "Socket not connected");
  });
});
