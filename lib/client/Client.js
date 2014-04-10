'use strict';

var debug = require('debug')('znp-client');
var Dissolve = require('dissolve');
var Concentrate = require('concentrate');
var when = require('when');
var when_sequence = require('when/sequence');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var Device = require('./Device');
var MT = require('../mt/mt_constants');
var ZCL = require('../zcl/zcl_constants');
var DataTypes = require('../zcl/DataTypes');

var packets = require('../protocol/packets');


/**
 * A ZigBee client, handling higher level functions relating to the ZigBee
 * network.
 * @param {MonitorTestSerial} monitorTestSerial The underlying MonitorTestSerial
 * interface responsible for communicating with the ZigBee SOC.
 */
function Client(monitorTestSerial) {
  this._devices = {};

  this.comms = monitorTestSerial;

  // bind for device state notifications
  this.comms.on('command:ZDO_STATE_CHANGE_IND', this._handleStateChange.bind(this));
  // bind for device announcements
  this.comms.on('command:ZDO_END_DEVICE_ANNCE_IND', this._handleDeviceAnnounce.bind(this));

  // bind for device endpoint responses
  this.comms.on('command:ZDO_MATCH_DESC_RSP', this._handleDeviceMatchDescriptionResponse.bind(this));
  this.comms.on('command:ZDO_ACTIVE_EP_RSP', this._handleDeviceMatchDescriptionResponse.bind(this));

  // bind for endpoint description responses
  this.comms.on('command:ZDO_SIMPLE_DESC_RSP', this._handleEndpointSimpleDescriptorResponse.bind(this));

  // handle incoming application framework (ZCL) messages
  this.comms.on('command:AF_INCOMING_MSG', this._handleAFIncomingMessage.bind(this));

  // handle attribute reports
  this.on('zcl-command:ReportAttributes', this._handleReportAttributes.bind(this));

}
util.inherits(Client, EventEmitter);

/**
 * Handler for device state changes (ZDO_STATE_CHANGE_IND).
 * @param  {[type]} packet
 * @return {[type]}
 */
Client.prototype._handleStateChange = function(packet) {
  var state = MT.ZDOState.get(packet.data[0]);

  this.emit('state_change', state);
};

/**
 * Handler for device announce (ZDO_END_DEVICE_ANNCE_IND).
 * @param  {[type]} packet
 * @return {[type]}
 */
Client.prototype._handleDeviceAnnounce = function(packet) {
  var doAnnounce = function(vars) {
    this._getDeviceByShortAddress(vars.srcAddr)
      .then(function(device) {
        device._setIEEEAddressFromBuffer(vars.IEEEAddr);
        this.emit('device_announce', device);
      }.bind(this));
  }.bind(this);

  Dissolve()
    .uint16le('srcAddr')
    .uint16le('nwkAddr')
    .buffer('IEEEAddr', 8)
    .uint8('capabilities')
    .tap(function() {
      doAnnounce(this.vars);
    })
    .write(packet.data);
};

Client.prototype._handleDeviceMatchDescriptionResponse = function(packet) {

  var self = this;

  var parser = Dissolve()
    .uint16le('srcAddr')
    .uint8('status')
    .uint16le('nwkAddr')
    .uint8('matchLength')
    .buffer('matchList', 'matchLength')
    .tap(function() {
      this.vars.status = MT.Status.get(this.vars.status);

      var response = this.vars;

      if (response.status.key == 'ZSuccess') {

        var endpointIds = Array.prototype.slice.call(response.matchList, 0);

        self._getDeviceByShortAddress(response.nwkAddr).then(function(device) {

          debug('_handleDeviceMatchDescriptionResponse',
            'Found endpoints', endpointIds, 'for device', device.IEEEAddress
          );

          device.emit('endpointIds', endpointIds);
        });
      } else {
        console.error('Bad status for ZDO_MATCH_DESC_RSP', response.status);
      }

    }).write(packet.data);

};

