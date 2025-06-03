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
  });

  test("destroy cleans up active socket", async () => {
    const instance = new InstanceClass({});
    instance.socket = { destroy: mockDestroy };
    await instance.destroy();
    expect(mockDestroy).toHaveBeenCalled();
    expect(instance.socket).toBeUndefined();
  });
});
