'use strict';

var debug = require('debug')('zcl');
var Concentrate = require('concentrate');
var Dissolve = require('dissolve');
var Enum = require('enum');
var when = require('when');

var profileStore = new (require('./ProfileStore'))(['ha', 'zll']);

var packets = require('../protocol/packets');
var MT = require('../mt/mt_constants');
var ZCL = require('./zcl_constants.js');

/**
 * Represents a ZCL cluster on a specific endpoint on a device.
 * @param {[type]} endpoint
 * @param {[type]} clusterId
 */
function ZCLCluster(endpoint, clusterId) {
  this.endpoint = endpoint;
  this.device = this.endpoint.device;
  this.client = this.device.client;
  this.comms = this.client.comms;

  this.clusterId = clusterId;

  this.description = profileStore.getCluster(clusterId) || {
    name: 'UNKNOWN DEVICE'
  };

  this.name = this.description.name;

  this.attributes = {};

  if (this.description.attribute) {
    this.description.attribute.forEach(function(attr) {
      var attrId = parseInt(attr.id, 16);

      this.attributes[attr.name] = this.attributes[attrId] = {
        name: attr.name,
        id: attr.id,
        read: function() {
          return this.readAttributes(attrId).then(function(responses) {
            var response = responses[attrId];
            console.log('Responses', responses);
            if (response.status.key !== 'SUCCESS') {
              throw new Error('Failed to get attribute. Status', status);
            }
            return response.value;
          });
        }.bind(this)
        /*,

        write: function(value) {
          return this.writeAttributes(attrId).then(function(responses) {
            var response = responses[0];
            if (response.status.key !== 'SUCCESS') {
              throw new Error('Failed to get attribute. Status', status);
            }
            return response.value;
          });
        }.bind(this)*/

      };
    }.bind(this));
  }

  this.commands = {};

  if (this.description.command) {
    this.description.command.forEach(function(command) {
      var commandId = parseInt(command.id, 16);
      console.log('Command id', commandId, command.id);
      this.commands[command.name] = this.commands[commandId] = function(payload) {
        console.log('Sending command', command, command.id, commandId);
        return this.sendClusterSpecificCommand(commandId, payload);
      }.bind(this);
    }.bind(this));
  }

}

ZCLCluster.prototype.sendClusterSpecificCommand = function(commandId, payload) {
  payload = payload || new Buffer(0);

  debug(this, 'Sending cluster specific command', commandId, payload);

  return this.client.sendZCLFrame({
    FrameControl: {
      ClusterSpecific: true
    },
    DeviceShortAddress: this.endpoint.device.shortAddress,
    CommandIdentifier: commandId,
    payload: payload
  }, {
    DstAddr: {
      address: this.endpoint.device.shortAddress
    },
    DstEndpoint: this.endpoint.endpointId,
    ClusterID: this.clusterId,
    Options: {
      ackRequest: true,
      discoverRoute: true
    }
  });

};

/* TODO: Use new sendZCL function
ZCLCluster.prototype.discoverAttributes = function(startAttribute, maxAttributes) {
  var payload = Concentrate()
    .uint16le(startAttribute)
    .uint8(maxAttributes)
    .result();

  debug(true, 'Discovering attributes');

  return this.client.sendZCLFrame(null, this.endpoint.device.shortAddress,
  this.endpoint.endpointId, this.clusterId, false, null, ZCL.GeneralCommands.DiscoverAttributes, payload)
    .then(function(response) {
      var deferred = when.defer();

      var numAttributes = (response.payload.length - 1) / 3;
      var attributes = [];

      Dissolve()
        .uint8('discoveryComplete')
        .loop('attributes', function(end) {
          if (numAttributes) {
            this
              .uint16le('identifier')
              .uint8('dataType')
              .tap(function() {
                attributes.push(this.vars);
                //this.push(this.vars); // XXX: This isn't working, I only get the first attribute?
                //this.vars = {};
              });
            numAttributes--;
          }
          if (!numAttributes) {
            end(true);
          }
        })
        .tap(function() {
          deferred.resolve(attributes);
        })
        .write(response.payload);

      return deferred.promise;
    });
};*/

ZCLCluster.prototype.readAttributes = function() {
  var attributeIds = Array.prototype.slice.call(arguments).map(function(id) {
    if (id.id) { // It's an attribute object
      return id.id;
    } else if (typeof id === 'string') { // It's an attribute name
      return this.attributes[id].id;
    } else {
      return id;
    }
  }.bind(this));

  debug(this, 'Reading attributes', attributeIds, packets.ZCL_READ_ATTRIBUTES.attributes);

  var payload = packets.ZCL_READ_ATTRIBUTES.write({
    Attributes: attributeIds
  });

  return this.client.sendZCLFrame({
    FrameControl: {},
    DeviceShortAddress: this.endpoint.device.shortAddress,
    CommandIdentifier: ZCL.GeneralCommands.ReadAttributes,
    payload: payload
  }, {
    DstAddr: {
      address: this.endpoint.device.shortAddress
    },
    DstEndpoint: this.endpoint.endpointId,
    ClusterID: this.clusterId,
    Options: {
      ackRequest: true,
      discoverRoute: true
    },
  }).then(this._parseReadAttributesResponse.bind(this));
};

ZCLCluster.prototype._parseReadAttributesResponse = function(data) {
  var attributes = packets.ZCL_READ_ATTRIBUTES_RESPONSE.read(data.payload).Attributes;

  var response = {};

  attributes.forEach(function(a) {
    response[a.attributeIdentifier] = a;
    if (a.status.value === 0) { // We only care if we have it.
      if (this.attributes[a.attributeIdentifier]) {
        a.name = this.attributes[a.attributeIdentifier].name;
      } else {
        a.name = 'Unknown attribute. Please add to the XCL XML.';
      }
      response[a.name] = a.value;
    }
  }.bind(this));

  return response;
};

ZCLCluster.prototype.reportAttributes = function() {
  var attributes = Array.prototype.slice.call(arguments);

  debug(this, 'Reporting attributes', attributes);

  var payload = packets.ZCL_CONFIGURE_REPORTING.write({
    Attributes: attributes
  });

  return this.client.sendZCLFrame({
    FrameControl: {},
    DeviceShortAddress: this.endpoint.device.shortAddress,
    CommandIdentifier: ZCL.GeneralCommands.ConfigureReporting,
    payload: payload
  }, {
    DstAddr: {
      address: this.endpoint.device.shortAddress
    },
    DstEndpoint: this.endpoint.endpointId,
    ClusterID: this.clusterId,
    Options: {
      ackRequest: true,
      discoverRoute: true
    },
  });//.then(this._parseReadAttributesResponse.bind(this));
};


ZCLCluster.prototype.toString = function() {
  return this.endpoint + ' [Cluster: ' + this.clusterId.toString(16) + ' (' + this.description.name + ')]';
};

module.exports.ZCLCluster = ZCLCluster;