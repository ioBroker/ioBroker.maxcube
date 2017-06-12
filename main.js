/* jshint -W097 */// jshint strict:false
/*jslint node: true */

'use strict';
// you have to require the utils module and call adapter function
var utils   = require(__dirname + '/lib/utils'); // Get common adapter utils
var MaxCube = require(__dirname + '/lib/maxcube/maxcube.js');
var dgram   = require('dgram');
var adapter = utils.adapter('maxcube');

var max;
var objects   = {};
var stopping  = false;
var connectTimer;
var devices   = {};
var connected = false;
var pollTimer = null;

var num2mode = [
    'AUTO',
    'MANUAL',
    'VACATION',
    'BOOST'
];

adapter.on('stateChange', function (id, state) {
    if (!id || !state || state.ack) return;
    if (!objects[id] || !objects[id].native) {
        adapter.log.warn('Unknown ID: ' + id);
        return;
    }
    if (!objects[id].common.write) {
        adapter.log.warn('id "' + id + '" is readonly');
        return;
    }
    if (max && connected) {
        var parts   = id.split('.');
        var attr    = parts.pop();
        var channel = parts.join('.');

        if (attr === 'mode') {
            if (typeof state.val === 'string' && num2mode.indexOf(state.val.toUpperCase()) !== -1) {
                state.val = num2mode.indexOf(state.val.toUpperCase());
            } else if (typeof state.val === 'string') {
                state.val = parseInt(state.val, 10);
            }
            if (objects[channel].vals.mode !== state.val) {
                adapter.setForeignState(channel + '.working', true, true);
                objects[channel].setVals = objects[channel].setVals || {};
                objects[channel].setVals.mode = state.val;
                max.setTemperature(objects[channel].native.rf_address, objects[channel].vals.setpoint, num2mode[state.val], '2040-12-12T00:00:00').then(function () {
                    adapter.setForeignState(id, objects[channel].vals.mode, true);
                }).catch(function (err) {
                    adapter.setForeignState(channel + '.working', false, true);
                    adapter.log.error('Cannot set mode: ' + err);
                    adapter.setForeignState(id, {val: objects[channel].vals.mode, ack: true, q: 0x84});
                });
            } else {
                adapter.setForeignState(id, objects[channel].vals.mode, true);
            }
        } else if (attr === 'setpoint') {
            if (objects[channel].vals.setpoint !== parseFloat(state.val, 10)) {
                objects[channel].vals.setpoint = parseFloat(state.val, 10);
                adapter.setForeignState(channel + '.working', true, true);
                objects[channel].setVals = objects[channel].setVals || {};
                objects[channel].setVals.setpoint = state.val;
                max.setTemperature(objects[channel].native.rf_address, objects[channel].vals.setpoint, objects[channel].vals.mode, '2040-12-12T00:00:00').then(function () {
                    adapter.setForeignState(id, objects[channel].vals.setpoint, true);
                }).catch(function (err) {
                    adapter.setForeignState(channel + '.working', false, true);
                    adapter.setForeignState(id, {val: objects[channel].vals.setpoint, ack: true, q: 0x84});
                    adapter.log.error('Cannot set temperature: ' + err);
                });
            } else {
                adapter.setForeignState(id, objects[channel].vals.setpoint, true);
            }
        }
    } else {
       adapter.log.warn('Not connected');
    }
});

adapter.on('unload', function (callback) {
    stopping = true;
    if (adapter && adapter.setState) {
        adapter.setState('info.connection', false, true);
    }
    if (pollTimer) clearInterval(pollTimer);
    if (connectTimer) clearInterval(connectTimer);

    if (max) {
        try {
            max.close();
        } catch (e) {

        }
    }
    callback();
});

adapter.on('ready', main);

adapter.on('message', function (obj) {
    if (obj) {
        switch (obj.command) {
            case 'browse':
                if (obj.callback) {
                    browse(obj.message || adapter.config.bind, function (list) {
                        adapter.sendTo(obj.from, obj.command, list, obj.callback);
                    });
                }

                break;
        }
    }
});

