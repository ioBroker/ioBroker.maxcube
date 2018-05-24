'use strict';

const moment = require('moment');

function generateSetTemperatureCommand (rfAddress, room_id, mode, temperature, untilDate) {
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
      date_until = padLeft(parseInt((month_until.substr(0, 3) + day_until + month_until.substr(-1) + year_until), 2).toString(16), 4);
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

  const payload = new Buffer('000440000000' + rfAddress + room_id_padded + reqTempHex + date_until + time_until, 'hex').toString('base64');
  return 's:' + payload + '\r\n';
}

function padLeft(data, totalLength){
  return new Array(totalLength - String(data).length + 1).join('0') + data;
}

module.exports = {
  generateSetTemperatureCommand: generateSetTemperatureCommand
};
