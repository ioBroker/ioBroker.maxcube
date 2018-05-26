'use strict';

const MaxCubeLowLevel = require('./maxcube-lowlevel');
const MaxCubeCommandParser = require('./maxcube-commandparser');
const MaxCubeCommandFactory = require('./maxcube-commandfactory');
const util = require('util');
const EventEmitter = require('events').EventEmitter;

// Constructor
function MaxCube(ip, port, log) {
    this.maxCubeLowLevel = new MaxCubeLowLevel(ip, port);
    this.maxCubeLowLevel.connect();

    this.waitForCommandType = null;
    this.waitForCommandResolver = null;
    this.initialised = false;

    this.commStatus = {
        duty_cycle: 0,
        free_memory_slots: 0
    };
    this.metaInfo = {
        serial: null,
        fwVersion: null
    };
    this.roomCache = [];
    this.deviceCache = {};
    this.configCache = {};

    this.init = () => {
        this.maxCubeLowLevel.on('closed', () => {
            this.initialised = false;
            this.emit('closed');
        });

        this.maxCubeLowLevel.on('connected', () => {
            if (!this.initialised) {
                this.waitForCommand('M').then(() => this.emit('connected'));
            } else {
                this.emit('connected');
            }
        });
        this.maxCubeLowLevel.on('error', function () {
            this.initialised = false;
            this.emit('error');
        });


        this.maxCubeLowLevel.on('command', command => {
            const parsedCommand = MaxCubeCommandParser.parse(command.type, command.payload, log);
            if (this.waitForCommandType === command.type && this.waitForCommandResolver) {
                this.waitForCommandResolver(parsedCommand);
                this.waitForCommandType = null;
                this.waitForCommandResolver = null;
            }

            switch (command.type) {
                case 'H': {
                    this.commStatus.duty_cycle = parsedCommand.duty_cycle;
                    this.commStatus.free_memory_slots = parsedCommand.free_memory_slots;
                    this.metaInfo.fwVersion = parsedCommand.firmware_version;
                    this.metaInfo.serial = parsedCommand.serial_number;
                    this.emit('hello', parsedCommand);
                    break;
                }
                case 'M': {
                    this.roomCache = parsedCommand.rooms;
                    this.deviceCache = parsedCommand.devices;
                    this.initialised = true;
                    this.emit('meta_data', parsedCommand);

                    break;
                }
                case 'L': {
                    this.updateDeviceInfo(parsedCommand);
                    this.emit('device_list', parsedCommand);
                    break;
                }
                case 'C': {
                    this.updateDeviceConfig(parsedCommand);
                    this.emit('configuration', parsedCommand);
                    break;
                }

            }
        });
    };

    this.updateDeviceInfo = devices => {
        if (typeof devices !== 'undefined') {
            for (let i = 0; i < devices.length; i++) {
                const deviceInfo = devices[i];
                const rf = deviceInfo.rf_address;
                if (typeof this.deviceCache[rf] !== 'undefined') {
                    for (const item in deviceInfo) {
                        if (deviceInfo.hasOwnProperty(item)) {
                            this.deviceCache[rf][item] = deviceInfo[item];
                        }
                    }
                }
            }
        }
    };

    this.updateDeviceConfig = function(deviceConfig){
        if (typeof deviceConfig !== 'undefined'){
            var rf = deviceConfig.rf_address;
            this.configCache[rf] = deviceConfig;
        }
    };

    this.waitForCommand = commandType => {
        this.waitForCommandType = commandType;
        return new Promise(resolve => {
            this.waitForCommandResolver = resolve;
        });
    };

    this.send = (command, replyCommandType) => {
        return this.getConnection().then(() => {
            this.maxCubeLowLevel.send(command);

            if (replyCommandType) {
                return this.waitForCommand(replyCommandType);
            } else {
                return Promise.resolve();
            }
        });
    };

    this.checkInitialised = () => {
        if (!this.initialised) {
            throw Error('Maxcube not initialised');
        }
    };

    this.getConnection = () => {
        return this.maxCubeLowLevel.connect();
    };

    this.getCommStatus = () => {
        return this.commStatus;
    };

    this.getDeviceStatus = rfAddress => {
        this.checkInitialised();

        return this.send('l:\r\n', 'L').then(devices => {
            if (rfAddress) {
                return devices.filter(device => device.rf_address === rfAddress);
            } else {
                return devices;
            }
        });
    };

    this.getDevices = () => {
        this.checkInitialised();

        return this.deviceCache;
    };

    this.getDeviceInfo = rfAddress => {
        this.checkInitialised();

        let deviceInfo = {
            device_type: null,
            device_name: null,
            room_name: null,
            room_id: null,
            battery_low: null,
            panel_locked: null
        };

        const device = this.deviceCache[rfAddress];
        if (device) {
            deviceInfo.device_type = device.device_type;
            deviceInfo.device_name = device.device_name;
            deviceInfo.battery_low = device.battery_low;
            deviceInfo.panel_locked= device.panel_locked;

            if (device.room_id && this.roomCache[device.room_id]) {
                const room = this.roomCache[device.room_id];
                deviceInfo.room_name = room.room_name;
                deviceInfo.room_id = room.room_id;
            }
        }

        return deviceInfo;
    };

    this.getRooms = () => {
        this.checkInitialised();

        return this.roomCache;
    };

    this.flushDeviceCache = () => {
        this.checkInitialised();

        return this.send('m:\r\n');
    };
    this.resetError = rfAddress => {
        this.checkInitialised();

        return this.send(MaxCubeCommandFactory.generateResetCommand(rfAddress, this.deviceCache[rfAddress].room_id), 'S');
    };

    this.sayHello = () => {
        this.checkInitialised();
        return this.send('h:\r\n', 'H').then(res => {
            this.commStatus.duty_cycle = res.duty_cycle;
            this.commStatus.free_memory_slots = res.free_memory_slots;
            return true;
        });
    };

    this.setTemperature = (rfAddress, degrees, mode, untilDate) => {
        this.checkInitialised();

        degrees = Math.max(2, degrees);
        const command = MaxCubeCommandFactory.generateSetTemperatureCommand(rfAddress, this.deviceCache[rfAddress].room_id, mode || 'MANUAL', degrees, untilDate);

        return this.send(command, 'S').then(res => {
            this.commStatus.duty_cycle = res.duty_cycle;
            this.commStatus.free_memory_slots = res.free_memory_slots;
            return res.accepted;
        });
    };

    this.setSchedule = (rfAddress, room_id, weekday, temperaturesArray, timesArray) => {
        // weekday:           0=mo,1=tu,..,6=su
        // temperaturesArray: [19.5,21,..] degrees Celsius (max 7)
        // timesArray:        ['HH:mm',..] 24h format (max 7, same amount as temperatures)
        // the first time will be the time (from 00:00 to timesArray[0]) that the first temperature is active. Last possibe time of the day: 00:00

        this.checkInitialised();

        const command = MaxCubeCommandFactory.generateSetDayProgramCommand (rf_address, room_id, weekday, temperaturesArray, timesArray);

        return this.send(command, 'S').then(res => {
            this.commStatus.duty_cycle = res.duty_cycle;
            this.commStatus.free_memory_slots = res.free_memory_slots;
            return res.accepted;
        });
    };


    this.close = () => {
        this.maxCubeLowLevel.close();
    };

    this.init();
}

util.inherits(MaxCube, EventEmitter);

module.exports = MaxCube;