'use strict';

var debug = require('debug')('Cluster');
var Concentrate = require('concentrate');
var Dissolve = require('dissolve');
var Enum = require('enum');
var when = require('when');

var profileStore = require('./ProfileStore');

var packets = require('../zcl/packets');
var ZNP = require('../znp/constants');
var ZCL = require('../zcl/constants.js');

/**
 * Represents a ZCL cluster on a specific endpoint on a device.
 * 
 * @param {Endpoint} endpoint
 * @param {Number} clusterId
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
      attr.id = parseInt(attr.id, 16);

      this.attributes[attr.name] = this.attributes[attr.id] = {
        name: attr.name,
        id: attr.id,
        type: profileStore.getTypeByName(attr.type),
        read: function() {
          return this.readAttributes(attr.id).then(function(responses) {
            var response = responses[attr.id];
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
      this.commands[command.name] = this.commands[commandId] = function(payload) {
        debug(this, 'Sending command', command, command.id, commandId);
        return this.sendClusterSpecificCommand(commandId, payload);
      }.bind(this);
    }.bind(this));
  }

}

/**
 * Helper method to run a command on this cluster.
 * 
 * @param  {Number} commandId The command identifier on this cluster
 * @param  {Buffer} payload The payload of the command
 * @return {Promise} A promise that resolves to a status
 */
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

/**
 * Fetches the list of supported attributes on the cluster
 * @param  {Number} startAttribute ID of first attribute to return
 * @param  {Number} maxAttributes Maximum number of attributes to return
 * @return {Promise} Resolves to an array of attribute descriptions (identifier and dataType)
 */
ZCLCluster.prototype.discoverAttributes = function(startAttribute, maxAttributes) {
  var payload = Concentrate()
    .uint16le(startAttribute)
    .uint8(maxAttributes)
    .result();

  debug(this, 'Discovering attributes');

  var self = this;

  return this.client.sendZCLFrame({
    FrameControl: {},
    DeviceShortAddress: this.endpoint.device.shortAddress,
    CommandIdentifier: ZCL.GeneralCommands.DiscoverAttributes,
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
  }).then(function(response) {
    var deferred = when.defer();

    var numAttributes = (response.payload.length - 1) / 3;
    var attributes = [];

    Dissolve()
      .uint8('discoveryComplete')
      .loop('attributes', function(end) {
        if (numAttributes) {
          this
            .uint16le('id')
            .uint8('type')
            .tap(function() {
              this.vars.type = profileStore.getType(this.vars.type);
              attributes.push(self.attributes[this.vars.id] || this.vars);
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
};

/**
 * Reads multiple attributes in the same request.
 * 
 * @param  {Attribute|String|Number...} attributes Can be an attribute object, an ID, or it's name.
 * @return {Promise} Resolves to an object with the requested attribute names as keys
 */
ZCLCluster.prototype.readAttributes = function() {

  var attributeIds = Array.prototype.slice.call(arguments).map(function(id) {
    if (typeof id.id !== 'undefined') { // It's an attribute object
      return id.id;
    } else if (typeof id === 'string') { // It's an attribute name
      return this.attributes[id].id;
    } else {
      return id;
    }
  }.bind(this));

  if (!attributeIds.length) {
    return this.discoverAttributes(0,100).then(function(attributes) {
      return this.readAttributes.apply(this, attributes);
    }.bind(this));
  }

  debug(this, 'Reading attributes', attributeIds);

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

  var attributes = Array.prototype.slice.call(arguments).map(function(attributeReport) {

    if (typeof attributeReport.id !== 'object') {
      attributeReport.attribute = this.attributes[attributeReport.id];
    }
    
    return attributeReport;
  }.bind(this));

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
  });
};

ZCLCluster.prototype.readReportingConfiguration = function() {

  var attributeIds = Array.prototype.slice.call(arguments).map(function(id) {
    if (id.id) { // It's an attribute object
      return id.id;
    } else if (typeof id === 'string') { // It's an attribute name
      return this.attributes[id].id;
    } else {
      return id;
    }
  }.bind(this));

  if (!attributeIds.length && this.description.attribute) {
    attributeIds = this.description.attribute.map(function(attribute) {
      return attribute.id;
    });
  }

  if (!attributeIds.length) {
    throw new Error('You must provide at least one attribute id or name');
  }

  var payload = packets.ZCL_READ_ATTRIBUTES.write({
    Attributes: attributeIds
  });

  debug(this, 'Read Reporting Configuration', attributeIds);

  return this.client.sendZCLFrame({
    FrameControl: {},
    DeviceShortAddress: this.endpoint.device.shortAddress,
    CommandIdentifier: ZCL.GeneralCommands.ReadReportingConfiguration,
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
  });
};


ZCLCluster.prototype.toString = function() {
  return this.endpoint + ' [Cluster: ' + this.clusterId.toString(16) + ' (' + this.description.name + ')]';
};

module.exports = ZCLCluster;