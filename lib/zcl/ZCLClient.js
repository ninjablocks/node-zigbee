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

/**
 * Extends ZNPClient to provice the ZCL layer, without understanding any of the underlying hardware.
 */
function ZCLClient() {
  ZNPClient.call(this);

  // handle zcl messages
  this.on('incoming-message', this._handleIncomingMessage.bind(this));

  // handle attribute reports
  this.on('zcl-command:ReportAttributes', this._handleReportAttributes.bind(this));
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

  var fail = function(reason) {
    delete this._inFlight[sequenceNumber];
    deferred.error(reason);
  }.bind(this);

  this._inFlight[sequenceNumber] = deferred;

  afParams.payload = zclFrame;

  this.sendAFDataRequest(afParams)
    .timeout(ZCL_RESPONSE_TIMEOUT)
    .then(function(status) {
      if (status.key !== 'ZSuccess') {
        delete this._inFlight[sequenceNumber];
        fail(status);
      }
    })
    .catch(fail);

  return deferred.promise.timeout(ZCL_RESPONSE_TIMEOUT).tap(function() {
    delete this._inFlight[sequenceNumber];
  }.bind(this));
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

      zclMessage.command = ZCL.GeneralCommands.get(zclMessage.commandIdentifier);

      debug('_handleMessage', 'parse ZCL', zclMessage);

      if (zclMessage.sequenceNumber) {
        // It's a reply
        var handler = self._inFlight[zclMessage.sequenceNumber];

        if (!handler) {
          return console.error('No handler for ZCL message', zclMessage);
        }

        handler.resolve(zclMessage);
      } else {
        // Pass it along
        self.emit('zcl-command:' + zclMessage.command.key, zclMessage);
      }

    })
    .write(message.data);

};

ZCLClient.prototype._handleReportAttributes = function(message) {

  var self = this;

  Dissolve()
    .uint16le('attributeIdentifier')
    .uint8('attributeDataType')
    .tap(function() {
      DataTypes.read(this, this.vars.attributeDataType, 'value');
    })
    .tap(function() {
      debug('_handleReportAttributes', 'parsed ReportAttributes', this.vars);
    })
    .write(message.payload);
};

module.exports = ZCLClient;