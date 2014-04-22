'use strict';

var pakkit = require('pakkit');
var ZCL = require('./constants');
var DataTypes = require('./DataTypes');

var packets = {};

// 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
// 2.3.1 General ZCL Frame Format
packets.ZCL_FRAME = {
  FrameControl: {
    mask: ['ClusterSpecific', null, 'ManufacturerSpecific', 'ServerToClientDirection', 'DisableDefaultResponse'],
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

var attributeTypes = {
  'transaction': {
    type: 'uint8'
  },
  'payload': {
    type: 'buffer'
  },
  'attribute': {
    type: 'uint16le'
  },
  'array': {
    write: function(builder, data, attribute) {
      data.forEach(function(element) {
        attribute.subtype.write(builder, element, attribute.subtype);
      });
    },
    read: function(parser, attribute) {
      parser.loop(attribute.name, function(end) {
        attribute.subtype.read(this, attribute);
      });
    }
  },
  'readAttributeRecord': {
    read: function(parser, attribute) {
      parser
        .uint16le('attributeIdentifier')
        .uint8('status')
        .tap(function() {
          this.vars.status = ZCL.Status.get(this.vars.status);
          if (this.vars.status.key === 'SUCCESS') {
            this
              .uint8('attributeDataType')
              .tap(function() {
                DataTypes.read(this, this.vars.attributeDataType, 'value');
              });
          }
        });
    }
  },
  'writeAttributeRecord': {
    write: function(builder, data) {
      builder.uint16le(data.attributeIdentifier).uint8(data.attributeDataType);
      DataTypes.write(builder, data.attributeDataType, data.value);
    }
  },

  // 075366r02ZB_AFG-ZigBee_Cluster_Library_Public_download_version.pdf
  // 2.4.7.1 - Configure Reporting Command Frame Format
  'attributeReportingConfigurationRecord': {
    write: function(builder, data) {
      //console.log('attribute reporting record', data);

      builder.uint8(0x00); // TODO: DirectionField
      builder.uint16le(data.attribute.id);
      builder.uint8(data.attribute.type.id);
      builder.uint16le(data.minimumReportingInterval);
      builder.uint16le(data.maximumReportingInterval);

      if (data.attribute.type.analog) {
        DataTypes.write(builder, data.reportableChange, data.attribute.type.id);
      }
  
    }
  }
};


module.exports =  pakkit.export(packets, attributeTypes);