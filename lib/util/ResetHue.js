'use strict';

var Concentrate = require('concentrate');

function ResetHue(client) {
  this.client = client;
}

ResetHue.prototype.findHues = function() {

  console.log('Finding');

  //Client.prototype.sendZCLFrame = function(panId, deviceShortAddress, endpointId, clusterId, manufacturerCode, commandIdentifier, payload)

  //this.client.sendZCLFrame(0xffff, 0xffff, 0x0000, 0x1000, 0x0000, 0x00, new Buffer(0));
//function(panId, deviceShortAddress, endpointId, clusterId, data)
 // var payload = new Buffer('13 02 27 01 1A 83 00 28 11'.split(' ').reverse().join(''), 'hex');
  //this.client.sendAFDataRequest(0xffff, 0xffff, 0x00, 0x1000, payload);
  var payload = Concentrate();
          //payload.uint32le(12345); // Inter-PAN transaction identifier
          //payload.uint16le(15); // Identify duration (seconds)
//Client.prototype.sendZCLFrame = function(panId, deviceShortAddress, endpointId, clusterId, clusterSpecific, manufacturerCode, commandIdentifier, payload) {

  this.client.sendZCLFrame({
    FrameControl: {
      ClusterSpecific: true,
      DisableDefaultResponse: true
    },
    DeviceShortAddress: 0xffff,
    CommandIdentifier: 0x00, // Scan Request
    payload: payload.result()
  }, {
    DstAddr: {
      address: 0xffff // Wildcard
    },
    DstEndpoint: 0,
    DstPanId: 0xffff,
    ClusterID: 0x1000, // ZCL Commissioning
    Options: {
      ackRequest: true,
      wildcardProfileId: true
    }
  }).then(function(response) {
    console.log('response from indentify command', response);
  }.bind(this)).catch(function(err) {
    console.error(err.stack);
  });
};


module.exports = ResetHue;