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
    this.roomCache = [];
    this.deviceCache = {};

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
                    this.emit('hello', parsedCommand);
                    break;
                }
                case 'M': {
                    this.roomCache = parsedCommand.rooms;
                    this.deviceCache = parsedCommand.devices;
                    this.initialised = true;
                    break;
                }
            }
        });
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
            room_id: null
        };

        const device = this.deviceCache[rfAddress];
        if (device) {
            deviceInfo.device_type = device.device_type;
            deviceInfo.device_name = device.device_name;

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

    this.close = () => {
        this.maxCubeLowLevel.close();
    };

    this.init();
}

util.inherits(MaxCube, EventEmitter);

module.exports = MaxCube;