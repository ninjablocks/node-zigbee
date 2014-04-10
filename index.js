'use strict';

var MonitorTestSerial = require('./lib/mt/MonitorTestSerial').MonitorTestSerial;
var Client = require('./lib/client/Client').Client;

/**
 * Connects to a local ZigBee Network Processor via serial interface.
 * 
 * @param  {string} serialPortPath Path to the serial port.
 * @return {promise} A promise that resolves to a new Client once connected.
 */
module.exports.connectNetworkProcessor = function(serialPortPath) {
	var mt = new MonitorTestSerial();

	return mt.connectToPort(serialPortPath)
		.then(function(mt) {
			var client = new Client(mt);

			return client;
		});
};