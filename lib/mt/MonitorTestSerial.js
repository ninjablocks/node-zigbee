'use strict';

var debug = require('debug')('znp-serial');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var Dissolve = require('dissolve');
var Concentrate = require('concentrate');
var SerialPort = require('serialport').SerialPort;
var when = require('when');

var MT = require('./mt_constants');
var calculateFCS = require('../util/checksum').calculateFCS;

/**
 * Handles byte-level translation of ZNP protocol messages from the SOC.
 *
 * Emits 'command:<command>' events for each MonitorTest command supported,
 * 'packet' for every command received, and 'unhandledPacket' for any commands
 * not already handled by the more specific 'command:' handler.
 */
function MonitorTestSerial() {
  this.pendingSyncResponses = {};
}
util.inherits(MonitorTestSerial, EventEmitter);

/**
 * Connects to the speicified serial port (currently at 115200 baud).
 *
 * Attempts to bypass any bootloader.
 * @param  {string} serialPortPath
 * @return {promise} which will resolve when the serial port is connected
 */
MonitorTestSerial.prototype.connectToPort = function(serialPortPath) {
  var openImmediately = false;
  this.serialPort = new SerialPort(serialPortPath, {
    baudrate: 115200
  }, openImmediately);

  this.concentrate = Concentrate();

  var deferred = when.defer();

  /* when a serial port is newly opened, we want to send:
   *   1) a bootloader bypass (0x07)
   *   2) a ping request
   * depending on the device type and bootloader status we get multiple responses:
   *   CC2531, bootloader: serial port close and USB re-enumerate
   *   CC2531, application: ping response
   *   CC2530, bootloader: bootloader response of 0x00 and a ping response
   *   CC2530, application: ping response (app ignores 0x07 since not SOF)
   * so we can respond as follows:
   *   ping response: application ready
   *   serial close: reconnect and repeat above process
   */

  this.closed = true;
  var onOpened = function() {
    debug('serialPort', 'open');
    this.closed = false;

    // close case (currently node-serialport appears to give 'error' when the socket closes)
    this.serialPort.on('error', function() {
      if (!this.closed) {
        debug('serialPort', 'error -> close');
        this.closed = true;
        this.closePort();
      }
    }.bind(this));
    this.serialPort.on('close', function() {
      debug('serialPort', 'close?');
    }.bind(this));

    // application ready case: resolve
    this.removeAllListeners('command:SYS_PING');
    this.once('command:SYS_PING', function() {
      debug('serialPort', 'ping');
      if (deferred) {
        deferred.resolve(this);
        deferred = null;
      }
      this.emit('connected');
    }.bind(this));

    this.serialPort.write(new Buffer([0x0, 0x07, 0x0, 0x07]), function() {
      debug('serialPort', 'binding');
      // bind the concentrator/dissolver
      this.serialPort.pipe(this._createParser());
      this.concentrate = Concentrate();
      this.concentrate.pipe(this.serialPort);

      this.sendPacket(MT.CommandType.SREQ, MT.CommandSubsystem.SYS, MT.Commands.SYS.SYS_PING);
    }.bind(this));
  }.bind(this);

  this.serialPort.open(onOpened);

  this._reconnectSerial = function() {
    this.serialPort.open(onOpened);
  }.bind(this);

  return deferred.promise;
};

/**
 * Forcefully close the port, causing a fresh reconnect.
 */
MonitorTestSerial.prototype.closePort = function() {
  debug('serialPort', 'close');
  this.closed = true;
  this.serialPort.close(); // force a close

  setTimeout(this._reconnectSerial, 1000);
};

/**
 * Creates a parser (dissolver) of data from the serialPort, which emits data to
 * _handleIncomingData.
 */
