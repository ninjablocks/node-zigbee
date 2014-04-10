'use strict';

var Util = require('./util');

var MT = require('../mt/mt_constants');
var ZCL = require('../zcl/zcl_constants.js');
var types = require('./types');

var packets = {};

var RESERVED = 'RESERVED', IGNORED = 'IGNORED';

// 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
// 2.3.1 General ZCL Frame Format
packets.ZCL_FRAME = {
  FrameControl: {
    mask: ['ClusterSpecific', IGNORED, 'ManufacturerSpecific', 'ServerToClientDirection', 'DisableDefaultResponse'],
    type: 'uint8'
  },
  ManufacturerCode: {
    // This field shall only be included in the ZCL frame if the manufacturer 
    // specific sub-field of the frame control field is set to 1.
    write: function(builder, value) {
      if (this.FrameControl.ManufacturerSpecific) {
        builder.uint16le(value);
      }
    },
    read: function(parser, attrName) {
      parser.tap(function() {
        if (this.vars.FrameControl.ManufacturerSpecific) {
          this.uint16le(attrName);
        }
      });
    }
  },
  TransactionSequenceNumber: 'transaction',
  CommandIdentifier: {
    type: 'uint8',
    enum: ZCL.GeneralCommands
  },

  payload: 'payload'
};

// 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
// 2.4.1 - Read Attributes Command
packets.ZCL_READ_ATTRIBUTES = {
  Attributes: {
    type: 'array',
    subtype: 'attribute'
  }
};

// 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
// 2.4.2 - Read Attributes Response Command
packets.ZCL_READ_ATTRIBUTES_RESPONSE = {
  Attributes: {
    type: 'array',
    subtype: 'readAttributeRecord'
  }
};

// 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
// 2.4.3 - Write Attributes Command
// 2.4.4 - Write Attributes Undivided Command
// 2.4.6 - Write Attributes No Response Command
packets.ZCL_WRITE_ATTRIBUTES = {
  Attributes: {
    type: 'array',
    subtype: 'writeAttributeRecord'
  }
};

packets.ZCL_CONFIGURE_REPORTING = {
  Attributes: {
    type: 'array',
    subtype: 'attributeReportingConfigurationRecord'
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
    default: 20 // TODO: Where is this?
  },
  ClusterID: 'cluster',
  TransID: {
    type: 'transaction',
    default: 2 // TODO: Should we be setting this?
  },
  Options: {
    mask: [IGNORED, 'wildcardProfileId', IGNORED, 'ackRequest', 'discoverRoute', 'security', 'skipRouting'],
    type: 'uint8'
  },
  Radius: {
    type: 'uint8',
    default: 32
  },
  payload: 'payloadWithLength'
};

module.exports = Util.export(packets, types);