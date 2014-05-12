'use strict';
var util = require('util');
var debug = require('debug')('ZCLClient');
var Dissolve = require('dissolve');
var Concentrate = require('concentrate');
var when = require('when');

var ZNPClient = require('../znp/ZNPClient');
var ZCL = require('./constants');
var packets = require('./packets');
var DataTypes = require('./DataTypes');
var profileStore = require('../profile/ProfileStore');

/**
 * Extends ZNPClient to provice the ZCL layer, without understanding any of the underlying hardware.
 */
function ZCLClient() {
  ZNPClient.call(this);

  // handle zcl messages
  this.on('incoming-message', this._handleIncomingMessage.bind(this));

  // handle attribute reports
  this.on('zcl-command:ReportAttributes', this._handleReportAttributes.bind(this));

  // XXX: This really should be pulled out and handled by the user, or at least put into a IASZone mixin
  this.on('zcl-command:IAS Zone.Zone Enroll Request', this._handleZoneEnrollRequest.bind(this));
}

util.inherits(ZCLClient, ZNPClient);

ZCLClient.prototype._inFlight = new Array(256);
ZCLClient.prototype._sequence = 1;

var ZCL_RESPONSE_TIMEOUT = 20 * 1000;

ZCLClient.prototype.nextSequenceNumber = function() {
  if (++this._sequence > 255) {
    this._sequence = 1;
  }
  return this._sequence;
};

ZCLClient.prototype.sendZCLFrame = function(params, afParams) {

  debug('sendZCLFrame', 'ZCL data >>', params);

  var sequenceNumber = this.nextSequenceNumber();
  if (this._inFlight[sequenceNumber]) {
    console.log(
      'WARN: Too many pending requests! Sequence number ' + sequenceNumber + 'has not had a response ' +
      'and has not timed out. Consider lowering the timeout.'
    );
  }

  params.TransactionSequenceNumber = sequenceNumber;

  var zclFrame = packets.ZCL_FRAME.write(params);

  var deferred = when.defer();

  var clearSequenceNumber = function() {
    delete this._inFlight[sequenceNumber];
  }.bind(this);

  var fail = function(reason) {
    clearSequenceNumber();
    deferred.error(reason);
  }.bind(this);

  this._inFlight[sequenceNumber] = deferred;

  afParams.payload = zclFrame;

  this.sendAFDataRequest(afParams)
    .timeout(ZCL_RESPONSE_TIMEOUT)
    .then(function(status) {
      if (status.key !== 'ZSuccess') {
        throw new Error(status);
      }
    })
    .done(function() {}, fail);

  return deferred.promise.timeout(ZCL_RESPONSE_TIMEOUT)
    .tap(clearSequenceNumber)
    .catch(clearSequenceNumber);
};

ZCLClient.prototype._handleIncomingMessage = function(message) {

  var self = this;

  debug('_handleMessage', message);

  // Parse the ZCL header...
  // TODO: Move this out?
  var zclParser = Dissolve()
    .uint8('frameControl')
    //XXX: .uint16le('manufacturerCode') How do I know if this is here??
    .uint8('sequenceNumber')
    .uint8('commandIdentifier')
    .buffer('payload', message.data.length - 3)
    .tap(function() {
      var zclMessage = this.vars;

      debug('_handleMessage', 'clusterId: 0x', message.clusterId.toString(16), 'command: 0x' + zclMessage.commandIdentifier.toString(16));

      zclMessage.commandName;
      // XXX: FIX THIS! The commands should be listed in zcl.xml, server (incoming) and client (outgoing) separated.
      if (message.clusterId === 0) {
        // It's a general command... just grab from the enums for now
        zclMessage.commandName = zclMessage.command = ZCL.GeneralCommands.get(zclMessage.commandIdentifier).key;
      } else if (message.clusterId === 0x500 && zclMessage.commandIdentifier === 0) {
        zclMessage.commandName = 'IAS Zone.Zone Status Change Notification';
      } else if (message.clusterId === 0x500 && zclMessage.commandIdentifier === 1) {
        zclMessage.commandName = 'IAS Zone.Zone Enroll Request';
      } else {
        console.log('XXX: Unknown incoming ZCL command. zcl.xml needs to be fixed! Do it!');
        zclMessage.commandName = 'UNKNOWN COMMAND';
      }

      zclMessage.headers = message;

      //var cluster = profileStore.getCluster(message.clusterId);
      //debug('_handleMessage', 'cluster:', cluster);
      //zclMessage.command = ZCL.GeneralCommands.get(zclMessage.commandIdentifier);

      debug('_handleMessage', 'parse ZCL', zclMessage);

      debug('_handleMessage', 'Emitting to ', 'command.' + zclMessage.headers.srcAddr + '.' + zclMessage.headers.srcEndpoint + '.' + zclMessage.headers.clusterId);
      // XXX: Send it up to the cluster so the user can see it.
      self.emit('command.' + zclMessage.headers.srcAddr + '.' + zclMessage.headers.srcEndpoint + '.' + zclMessage.headers.clusterId, zclMessage);

      if (zclMessage.sequenceNumber) {
        // It's a reply
        var handler = self._inFlight[zclMessage.sequenceNumber];

        if (!handler) {
          return console.error('No handler for ZCL message', zclMessage);
        }

        handler.resolve(zclMessage);
      } else {
        // Pass it along
        if (!self.emit('zcl-command:' + zclMessage.commandName, zclMessage)) {
          console.log('Zcl command had no listeners!', zclMessage);
        }
      }

    })
    .write(message.data);

};

// XXX: TODO: How do we use this properly?
var IAS_ZONE_ID = 123;

ZCLClient.prototype._handleZoneEnrollRequest = function(message) {

  var self = this;

  Dissolve()
    .uint16le('Zone Type')
    .uint16le('Manufacturer Code')
    .tap(function() {
      debug('_handleZoneEnrolRequest', 'IAS Zone enroll request from', message.headers.srcAddr, ' Manufacturer code:', this.vars['Manufacturer Code']);

      // TODO: Read the zone type? We probably just want to allow all types anyway.

      // 8.2.2.3.1 Zone Enroll Response Command
      var payload = Concentrate()
        .uint8(0) // Enroll response code - 0 = success
        .uint8(IAS_ZONE_ID)
        .result();

      return self.sendZCLFrame({
        FrameControl: {
          ClusterSpecific: true
        },
        DeviceShortAddress: message.headers.srcAddr,
        CommandIdentifier: 0x01,
        payload: payload
      }, {
        DstAddr: {
          address: message.headers.srcAddr
        },
        DstEndpoint: message.headers.srcEndpoint,
        ClusterID: message.headers.clusterId,
        Options: {
          ackRequest: true,
          discoverRoute: true
        }
      });

    })
    .write(message.payload);
};

ZCLClient.prototype._handleReportAttributes = function(message) {

  Dissolve()
    .uint16le('attributeIdentifier')
    .uint8('attributeDataType')
    .tap(function() {
      debug('_handleReportAttributes', 'parsed ReportAttributes', this.vars);
    })
    .write(message.payload);
};

module.exports = ZCLClient;