function browse(ownIp, cb) {
    var timer = null;
    var socket = dgram.createSocket('udp4');
    var result = [];
    if (typeof ownIp === 'function') {
        cb = ownIp;
        ownIp = '0.0.0.0';
    }

    socket.on('message', function (msgBuffer, rinfo) {
        var msg = msgBuffer.toString();
        // answer is "eQ3MaxApKMD1055338>I"
        if (msg.indexOf('eQ3MaxAp') !== -1) {
            result.push(rinfo.address);
        }
    });

    socket.on('error', function (err) {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        adapter.log.error('Cannot browse: ' + err);
        try {
            socket.close();
        } catch (e) {

        }

        if (cb) {
            cb(result);
            cb = null;
        }
    });
    socket.on('listening', function () {
        var whoIsCommand = 'eQ3Max*\0**********I';
        socket.setBroadcast(true);
        socket.setMulticastTTL(128);
        if (ownIp && ownIp !== '0.0.0.0') {
            socket.addMembership('224.0.0.1', ownIp);
        } else {
            socket.addMembership('224.0.0.1');
        }
        socket.send(whoIsCommand, 0, whoIsCommand.length, 23272, '224.0.0.1');
    });

    socket.bind(23272);

    timer = setTimeout(function () {
        socket.close();
        timer = null;
        if (cb) {
            cb(result);
            cb = null;
        }
    }, 2000);
}

var tasks = [];

function processTasks() {
    if (tasks.length) {
        var task = tasks.shift();
        if (task.type === 'state') {
            adapter.setForeignState(task.id, task.val, true, function () {
                setTimeout(processTasks, 0);
            });
        } else if (task.type === 'object') {
            adapter.getForeignObject(task.id, function (err, obj) {
                if (!obj) {
                    objects[task.id] = task.obj;
                    adapter.setForeignObject(task.id, task.obj, function (err, res) {
                        adapter.log.info('object ' + adapter.namespace + '.' + task.id + ' created');
                        setTimeout(processTasks, 0);
                    });
                } else {
                    var changed = false;
                    if (JSON.stringify(obj.native) !== JSON.stringify(task.obj.native)) {
                        obj.native = task.obj.native;
                        changed = true;
                    }

                    if (changed) {
                        objects[obj._id] = obj;
                        adapter.setForeignObject(obj._id, obj, function (err, res) {
                            adapter.log.info('object ' + adapter.namespace + '.' + obj._id + ' created');
                            setTimeout(processTasks, 0);
                        });
                    } else {
                        setTimeout(processTasks, 0);
                    }
                }
            });
        } else {
            adapter.log.error('Unknown task: ' + task.type);
            setTimeout(processTasks, 0);
        }
    }
}

function setStates(obj) {
    //obj = {
    //    "rf_address": "06aebc",
    //    "initialized": true,
    //    "fromCmd": false,
    //    "error": false,
    //    "valid": true,
    //    "mode": "MANUAL",
    //    "dst_active": true,
    //    "gateway_known": true,
    //    "panel_locked": false,
    //    "link_error": true,
    //    "battery_low": false,
    //    "valve": 0,
    //    "setpoint": 20,
    //    "temp": 0
    //}
    var isStart = !tasks.length;
    if (!devices[obj.rf_address]) return;

    var id = devices[obj.rf_address]._id;

    if (obj.setpoint !== undefined || obj.mode !== undefined) {
        objects[id].vals = objects[id].vals || {};
        if (obj.setpoint !== undefined) objects[id].vals.setpoint = obj.setpoint;
        if (obj.mode     !== undefined) objects[id].vals.mode = obj.mode;
        if (objects[id].setVals) {
            if ((objects[id].setVals.setpoint !== undefined && objects[id].setVals.setpoint === obj.setpoint) ||
                (objects[id].setVals.mode     !== undefined && objects[id].setVals.mode     === obj.mode)) {
                tasks.push({type: 'state', id: id + '.working', val: false});
            }
        }
    }

    for (var state in obj) {
        if (!obj.hasOwnProperty(state)) continue;
        var oid  = id + '.' + state;

        if (!objects[oid] && state !== 'valid') continue;

        var meta = objects[oid];
        var val  = obj[state];

        if (state === 'valid') {
            oid  = id + '.invalid';
            val = !val;
        } else
        if (state === 'mode') {
            val = num2mode.indexOf(val);
        } else
        if (meta) {
            if (meta.common.type === 'boolean') {
                val = val === 'true' || val === true || val === 1 || val === '1' || val === 'on';
            } else if (meta.common.type === 'number') {
                if (val === 'on'  || val === 'true'  || val === true)  val = 1;
                if (val === 'off' || val === 'false' || val === false) val = 0;
                val = parseFloat(val);
            }
        }

        if (objects[oid]) {
            tasks.push({type: 'state', id: oid, val: val});
        }
    }

    if (isStart) processTasks();
}

