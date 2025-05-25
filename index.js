const { InstanceBase, Regex, runEntrypoint, TCPHelper } = require('@companion-module/base')

class ChristieDHD800Instance extends InstanceBase {
  constructor(internal) {
    super(internal)
    this.socket = undefined
  }

  init(config) {
    this.updateStatus('connecting')
    this.config = config
    this.initTCP()
    this.updateActions()
  }

  async destroy() {
    if (this.socket) {
      this.socket.destroy()
      delete this.socket
    }
  }

  async configUpdated(config) {
    this.config = config
    this.initTCP()
  }

  initTCP() {
    if (this.socket) {
      this.socket.destroy()
      delete this.socket
    }

    if (this.config.host) {
      this.socket = new TCPHelper(this.config.host, this.config.port || 10000)

      this.socket.on('status_change', (status, message) => {
        this.updateStatus(status, message)
      })

      this.socket.on('connect', () => {
        const pass = this.config.password || ''
        this.socket.send(pass + '\r')
      })

      this.socket.on('error', (err) => {
        this.log('error', `Network error: ${err.message}`)
      })
    }
  }

  getConfigFields() {
    return [
      {
        type: 'textinput',
        id: 'host',
        label: 'Projector IP',
        width: 6,
        regex: Regex.HOSTNAME,
      },
      {
        type: 'textinput',
        id: 'port',
        label: 'Port',
        width: 6,
        regex: Regex.PORT,
        default: 10000,
      },
      {
        type: 'textinput',
        id: 'password',
        label: 'Password',
        width: 6,
        default: '',
      },
    ]
  }

  updateActions() {
    const actions = {
      power_on: { name: 'Power On', options: [] },
      power_off: { name: 'Power Off', options: [] },
      input_1: { name: 'Select Input 1', options: [] },
      input_2: { name: 'Select Input 2', options: [] },
      input_3: { name: 'Select Input 3', options: [] },
      input_4: { name: 'Select Input 4', options: [] },
      menu_on: { name: 'Menu On', options: [] },
      menu_off: { name: 'Menu Off', options: [] },
    }

    this.setActionDefinitions(actions)
  }

  async executeAction(action) {
    switch (action.action) {
      case 'power_on':
        this.sendCommand('C00')
        break
      case 'power_off':
        this.sendCommand('C01')
        break
      case 'input_1':
        this.sendCommand('C05')
        break
      case 'input_2':
        this.sendCommand('C06')
        break
      case 'input_3':
        this.sendCommand('C07')
        break
      case 'input_4':
        this.sendCommand('C08')
        break
      case 'menu_on':
        this.sendCommand('C1C')
        break
      case 'menu_off':
        this.sendCommand('C1D')
        break
    }
  }

  sendCommand(cmd) {
    if (this.socket && this.socket.isConnected) {
      this.socket.send(cmd + '\r')
    } else {
      this.log('error', 'Socket not connected')
    }
  }
}

runEntrypoint(ChristieDHD800Instance)
