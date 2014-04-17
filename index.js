'use strict';

var MonitorTestSerial = require('./lib/mt/MonitorTestSerial').MonitorTestSerial;
var Client = require('./lib/client/Client').Client;

module.exports.createClient = function() {
  return new Client(new MonitorTestSerial());
};