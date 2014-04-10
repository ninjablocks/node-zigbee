'use strict';

var when = require('when');
var Concentrate = require('concentrate');
var Dissolve = require('dissolve');
var debug = require('debug')('znp-endpoint');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var ZCLCluster = require('../zcl/index').ZCLCluster;

function Endpoint(device, endpointId) {
	this.device = device;
	this.endpointId = endpointId;

	debug(this, 'constructed');

	device.on('simpleDescriptor:' + endpointId, function(descriptor) {
		this.emit('simpleDescriptor', descriptor);
	}.bind(this));

	this.comms = this.device.client.comms;
}
util.inherits(Endpoint, EventEmitter);

/**
 * Returns a promise for the Simple Descriptor for this endpoint.
 * @return {promise}
 */
Endpoint.prototype.simpleDescriptor = function() {
	debug(this, 'simpleDescriptor');

	var descReq = Concentrate()
		.uint16le(this.device.shortAddress) // DstAddr
		.uint16le(this.device.shortAddress) // NWKAddrOfInterest
		.uint8(this.endpointId) // Endpoint
		.result();
	return this.comms
		.request('ZDO_SIMPLE_DESC_REQ', descReq)
		.then(function(response) {
			if (response.data[0] !== 0x00) {
				throw new Error('Failed requesting Simple Descriptor');
			}

			var deferred = when.defer();

			this.once('simpleDescriptor', deferred.resolve);

			return deferred.promise;
		}.bind(this));
};

Endpoint.prototype.inClusters = function() {
	debug(this, 'inClusters');

	return this.simpleDescriptor().then(function(simpleDescriptor) {
		debug(this, 'inClusters', 'Found clusters', simpleDescriptor.inClusters);
		return simpleDescriptor.inClusters.map(function(cid) {
			return new ZCLCluster(this, cid);
		}.bind(this));
	}.bind(this));
};

Endpoint.prototype.toString = function() {
	return this.device + ' [Endpoint: ' + this.endpointId + ']';
};
module.exports.Endpoint = Endpoint;