'use strict';

var pakkit = require('pakkit');
var ZNP = require('./constants');

var packets = {};

// CC2530ZNP Interface Specification.pdf
// 4.3.4 ZB_PERMIT_JOINING_REQUEST
packets.ZB_PERMIT_JOINING_REQUEST = {
  Destination: {
    default: 0xFFFC, // "special broadcast address that denotes all routers and coordinator"
    type: 'uint16le'
  },
  Timeout: {
    default: 60,
    type: 'uint8'
  }
};

// CC2530ZNP Interface Specification.pdf
// 4.4.3 AF_DATA_REQUEST_EXT
packets.AF_DATA_REQUEST_EXT = {
  DstAddr: 'address',
  DstEndpoint: 'endpoint',
  DstPanId: {
    type: 'pan',
    default: 0x0000 // Intra-pan
  },
  SrcEndpoint: {
    type: 'endpoint',
    default: 1 // TODO: Where is this?
  },
  ClusterID: 'cluster',
  TransID: {
    type: 'transaction',
    default: 2 // TODO: Should we be setting this?
  },
  Options: {
    mask: [null, 'wildcardProfileId', null, 'ackRequest', 'discoverRoute', 'security', 'skipRouting'],
    type: 'uint8'
  },
  Radius: {
    type: 'uint8',
    default: 32
  },
  payload: 'payloadWithLength'
};


var attributeTypes = {
  'address': {
    write: function(builder, value) {
      if (typeof value.mode == 'undefined') {
        value.mode = ZNP.AddressMode.ADDR_16_BIT;
      }

      if (value.mode.value) {
        value.mode = value.mode.value;
      }

      builder.uint8(value.mode);

      if (value.mode == ZNP.AddressMode.ADDR_16_BIT.value) {
        builder
          .uint16le(value.address)
          .buffer(new Buffer([0,0,0,0,0,0])); // ignored, just padding.
      } else {
        throw new Error('Only 16-bit address types are supported at the moment');
      }
    },
    read: function(parser, attribute) {
      var skipAttr = attribute.name + 'Skip';
      var modeAttr = attribute.name + 'Mode';

      parser
        .uint8(modeAttr)
        .uint16le(attribute.name)
        .buffer(skipAttr, 6)
        .tap(function() {
          this.vars[attribute.name] = {
            mode: this.vars[modeAttr],
            address: this.vars[attribute.name]
          };

          delete(this.vars[modeAttr]);
          delete(this.vars[skipAttr]);
        });
    }
  },
  'endpoint': {
    type: 'uint8'
  },
  'pan': {
    type: 'uint16le'
  },
  'cluster': {
    type: 'uint16le'
  },
  'attribute': {
    type: 'uint16le'
  },
  'transaction': {
    type: 'uint8'
  },
  'payloadWithLength': {
    write: function(builder, data) {
      builder.uint16le(data.length).buffer(data);
    },
    read: function(parser, attribute) {
      parser
        .uint16le(attribute.name + 'Length')
        .buffer(attribute.name, attribute.name + 'Length')
        .tap(function() {
          delete(this.vars[attribute.name + 'Length']);
        });
    }
  }
};


module.exports =  pakkit.export(packets, attributeTypes);
