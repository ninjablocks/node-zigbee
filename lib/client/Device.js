'use strict';

var when = require('when');
var Concentrate = require('concentrate');
var Dissolve = require('dissolve');
var util = require('util');
var debug = require('debug')('znp-device');

var MT = require('../mt/mt_constants');
var Endpoint = require('./Endpoint').Endpoint;
var EventEmitter = require('events').EventEmitter;

function Device(client, deviceInfo, ieee) {
	this.client = client;
	this.deviceInfo = deviceInfo;

	this.IEEEAddress = ieee;

	debug(this, 'constructed');

	this.__defineGetter__('shortAddress', function() {
		return this.deviceInfo.shortAddr;
	});

	this._endpoints = {};

	// Wait for new endpoint ids to arrive, emit them as endpoint objects
	// if we haven't seen them before.
	this.on('endpointIds', function(ids) {
		debug(this, 'endpointIds', ids);

		ids.forEach(function(id) {
			if (!this._endpoints[id]) {
				var endpoint = new Endpoint(this, id);
				this._endpoints[id] = endpoint;
				this.emit('endpoint', endpoint);
			}
		}.bind(this));
	}.bind(this));

	this.findActiveEndpoints();
	this.findEndpoints(0x0104, [0x0500], [0x0500]); // HA IAS Zones.

}
util.inherits(Device, EventEmitter);

/**
 * Finds endpoints for a profileId, which are them emitted as an 'endpoints' event.
 * HA endpoints are searched for automatically.
 */
Device.prototype.findEndpoints = function(profileId, inClusters, outClusters) {
	inClusters = inClusters || [];
	outClusters = outClusters || [];

	debug(this, 'findEndpoints', profileId.toString(16));

	var matchEndpointsPayload = Concentrate()
		.uint16le(this.shortAddress) // DstAddr
		.uint16le(this.shortAddress) // NWKAddrOfInterest
		.uint16le(profileId); // ProfileID

		matchEndpointsPayload.uint8(inClusters.length); // NumInClusters
		inClusters.forEach(function(c) {
			matchEndpointsPayload.uint16le(c);
		});

		matchEndpointsPayload.uint8(outClusters.length); // NumOutClusters
		outClusters.forEach(function(c) {
			matchEndpointsPayload.uint16le(c);
		});


	this.client.comms.request('ZDO_MATCH_DESC_REQ', matchEndpointsPayload.result());
};

/**
 * Returns a promise of a new Device when deviceInfoPromise resolves to a device
 * info object. 
 * @param  {[type]} deviceInfoPromise
 * @return {[type]}
 */
module.exports.deviceForInfo = function(client, deviceInfoPromise) {
	return when(deviceInfoPromise)
		.then(function(deviceInfo) {
			var addrReqPayload = Concentrate()
				.uint16le(deviceInfo.shortAddr) // shortAddr
				.result();

			return client.comms
				.request('UTIL_ADDRMGR_NWK_ADDR_LOOKUP', addrReqPayload)
				.then(function(response) {

					var ieee = response.data;

					// We override the IEEE addresses toString to give us a nice human-readable 
					// one that matches up with what's shown on the user's device.
					ieee.toString = function() {
						var part1 = this.readUInt32LE(4).toString(16);
						var part2 = this.readUInt32LE(0).toString(16);
						return (pad(part1, 8) + pad(part2, 8)).toUpperCase();
					};

					return new Device(client, deviceInfo, ieee);
			}.bind(this));
		});
};

Device.prototype.toString = function() {
	return '[Device: ' + this.IEEEAddress + ']';
};

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}


///*
//command = ZDO_COMPLEX_DESC or ZDO_ACTIVE_EP
Device.prototype.findActiveEndpoints = function() {
	var payload = Concentrate()
		.uint16le(this.shortAddress) // DstAddr
		.uint16le(this.shortAddress) // NWKAddrOfInterest
		.result();

	return this.client.comms
		.request('ZDO_ACTIVE_EP_REQ', payload)
		.then(this.client._parseStatus)
		.then(function(status) {
			debug(this, 'ZDO_ACTIVE_EP_REQ', 'status', status);
			if (status.key !== 'ZSuccess') {
				throw new Error('ZDO_ACTIVE_EP_REQ failed with error: ' + status.key);
			}

			return status;
		}.bind(this));
};

/**
 * Returns a promise of a list of endpoints for this device matching the
 * specified profileId.
 * @param  {Integer} (profileId) profileId to match
 * @return {promise}

Device.prototype._requestProfileEndpoints = function(profileId) {

	var device = this;

	var matchEndpointsPayload = Concentrate()
		.uint16le(this.shortAddress) // DstAddr
		.uint16le(this.shortAddress) // NWKAddrOfInterest
		.uint16le(profileId) // ProfileID
		.uint8(0) // NumInClusters
		.uint8(0) // NumOutClusters
		.result();


	this.client.comms.once('')

	return this.client.comms
	.request('ZDO_MATCH_DESC_REQ', matchEndpointsPayload);


		.then(function(response) {
			var deferred = when.defer();

			this.client.comms.once('command:ZDO_MATCH_DESC_RSP', function(packet) {
				var parser = Dissolve()
					.uint16le('srcAddr')
					.uint8('status')
					.uint16le('nwkAddr')
					.uint8('matchLength')
					.buffer('matchList', 'matchLength')
					.tap(function() {
						if (this.vars.status.key == 'ZSuccess') {
							// Resolve to an array of endpoint ids
							deferred.resolve(Array.prototype.slice.call(this.vars.matchList, 0));
						} else {
							deferred.reject('Bad status for ZDO_MATCH_DESC_RSP', this.vars.status);
						}
					})
					.write(packet.data);
			}).then(function(endpoints) {
				// Convert to Endpoint objects
				return endpoints.map(function(id) {
					return new Endpoint(device, id);
				}));
			});

			return deferred.promise;
		}.bind(this));
}; */