Client.prototype._handleEndpointSimpleDescriptorResponse = function(packet) {

  debug('_handleEndpointSimpleDescriptorResponse', packet);

  var self = this;

  var parser = Dissolve()
    .uint16le('srcAddr')
    .uint8('status')
    .uint16le('nwkAddr')
    .uint8('length')
    .uint8('endpoint')
    .uint16le('profileId')
    .uint16le('deviceId')
    .uint8('deviceVersion')
    .uint8('numInClusters')
    .tap(function() {
      this.buffer('inClustersBuf', this.vars.numInClusters * 2);
    })
    .uint8('numOutClusters')
    .tap(function() {
      this.buffer('outClustersBuf', this.vars.numOutClusters * 2);
    })
    .tap(function() {
      this.vars.status = MT.Status.get(this.vars.status);

      if (this.vars.status.key != 'ZSuccess') {
        console.error('Failed handling _handleEndpointSimpleDescriptorResponse. Status', this.vars.status);
        return;
      }

      this.vars.inClusters = [];
      this.vars.outClusters = [];

      for (var i = 0; i < this.vars.numInClusters; i++) {
        this.vars.inClusters.push( this.vars.inClustersBuf.readUInt16LE(2*i) );
      }

      for (var j = 0; j < this.vars.numOutClusters; j++) {
        this.vars.outClusters.push( this.vars.outClustersBuf.readUInt16LE(2*j) );
      }

      delete this.vars.inClustersBuf;
      delete this.vars.outClustersBuf;

      var response = this.vars;

      self._getDeviceByShortAddress(response.nwkAddr).then(function(device) {
        device.emit('simpleDescriptor:' + response.endpoint, response);
      });
    })
    .write(packet.data);
};


/**
 * Retrieves firmware version information from the device.
 * @return {promise} A promise that resolves to the version information for the
 * underlying device.
 */
Client.prototype.firmwareVersion = function() {
  return this.comms
    .request('SYS_VERSION')
    .then(function(versionPacket) {
      var deferred = when.defer();

      Dissolve()
        .uint8('transportRevision')
        .uint8('productId')
        .uint8('majorRelease')
        .uint8('minorRelease')
        .uint8('maintenanceRelease')
        .tap(function() {
          deferred.resolve({
            type: 'ti-znp',
            specifics: this.vars,
          });
        })
        .write(versionPacket.data);

      return deferred.promise;
    });
};

/**
 * Resets the device, optionally resetting all network settings.
 * @return {promise} A promise of the client coming back up, ready for new
 * commands.
 */
Client.prototype.resetDevice = function(resetNetworkSettings) {
  var reconnectDeferred = when.defer();

  // will resolve once the serial port is reconnected to the application
  this.comms.once('connected', function() {
    debug('Client::resetDevice', 'reconnect promise resolving');
    reconnectDeferred.resolve(this);
  }.bind(this));

  var _doReset = function() {
    this.comms.sendPacket(MT.CommandType.SREQ, MT.CommandSubsystem.SYS, MT.Commands.SYS.SYS_RESET_REQ);
  }.bind(this);

  // a confirmed response from the SOC
  var resetPromise;
  if (resetNetworkSettings) {
    var startupOptions = MT.StartupOption.get('STARTOPT_CLEAR_CONFIG | STARTOPT_CLEAR_STATE');
    resetPromise = this
      .writeConfiguration('ZCD_NV_STARTUP_OPTION', 1, startupOptions)
      .then(function() {
        return _doReset();
      }.bind(this));
  } else {
    resetPromise = when(_doReset());
  }

  resetPromise = resetPromise.then(function() {
    debug('Client::resetDevice', 'forcing serial port close');
    return this.comms.closePort();
  }.bind(this));

  // both of the above must finish
  return when.all([resetPromise, reconnectDeferred.promise]);
};

/**
 * Write a device configuration paramater.
 * @param  {enum} key
 * @param  {Integer} size
 * @param  {any} value
 * @return {promise} A promise of the configuration being written.
 */
Client.prototype.writeConfiguration = function(key, size, value) {
  var data = new Buffer(size);

  if ( typeof value == 'object' && value.hasOwnProperty('value') ) {
    value = value.value;
  }

  if ( typeof value == 'number' ) {
    if ( size == 1 ) {
      data.writeUInt8(value, 0);
    } else if ( size == 2 ) {
      data.writeUInt16LE(value, 0);
    } else if ( size == 4 ) {
      data.writeUInt32LE(value, 0);
    }
  }
  debug('writeConfiguration', key, data);
  var setConfigKey = Concentrate()
    .uint8(MT.ConfigurationParameters.ZCD.get(key).value) // ConfigId
    .uint8(size)
    .buffer(data)
    .result();

  return this.comms
    .request('ZB_WRITE_CONFIGURATION', setConfigKey)
    .then(function(response) {
      if (response.data[0] !== 0) {
        throw new Error('Invalid data');
      }

      return response;
    });
};

