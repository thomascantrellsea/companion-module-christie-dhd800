const mockSend = jest.fn();
const mockOn = jest.fn();
const mockDestroy = jest.fn();
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
    TCPHelper: MockTCPHelper,
    runEntrypoint: jest.fn((cls) => {
      InstanceClass = cls;
    }),
  };
});

require("../main.js");

describe("ChristieDHD800Instance additional tests", () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockOn.mockClear();
    mockDestroy.mockClear();
  });

  test("getConfigFields returns expected fields", () => {
    const instance = new InstanceClass({});
    const fields = instance.getConfigFields();
    const hostField = fields.find((f) => f.id === "host");
    const portField = fields.find((f) => f.id === "port");
    const passwordField = fields.find((f) => f.id === "password");
    expect(hostField).toBeDefined();
    expect(hostField.regex).toEqual(/.+/);
    expect(portField).toBeDefined();
    expect(portField.regex).toEqual(/^\d+$/);
    expect(passwordField).toBeDefined();
  });

  test("configUpdated stores config and reinitializes TCP", () => {
    const instance = new InstanceClass({});
    const spy = jest.spyOn(instance, "initTCP");
    instance.configUpdated({ host: "1.2.3.4" });
    expect(instance.config).toEqual({ host: "1.2.3.4" });
    expect(spy).toHaveBeenCalled();
    instance.destroy();
  });

  test("destroy cleans up active socket", async () => {
    const instance = new InstanceClass({});
    instance.socket = { destroy: mockDestroy };
    await instance.destroy();
    expect(mockDestroy).toHaveBeenCalled();
    expect(instance.socket).toBeUndefined();
  });

  test("updateFeedbacks defines feedbacks", () => {
    const instance = new InstanceClass({});
    const spy = jest.spyOn(instance, "setFeedbackDefinitions");
    instance.updateFeedbacks();
    expect(spy).toHaveBeenCalled();
    const defs = spy.mock.calls[0][0];
    expect(defs).toHaveProperty("power_state");
    expect(defs).toHaveProperty("input_source");
  });

  test("queryState sends status commands", () => {
    const instance = new InstanceClass({});
    instance.config = { host: "1.2.3.4", port: 10000, password: "" };
    const spy = jest.spyOn(instance, "checkFeedbacksById");
    instance.queryState();
    let handlers = mockOn.mock.calls
      .filter((c) => c[0] === "data")
      .map((c) => c[1]);
    const first = handlers[0];
    first("PASSWORD:");
    expect(mockSend).toHaveBeenCalledWith("\r");
    mockSend.mockClear();
    first("HELLO");
    expect(mockSend).toHaveBeenCalledWith("CR1\r");
    handlers = mockOn.mock.calls
      .filter((c) => c[0] === "data")
      .map((c) => c[1]);
    const second = handlers[handlers.length - 1];
    second("00");
    expect(mockSend).toHaveBeenCalledWith("CR2\r");
    second("3");
  });
});
