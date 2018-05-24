const moment = require('moment');

function generateSetTemperatureCommand(rfAddress, room_id, mode, temperature, untilDate) {
    let date_until = '0000';
    let time_until = '00';

    // 00 = Auto weekprog (no temp is needed, just make the whole byte 00)
    // 01 = Permanent
    // 10 = Temporarily
    let modeBin;
    switch (mode) {
        case 'AUTO': {
            modeBin = '00';
            break;
        }
        case 'MANUAL': {
            modeBin = '01';
            break;
        }
        case 'VACATION': {
            modeBin = '10';
            const momentDate = moment(untilDate);
            const year_until = padLeft((momentDate.get('year') - 2000).toString(2), 7);
            const month_until = padLeft((momentDate.get('month')).toString(2), 4);
            const day_until = padLeft(momentDate.get('date').toString(2), 5);
            date_until = padLeft(parseInt((month_until.substr(0,3) + day_until + month_until.substr(-1) + year_until), 2).toString(16), 4);
            time_until = padLeft(Math.round((momentDate.get('hour') + (momentDate.get('minute') / 60)) * 2).toString(16), 2);
            break;
        }
        case 'BOOST': {
            modeBin = '11';
            break;
        }
        default: {
            console.error('Unknown mode: ' + mode);
            return false;
        }
    }

    // leading zero padding
    const reqTempBinary = modeBin + padLeft(((temperature || 0) * 2).toString(2), 6);
    // to hex string
    const reqTempHex = padLeft(parseInt(reqTempBinary, 2).toString(16), 2);

    // '00' sets all temperature for all devices
    const room_id_padded = padLeft(room_id, 2);
    const hexString = '000440000000' + rfAddress + room_id_padded + reqTempHex + date_until + time_until;
    console.log(hexString);

    const payload = new Buffer(hexString, 'hex').toString('base64');
    return 's:' + payload + '\r\n';
}

// Source: https://github.com/Bouni/max-cube-protocol/blob/master/S-Message.md

// Description        Length      Example Value
// =====================================================================
// Base String        6           000410000000
// RF Address         3           0FC380
// Room Nr            1           01
// Day of week        1           02
// Temp and Time      2           4049
// Temp and Time (2)  2           4c6e
// Temp and Time (3)  2           40cb
// Temp and Time (4)  2           4d20
// Temp and Time (5)  2           4d20
// Temp and Time (6)  2           4d20
// Temp and Time (7)  2           4d02

// Day of week
// =====================================================================
// hex:  |    02     |
// dual: | 0000 0010 |
//              ||||
//              |+++-- day: 000: saturday
//              |           001: sunday
//              |           010: monday
//              |           011: tuesday
//              |           100: wednesday
//              |           101: thursday
//              |           110: friday
//              |
//              +----- telegram: 1: set
//                               0: not set
// The meaning of telegram is unclear at the moment.

// Temperature and Time
// =====================================================================
// hex:  |    40     |    49     |
// dual: | 0100 0000 | 0100 1001 |
//         |||| ||||   |||| |||| 
//         |||| |||+---++++-++++-- Time: 0 0100 1001: 06:05
//         |||| |||
//         |||| |||+-------------- Temperature: 0100 000: 16
// This 16 bit word contains the temperature on the 7 MSB and Time until that temperature is set on the 9 LSB. Temperature value has to be divided by 2.
// 20 (hex) =  32 (decimal) -> 32/2 = 16
//
// Time is the value * 5 minutes since midnight.
// 49 (hex)   = 73 (decimal) -> 73*5 = 365 -> 6:05
// 4d02 (hex) = 21:00, 19 deg

function generateSetDayProgramCommand(rfAddress, room_id, weekday, temperaturesArray, timesArray) {

    // weekday:     0=mo,1=tu,..,6=su
    // tempertures: [19.5,21,..] degrees Celsius (max 7)
    // times:       ['HH:mm',..] 24h format (max 7, same amount as temperatures)

    const dayArr = ['010','011','100','101','110','000','001']; // mo - su
    const dayBin = dayArr[weekday];
    const reqDayBin = padLeft(dayBin, 8);
    const reqDayHex = parseInt(reqDayBin, 2).toString(16);

    const hexTempTimeArr = [];
    for (let i = 0; i < temperaturesArray.length; i++)
    {
        if (i < 6 || i === temperaturesArray.length - 1) // max: 7, take 6 first and last
        {
            const temp = temperaturesArray[i];
            if (i < temperaturesArray.length - 1 && temp === temperaturesArray[i + 1])
            {
                // temperature is the same as in the next time, so only set change @ the next time
            }
            else
            {
                const time = timesArray[i].split(':');
                const mins = ( parseInt(time[0]) * 60 + parseInt(time[1]) );
                const temB = padLeft(((temp || 0) * 2).toString(2), 7);
                const timB = padLeft(Math.round(mins / 5).toString(2), 9);
                const bin  = temB + timB;
                const hex  = parseInt(bin, 2).toString(16);

                hexTempTimeArr.push(hex);
            }
        }
    }
    // to hex string
    const reqTempTimeHex = hexTempTimeArr.join('');
    const room_id_padded = padLeft(room_id.toString(16), 2);
    const req_day_padded = padLeft(reqDayHex, 2);
    const hexString      = '000410000000' + rfAddress + room_id_padded + req_day_padded + reqTempTimeHex;
    const payload        = new Buffer(hexString, 'hex').toString('base64');
    return 's:' + payload + '\r\n';
}

function padLeft(data, totalLength){
    return new Array(totalLength - String(data).length + 1).join('0') + data;
}

module.exports = {
    generateSetTemperatureCommand: generateSetTemperatureCommand,
    generateSetDayProgramCommand: generateSetDayProgramCommand
};