function syncObjects(objs) {
    var isStart = !tasks.length;
    for (var i = 0; i < objs.length; i++) {
        if (objs[i].native && objs[i].native.rf_address && !devices[objs[i].native.rf_address]) {
            devices[objs[i].native.rf_address] = objs[i];
        }
        if (!objects[objs[i]._id]) objects[objs[i]._id] = objs[i];
        tasks.push({type: 'object', id: objs[i]._id, obj: objs[i]});
    }
    if (isStart) processTasks()
}

function pollDevices() {
    max.getDeviceStatus().then(function (devices) {
        devices.forEach(function (device) {
            setStates(device);
        });
    });
}

function getType(value) {
    switch (value) {
        case 0:
            return 'Cube';
        case 1:
            return 'HeatingThermostat';
        case 2:
            return 'HeatingThermostatPlus';
        case 3:
            return 'WallMountedThermostat';
        case 4:
            return 'ShutterContact';
        case 5:
            return 'EcoSwitch';
        default:
            return null;
    }
}

function addDevice(device, deviceInfo) {
    var type = getType(deviceInfo.device_type);
    adapter.log.debug('Found: ' + type + ' ' + device.rf_address);
    //device = {
    //    "rf_address": "06aebc",
    //    "initialized": true,
    //    "fromCmd": false,
    //    "error": false,
    //    "valid": true,
    //    "mode": "MANUAL",
    //    "dst_active": true,
    //    "gateway_known": true,
    //    "panel_locked": false,
    //    "link_error": true,
    //    "battery_low": false,
    //    "valve": 0,
    //    "setpoint": 20,
    //    "temp": 0
    //}

    // deviceInfo = {
    //     "device_type": 1,
    //     "device_name": "ThermostatSchlafzimmer",
    //     "room_name": "Schlafzimmer",
    //     "room_id": 1
    // }
    var id;
    var objs = [];

    switch (type) {
        case 'HeatingThermostat':
        case 'HeatingThermostatPlus':
        case 'WallMountedThermostat':
            id = adapter.namespace + '.devices.thermostat_' + device.rf_address;
            objs.push({
                _id: id,
                common: {
                    name: deviceInfo.device_name,
                    role: 'thermostat'
                },
                type: 'channel',
                native: {
                    rf_address: device.rf_address,
                    device_type: deviceInfo.device_type

                }
            });

            objs.push({
                _id: id + '.initialized',
                common: {
                    name: deviceInfo.device_name + ' initialized',
                    type: 'boolean',
                    role: 'indicator.initialized',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.error',
                common: {
                    name: deviceInfo.device_name + ' error',
                    type: 'boolean',
                    role: 'indicator.error',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.invalid',
                common: {
                    name: deviceInfo.device_name + ' invalid',
                    type: 'boolean',
                    role: 'indicator.invalid',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.mode',
                common: {
                    name: deviceInfo.device_name + ' mode',
                    type: 'number',
                    role: 'level.mode',
                    write: true,
                    states: {
                        0: 'AUTO',
                        1: 'MANUAL',
                        2: 'VACATION',
                        3: 'BOOST'
                    },
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.panel_locked',
                common: {
                    name: deviceInfo.device_name + ' panel_locked',
                    type: 'boolean',
                    role: 'indicator.locked',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.link_error',
                common: {
                    name: deviceInfo.device_name + ' link_error',
                    type: 'boolean',
                    role: 'indicator.link',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.battery_low',
                common: {
                    name: deviceInfo.device_name + ' battery_low',
                    type: 'boolean',
                    role: 'indicator.battery',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.valve',
                common: {
                    name: deviceInfo.device_name + ' valve',
                    type: 'number',
                    role: 'value.valve',
                    min:  0,
                    max:  100,
                    unit: '%',
                    write: false,
                    read:  true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.setpoint',
                common: {
                    name: deviceInfo.device_name + ' setpoint',
                    type: 'number',
                    role: 'level.temperature',
                    write: true,
                    min:   2,
                    max:   35,
                    unit: '°C',
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.temp',
                common: {
                    name: deviceInfo.device_name + ' temperature',
                    type: 'number',
                    role: 'value.temperature',
                    write: false,
                    unit: '°C',
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.working',
                common: {
                    name: deviceInfo.device_name + ' set is running',
                    type: 'boolean',
                    role: 'indicator.working',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            break;

        case 'ShutterContact':
            id = adapter.namespace + '.devices.contact_' + device.rf_address;
            objs.push({
                _id: id,
                common: {
                    name: deviceInfo.device_name,
                    role: 'contact'
                },
                type: 'channel',
                native: {
                    rf_address: device.rf_address,
                    device_type: deviceInfo.device_type

                }
            });
            objs.push({
                _id: id + '.initialized',
                common: {
                    name: deviceInfo.device_name + ' initialized',
                    type: 'boolean',
                    role: 'indicator.initialized',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.error',
                common: {
                    name: deviceInfo.device_name + ' error',
                    type: 'boolean',
                    role: 'indicator.error',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.invalid',
                common: {
                    name: deviceInfo.device_name + ' invalid',
                    type: 'boolean',
                    role: 'indicator.invalid',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.link_error',
                common: {
                    name: deviceInfo.device_name + ' link_error',
                    type: 'boolean',
                    role: 'indicator.link',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.battery_low',
                common: {
                    name: deviceInfo.device_name + ' battery_low',
                    type: 'boolean',
                    role: 'indicator.battery',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.opened',
                common: {
                    name: deviceInfo.device_name + ' is opened',
                    type: 'boolean',
                    role: 'state',
                    write: false,
                    read:  true
                },
                type: 'state',
                native: {}
            });
            break;

        case 'EcoSwitch':
            id = adapter.namespace + '.devices.switch_' + device.rf_address;
            objs.push({
                _id: id,
                common: {
                    name: deviceInfo.device_name,
                    role: 'contact'
                },
                type: 'channel',
                native: {
                    rf_address: device.rf_address,
                    device_type: deviceInfo.device_type

                }
            });
            objs.push({
                _id: id + '.initialized',
                common: {
                    name: deviceInfo.device_name + ' initialized',
                    type: 'boolean',
                    role: 'indicator.initialized',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.error',
                common: {
                    name: deviceInfo.device_name + ' error',
                    type: 'boolean',
                    role: 'indicator.error',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.invalid',
                common: {
                    name: deviceInfo.device_name + ' invalid',
                    type: 'boolean',
                    role: 'indicator.invalid',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.link_error',
                common: {
                    name: deviceInfo.device_name + ' link_error',
                    type: 'boolean',
                    role: 'indicator.link',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            objs.push({
                _id: id + '.battery_low',
                common: {
                    name: deviceInfo.device_name + ' battery_low',
                    type: 'boolean',
                    role: 'indicator.battery',
                    write: false,
                    read: true
                },
                type: 'state',
                native: {}
            });
            /*objs.push({
                _id: id + '.eco_mode',
                common: {
                    name: deviceInfo.device_name + ' eco mode ON',
                    type: 'boolean',
                    role: 'state',
                    write: false,
                    read:  true
                },
                type: 'state',
                native: {}
            });*/
            break;
    }
    if (id) {
        if (deviceInfo.room_name) {
            adapter.getForeignObject('enum.rooms.' + deviceInfo.room_name.replace(/\s|,/g, '_'), function (err, obj) {
                if (!obj) {
                    obj = {
                        _id: 'enum.rooms.' + deviceInfo.room_name.replace(/\s|,/g, '_'),
                        common: {
                            name: deviceInfo.room_name,
                            desc: 'Extracted from MAX! Cube',
                            members: []
                        },
                        type: 'enum',
                        native: {}
                    }
                }
                if (obj.common.members.indexOf(id) === -1) {
                    obj.common.members.push(id);
                    adapter.setForeignObject(obj._id, obj, function (err, obj) {
                        if (err) adapter.log.error(err);
                        syncObjects(objs);
                        setStates(device);
                    });
                } else {
                    syncObjects(objs);
                    setStates(device);
                }
            });
        } else {
            syncObjects(objs);
            setStates(device);
        }
    }
}

function connect() {
    if (!adapter.config.ip || adapter.config.ip === '0.0.0.0') {
        adapter.log.info('No IP address defined');
        return;
    }
    adapter.setState('info.connection', false, true);

    max = new MaxCube(adapter.config.ip, adapter.config.port || 62910, adapter.log);

    max.on('error', function (error) {
        connected = false;
        adapter.setState('info.connection', false, true);
        adapter.log.error(error);
        try {
            max.close();
        } catch (e) {

        }
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (!stopping && !connectTimer) connect();
    });

    max.on('hello', function (helloData) {
        adapter.setState('info.firmware_version', helloData.firmware_version, true);
        adapter.setState('info.serial_number', helloData.serial_number, true);
        adapter.setState('info.rf_address', helloData.rf_address, true);
    });

    max.on('connected', function () {
        connected = true;
        if (connectTimer) {
            clearInterval(connectTimer);
            connectTimer = null;
        }
        adapter.log.info('Connected');
        adapter.setState('info.connection', true, true);

        adapter.setState('info.free_memory_slots', max.commStatus.free_memory_slots, true);
        adapter.setState('info.duty_cycle', max.commStatus.duty_cycle, true);

        max.getDeviceStatus().then(function (devices) {
            devices.forEach(function (device) {
                addDevice(device, max.getDeviceInfo(device.rf_address));
            });
        });
        if (!pollTimer) {
            pollTimer = setInterval(pollDevices, adapter.config.refreshInterval || 10000);
        }
    });

    max.on('closed', function () {
        connected = false;
        adapter.setState('info.connection', false, true);
        adapter.log.info('Connection closed');
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        try {
            max.close();
        } catch (e) {

        }
        if (!stopping && !connectTimer) connect();
    });

    if (!stopping && !connectTimer) {
        connectTimer = setInterval(connect, adapter.config.reconnectInterval || 10000);
    }
}

function main() {
    if (adapter.config.scanner === undefined) adapter.config.scanner = 10;
    adapter.config.scanner = parseInt(adapter.config.scanner, 10) || 0;

    adapter.objects.getObjectView('system', 'channel', {startkey: adapter.namespace + '.', endkey: adapter.namespace + '.\u9999'}, function (err, res) {
        for (var i = 0, l = res.rows.length; i < l; i++) {
            objects[res.rows[i].id] = res.rows[i].value;
        }
        adapter.objects.getObjectView('system', 'state', {startkey: adapter.namespace + '.', endkey: adapter.namespace + '.\u9999'}, function (err, res) {
            for (var i = 0, l = res.rows.length; i < l; i++) {
                objects[res.rows[i].id] = res.rows[i].value;

                if (objects[res.rows[i].id].native && objects[res.rows[i].id].native.rf_address) {
                    devices[objects[res.rows[i].id].native.rf_address] = objects[res.rows[i].id];
                }
            }
            connect();
            adapter.subscribeStates('*');
        });
    });
}
