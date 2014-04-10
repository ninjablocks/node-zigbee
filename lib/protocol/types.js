'use strict';

var MT = require('../mt/mt_constants');
var ZCL = require('../zcl/zcl_constants');
var DataTypes = require('../zcl/DataTypes');

var types = {
  'address': {
    write: function(builder, value) {
      if (typeof value.mode == 'undefined') {
        value.mode = MT.AddressMode.ADDR_16_BIT;
      }

      if (value.mode.value) {
        value.mode = value.mode.value;
      }

      builder.uint8(value.mode);

      if (value.mode == MT.AddressMode.ADDR_16_BIT.value) {
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
  'payload': {
    type: 'buffer',
    read: function(parser, attribute) {
      console.log('WARN: Can\'t read unknown length payloads yet.');
    }
  },
  'payloadWithLength': {
    type: 'payload',
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
      console.log('attribute reporting record', data);
      builder.uint8(0x00); // TODO: DirectionField
      builder.uint16le(data.attributeIdentifier);
      builder.uint8(data.attributeDataType);
      builder.uint16le(data.minimumReportingInterval);
      builder.uint16le(data.maximumReportingInterval);
      //DataTypes.write(builder, data.reportableChange, data.attributeDataType);
    }
  }
};

module.exports = types;