/**
 * Returns a promise that resolves when the device changes to the specifies state.
 * @param  {[type]} desiredState
 * @return {[type]}
 */
Client.prototype._promiseFutureState = function(desiredState) {
  var futureState = when.defer();

  var stateMonitor = function(state) {
    if (state == desiredState) {
      futureState.resolve(state);
      this.removeListener('state_change', stateMonitor);
    }
  };

  this.on('state_change', stateMonitor);

  return futureState.promise;
};

/**
 * Starts the local device as a coordinator, registering endpoints and
 * callbacks.
 * @return {promise} A promise that resolves when the device is in coordinator
 * role.
 */
Client.prototype.startCoordinator = function() {
  var becameCoordinator = this._promiseFutureState(MT.ZDOState.DEV_ZB_COORD);

  var startRequest = when_sequence([
    this.writeConfiguration.bind(this, 'ZCD_NV_STARTUP_OPTION', 1, 0), // don't clear on startup
    this.writeConfiguration.bind(this, 'ZCD_NV_ZDO_DIRECT_CB', 1, 1), // DO get direct callbacks
    this.writeConfiguration.bind(this, 'ZCD_NV_SECURITY_MODE', 1, 1),
    this.writeConfiguration.bind(this, 'ZCD_NV_LOGICAL_TYPE', 1, MT.LogicalType.COORDINATOR),
    this.writeConfiguration.bind(this, 'ZCD_NV_PANID', 2, 0xBEEF),
    this.writeConfiguration.bind(this, 'ZCD_NV_CHANLIST', 4, MT.Channel.CHANNEL_11)
  ])
  .then(function(results) {
    return this.comms.request('ZB_START_REQUEST').then(function(response) {
      if (response.data.length !== 0) {
        throw new Error('ZB_START_REQUEST failed');
      }
      return response;
    });
  }.bind(this));

  return when.all([startRequest, becameCoordinator])
    .then(this._registerApplicationEndpoint.bind(this))
    .then(this._startupFromApp.bind(this))
    .then(this._registerForCallbacks.bind(this));
};




/**** START ZCL ******/

Client.prototype._inFlight = new Array(256);
Client.prototype._sequence = 1;

var ZCL_RESPONSE_TIMEOUT = 20 * 1000;

Client.prototype.nextSequenceNumber = function() {
  if (++this._sequence > 255) {
    this._sequence = 1;
  }
  return this._sequence;
};

Client.prototype.sendZCLFrame = function(params, afParams) {

  debug('sendZCLFrame', 'ZCL data >>', params);

  var sequenceNumber = this.nextSequenceNumber();
  if (this._inFlight[sequenceNumber]) {
    throw new Error(
      'Too many pending requests! Sequence number', sequenceNumber, 'has not had a response or timed out.',
      'Consider lowering the timeout.'
    );
  }

  params.TransactionSequenceNumber = sequenceNumber;

  var zclFrame = packets.ZCL_FRAME.write(params);

  var deferred = when.defer();

  var fail = function(reason) {
    deferred.error(reason);
    delete this._inFlight[sequenceNumber];
  }.bind(this);

  this._inFlight[sequenceNumber] = deferred;

  afParams.payload = zclFrame;

  this.sendAFDataRequest(afParams)
    .then(function(status) {
      if (status.key !== 'ZSuccess') {
        fail(status);
      }
    })
    .catch(fail);

  return deferred.promise.timeout(ZCL_RESPONSE_TIMEOUT);
};

/**
 * Send an Application Framework Request to the endpoint.
 * @param {[type]} destination
 * @param {[type]} data
 */
Client.prototype.sendAFDataRequest = function(params) {

  debug('AFDataRequest', 'AF data >>', params);

  var payload = packets.AF_DATA_REQUEST_EXT.write(params);

  return this.comms.request('AF_DATA_REQUEST_EXT', payload).then(this._parseStatus);
};