MonitorTestSerial.prototype._createParser = function() {
  var parser = Dissolve().loop(function(end) {
    this
      .uint8('sof')
      .tap(function() {
        if (this.vars.sof == 0xFE) {
          // OK, continue (otherwise ignore)
          this.uint8('length')
            .uint8('cmd0')
            .uint8('cmd1')
            .buffer('data', 'length')
            .uint8('fcs')
            .tap(function() {
              this.push(this.vars);
              this.vars = {};
            });
        } else {
          console.log('Invalid SOF', this.vars.sof, '- skipping.');
        }
      });
  });

  // setup handler for incoming parsed packets
  parser.on('data', this._handleIncomingData.bind(this));

  return parser;
};

/**
 * Transforms a partially parsed packet, performing additional parsing and emits
 * appropriate events for the packet.
 * @private
 * @param  {object} packet The partially parsed packet from the dissolver.
 */
MonitorTestSerial.prototype._handleIncomingData = function(packet) {
  var subsystem = MT.CommandSubsystem.get( packet.cmd0 & 0x1f );

  packet.command = {
    type: MT.CommandType.get( packet.cmd0 & 0xe0 ),
    subsystem: subsystem,
    id: MT.Commands[subsystem.key] ? MT.Commands[subsystem.key].get( packet.cmd1 ) : null,
  };

  if (!packet.command.id) {
    console.log('UNKNOWN CMD', packet.cmd0, packet.cmd1);
  } else {
    debug(packet.command.id.key, packet.command.type.key, packet.data);
  }

  this.emit('packet', packet);

  var hadListeners = false;

  if ( packet.command.id ) {
    hadListeners = this.emit('command:' + packet.command.id.key, packet);
  }

  if (!hadListeners) {
    this.emit('unhandledPacket', packet);
  }
};

/**
 * Encodes and sends a MonitorTest packet without any response handling. This
 * should typically not be used, as most or all packets have an immediate
 * response "SRSP" message which confirms it was received, which is handled by
 * requires().
 * @param  {enum} type
 * @param  {enum} subsystem
 * @param  {enum} commandId
 * @param  {Buffer} buffer
 */
MonitorTestSerial.prototype.sendPacket = function(type, subsystem, commandId, buffer) {
  buffer = buffer || new Buffer(0);

  debug('sendPacket', type, subsystem, commandId, buffer);

  var payload = Concentrate()
    .uint8(buffer.length) // length
    .uint8(type.value | subsystem.value) // cmd0
    .uint8(commandId.value) // cmd1
    .buffer(buffer)
    .result();

  var fcs = calculateFCS(payload);

  var packet = Concentrate()
    .uint8(0xfe) // sof
    .buffer(payload)
    .uint8(fcs)
    .result();

  debug('sendPacket', '>>', packet);

  this.concentrate
    .buffer(packet)
    .flush(); // send it out
};

/**
 * Performs a request by sending the specified command with data. The returned
 * promise is resolved to the direction response from the SOC, which may not be
 * the final response (some commands return an acknowledgement immediately the
 * asyncronously return actual data at a later time).
 * @param  {string} command The name of the MonitorTest command to send.
 * @param  {Buffer} buffer The payload to send with the command.
 * @return {promise} A promise that resolves to the result packet.
 */
MonitorTestSerial.prototype.request = function(command, buffer) {
  if ( !buffer ) {
    buffer = new Buffer(0);
  }

  var subsystem = command.split('_')[0];
  var commandId = MT.Commands[subsystem][command];

  var deferred = when.defer();

  // buffer up command responses in order
  if (!this.pendingSyncResponses[commandId.key]) {
    this.pendingSyncResponses[commandId.key] = [];
    this.on('command:' + commandId.key, function(packet) {
      this.pendingSyncResponses[commandId.key].shift()( packet );
    }.bind(this));
  }
  this.pendingSyncResponses[commandId.key].push(function(packet) {
    deferred.resolve(packet);
  });

  this.sendPacket(MT.CommandType.SREQ, MT.CommandSubsystem[subsystem], commandId, buffer);

  return deferred.promise;
};

module.exports.MonitorTestSerial = MonitorTestSerial;
