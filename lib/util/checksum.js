'use strict';

/**
 * Calculates the FCS for a given buffer.
 * @param  {Buffer} buffer
 * @return {Integer} FCS
 */
function calculateFCS(buffer) {
  var fcs = 0;

  for (var i = 0; i < buffer.length; i++) {
    fcs ^= buffer[i];
  }

  return fcs;
}

module.exports.calculateFCS = calculateFCS;