Client.prototype._handleAFIncomingMessage = function(packet) {

  debug('_handleAFIncomingMessage', packet);

  var self = this;

  var parser = Dissolve()
    .uint16le('groupId')
    .uint16le('clusterId')
    .uint16le('srcAddr')
    .uint8('srcEndpoint')
    .uint8('destEndpoint')
    .uint8('wasBroadcast')
    .uint8('linkQuality')
    .uint8('securityUse')
    .uint32le('timestamp')
    .uint8('transSeqNumber')
    .uint8('len')
    .buffer('data', 'len')

    .tap(function() {
      var message = this.vars;

      debug('_handleAFIncomingMessage', 'parsed', message);

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

          debug('_handleAFIncomingMessage', 'parse ZCL', zclMessage);

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

    })
    .write(packet.data);
};

Client.prototype._handleReportAttributes = function(message) {

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

/****** END ZCL *******/



/**
 * Runs ZDO startup, checking for success. Returns a promise that resolves only
 * if the network is started successfully.
 * @private
 * @return {[type]}
 */
Client.prototype._startupFromApp = function() {
  var startupPayload = Concentrate()
    .uint16le(0) // startDelay
    .result();
  return this.comms
    .request('ZDO_STARTUP_FROM_APP', startupPayload)
    .then(function(response) {
      var statuses = [
        'Restored network state',
        'New network state',
        'Leave and not Started',
      ];
      var status = response.data[0];
      var desc = statuses[status];

      if (status >= 2) {
        throw new Error('Invalid response from ZDO_STARTUP_FROM_APP: ' + desc);
      }

      debug('_startupFromApp', 'Success:', desc);

      return {
        status: {
          id: status,
          msg: desc,
        }
      };
    });
};

/**
 * Registers for callbacks
 * @return {[type]}
 */
Client.prototype._registerForCallbacks = function() {
  var cbRegisterPayload = Concentrate()
    .uint16le(0x500) // clusterID
    .result();

  return this.comms
    .request('ZDO_MSG_CB_REGISTER', cbRegisterPayload)
    .then(this._parseStatus)
    .then(function(status) {

      debug('registerApplicationEndpoint', 'response status', status);
      if (status.key !== 'ZSuccess') {
        throw new Error('ZDO_MSG_CB_REGISTER failed with error: ' + status.key);
      }

      return status;
    });
};

var SRC_ENDPOINT = 20; // FIXME: this is hardcoded, but shouldn't be.
/**
 * Registers an application endpoint on the ZigBee SOC.
 * @return {promise} A promise that resolves when the endpoint is registered.
 */
Client.prototype._registerApplicationEndpoint = function() {
  var registerPayload = Concentrate()
    .uint8(SRC_ENDPOINT) // AppEndPoint
    .uint16le(0x0104) // AppProfileID
    .uint16le(0x0000) // DeviceId (ignored)
    .uint8(0) // DeviceVersion (ignored)
    .uint8(0x00) // LatencyReq (0x00-No latency)
    .uint8(1) // AppNumInClusters
    // AppInClusterList here:
      .uint16le(0x0000) // Basic
    .uint8(1) // AppNumOutClusters
     // AppOutClusterList here
      .uint16le(0x0500) // IAS Zone
    .result();

  return this.comms
    .request('AF_REGISTER', registerPayload)
    .then(this._parseStatus)
    .then(function(status) {

      debug('registerApplicationEndpoint', 'response status', status);
      if (status.key !== 'ZSuccess' && status.key !== 'ZApsDuplicateEntry') {
        throw new Error('registerApplicationEndpoint failed with error: ' + status.key);
      }

      return status;
    });
};

// TODO: Pull me out
var BROADCAST_ADDRESS = 0xFFFC;

/**
 * Controls the joining permissions, allowing or disallowing new devices to join the network.
 * @param {Number} timeout The time in seconds (1-254) that the network will permit new devices to join. 0 = Disable indefinitely, 255 = Enable indefinitely.
 * @param {Number} (destination) The address of the device for which the join permissions are to be set. Default: All devices
 * @return {Promise} A promise that resolves when the join permissions are set
 */
Client.prototype.permitJoin = function(timeout, destination) {

  console.error('permitJoin doesn\'t work yet');

  if (timeout < 0) {
    throw new Error('The permit join timeout can not be below 0 (0 means "forbid indefinitely")');
  }

  if (timeout > 255) {
    throw new Error('The permit join timeout can not be above 255 (255 means "permit indefinitely")');
  }

  debug('permitJoin', timeout, destination);

  var payload = Concentrate();

  if (typeof destination == 'undefined') {
    payload.uint16le(BROADCAST_ADDRESS);
  } else {
    payload.uint16le(destination);
  }

  payload.uint16le(0); // Pad address field (ignored)

  payload
    .uint8(timeout)
    .uint8(1); // XXX: TODO: What is trust center significance?

  return this.comms
    .request('ZDO_MGMT_PERMIT_JOIN_REQ', payload.result())
    .then(this._parseStatus)
    .then(function(status) {

      debug('permitJoin', 'response status', status);
      if (status.key !== 'ZSuccess') {
        throw new Error('Permit join failed with error: ' + status.key);
      }

      return status;
    });

};

Client.prototype.devices = function() {
  return this._getNumDevices()
    .then(function(numDevices) {
      debug('devices', numDevices + ' devices currently paired');

      var deviceReqs = [];
      for (var i = 0; i < numDevices; i++) {
        deviceReqs.push( this._getDeviceByIndex.bind(this, i) );
      }

      return when_sequence(deviceReqs);
    }.bind(this));
};

/**
 * Returns a promise that resolves to the number of paired devices associated to
 * our local coordinator.
 * @return {[type]}
 */
Client.prototype._getNumDevices = function() {
  var assocCountPayload = Concentrate()
    .uint8(MT.NodeRelation.PARENT.value) // startRelation
    .uint8(MT.NodeRelation.OTHER.value) // endRelation
    .result();
  return this.comms
    .request('UTIL_ASSOC_COUNT', assocCountPayload)
    .then(function(response) {
      return response.data[0];
    });
};

/**
 * Returns the Nth device by index in the internal table. This seems race-y, but
 * is how people seem to do it. Hopefully devices are never removed from this
 * table at runtime, only disabled in it.
 * @return {[type]}
 */
Client.prototype._getDeviceByIndex = function(deviceIndex) {
  // return cached device if we have one.
  if (this._devices.hasOwnProperty(deviceIndex)) {
    return when(this._devices[deviceIndex]);
  }

  // request device with this address manager index from the SOC
  var assocCountPayload = Concentrate()
    .uint8(deviceIndex) // number
    .result();

  return this.comms
    .request('UTIL_ASSOC_FIND_DEVICE', assocCountPayload)
    .then(function(response) {
      return this._cacheDeviceFromPayload(response.data);
    }.bind(this));
};

/**
 * Returns a device by network adddress.
 * @return {[type]}
 */
Client.prototype._getDeviceByShortAddress = function(shortAddress) {
  // return cached device if we have one
  for (var idx in this._devices) {
    var device = this._devices[idx];
    if (device.shortAddress == shortAddress) {
      return when(device);
    }
  }

  // request device with this shortAddress from the SOC
  var assocPayload = Concentrate()
    .buffer(new Buffer([0,0,0,0,0,0,0,0]))
    .uint16le(shortAddress) // number
    .result();

  return this.comms
    .request('UTIL_ASSOC_GET_WITH_ADDRESS', assocPayload)
    .then(function(response) {
      return this._cacheDeviceFromPayload(response.data);
    }.bind(this));
};

Client.prototype._cacheDeviceFromPayload = function(payload) {
  var devicePromise = Device.deviceForInfo(this, this._parseDeviceInfo(payload));

  return devicePromise.tap(function(device) {
    this._devices[device.deviceInfo.addrIdx] = device;
  }.bind(this));
};

/**
 * Returns a promise of a parsed device info object from a payload Buffer.
 * @param  {[type]} deviceInfoPayload
 * @return {[type]}
 */
Client.prototype._parseDeviceInfo = function(deviceInfoPayload) {
  var deferred = when.defer();

  var parser = Dissolve()
    .uint16le('shortAddr')
    .uint16le('addrIdx')
    .uint8('nodeRelation')
    .uint8('devStatus')
    .uint8('assocCnt')
    .uint8('age')
    .uint8('txCounter')
    .uint8('txCost')
    .uint8('rxLqi')
    .uint8('inKeySeqNum')
    .uint32le('inFrmCntr')
    .uint16le('txFailure')
    .tap(function() {
      this.vars.devStatus = MT.ZDOState.get(this.vars.devStatus);
      debug('_parseDeviceInfo', 'DEVICE FOUND:', this.vars);

      deferred.resolve(this.vars);
    })
    .write(deviceInfoPayload);

  return deferred.promise;
};

Client.prototype._parseStatus = function(statusPayload) {
  return MT.Status.get(statusPayload.data[0]);
};

module.exports.Client = Client;
