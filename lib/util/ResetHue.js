'use strict';

var Concentrate = require('concentrate');

function ResetHue(client) {
  this.client = client;
}

ResetHue.prototype.findHues = function() {

  var payload = Concentrate();

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