'use strict';

const net  = require('net');
const util = require('util');
const EventEmitter = require('events').EventEmitter;

function MaxCubeLowLevel(ip, port) {
    this.ip = ip;
    this.port = port;

    this.socket = new net.Socket();
    this.isConnected = false;
    let previousPacketData = '';

    this.initSocket = () => {
        this.socket.on('data', dataBuff => {
            let dataStr = dataBuff.toString('utf-8');

            if (!dataStr.endsWith('\r\n')) {
                previousPacketData = dataStr;
                return;
            }

            dataStr = previousPacketData + dataStr;
            previousPacketData = '';

            // multiple commands possible
            const commandArr = dataStr.split('\r\n');
            commandArr.forEach(command => {
                if (command) {
                    const commandType = command.substr(0, 1);
                    const payload = command.substring(2) + '\r\n'; // reappend delimiter
                    this.emit('command', {type: commandType, payload: payload});
                }
            });
        });

        this.socket.on('close', () => {
            this.isConnected = false;
            this.emit('closed');
        });

        this.socket.on('error', err => {
            console.error(err);
            this.emit('error', err);
        });
    };

    this.connect = () => {
        this.connectionPromise = this.connectionPromise || new Promise(resolve => {
            this.socket.connect(this.port, this.ip, () => {
                this.isConnected = true;
                this.emit('connected');
                resolve();
            });
        });

        return this.connectionPromise;
    };

    this.close = () => {
        this.socket.destroy();
        this.connectionPromise = null;
    };

    this.send = dataStr => {
        this.socket.write(dataStr);
    };

    this.isConnected = () => {
        return this.isConnected;
    };

    this.initSocket();
}

util.inherits(MaxCubeLowLevel, EventEmitter);
module.exports = MaxCubeLowLevel;