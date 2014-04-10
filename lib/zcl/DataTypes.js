'use strict';

var int24 = require('int24');

module.exports = {

  write: function(builder, data, dataType) {

    // TODO: Add all the missing ones.
    switch (dataType) {
      case 0x00: /* No data */ break;

      /* General data */
      case 0x08:
      case 0x09:
      case 0x0a:
      case 0x0b:
      case 0x0c:
      case 0x0d:
      case 0x0e:
      case 0x0f:
        if (data.length != (dataType-7)) {
          throw Error('Buffer for field is incorrect length. Required :', (dataType-7), 'actual :', data.length);
        }
        builder.buffer(data); break;

      case 0x10: builder.uint8(data?1:0); break;

      //* TODO: Bitmap
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x1f:
        if (data.length != (dataType-23)) {
          throw Error('Buffer for bitmap field is incorrect length. Required :', (dataType-23), 'actual :', data.length);
        }
        builder.buffer(data); break;
      
      case 0x20: builder.uint8(data); break;
      case 0x21: builder.uint16le(data); break;
      case 0x22:
        var uint24buf = new Buffer(3);
        int24.writeUInt24LE(uint24buf, 0, data);
        builder.buffer(uint24buf);
        break;

      case 0x23: builder.uint32le(data); break;

      case 0x28: builder.int8(data); break;
      case 0x29: builder.int16le(data); break;
      case 0x2a:
        var int24buf = new Buffer(3);
        int24.writeInt24LE(int24buf, 0, data);
        builder.buffer(int24buf);
        break;

      case 0x31: builder.int32le(data); break;

      case 0x42: builder.uint8(data.length).string(data); break;
      case 0x44: builder.uint16le(data.length).string(data); break;

      case 0xf0:
        if (data.length !== 8) {
          throw new Error('IEEE value for field must be a buffer with length 8. Got:', data.length);
        }
        builder.buffer(data);
        break;

      default:
        throw new Error('TODO: zcl/DataTypes.write - Unknown data type - ', '0x'+dataType.toString(16), 'for field');
    }
  },

  read: function(parser, dataType, fieldName) {

    // TODO: Add all the missing ones.
    switch (dataType) {
      case 0x00: /* No data */ break;

      /* General data */
      case 0x08:
      case 0x09:
      case 0x0a:
      case 0x0b:
      case 0x0c:
      case 0x0d:
      case 0x0e:
      case 0x0f: parser.buffer(fieldName, (dataType-7)); break;

      case 0x10: parser.uint8(fieldName).tap(function() { // Boolean
        this.vars[fieldName] = !!this.vars[fieldName];
      }); break;

      /* TODO: Bitmap (how do we map them? add a function to the buffer that accepts an array of prop names? with values?) */
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x1f: parser.buffer(fieldName, (dataType-23)); break;
      
      case 0x20: parser.uint8(fieldName); break;
      case 0x21: parser.uint16le(fieldName); break;
      case 0x22: parser.buffer(fieldName+'Buffer', 3)
        .tap(function() {
          this.vars[fieldName] = int24.readUInt24LE(this.vars[fieldName+'Buffer'], 0);
        }); break;
      case 0x23: parser.uint32le(fieldName); break;

      case 0x25: parser.uint32le(fieldName+'Part1').uint16le(fieldName+'Part2'); break;

      case 0x28: parser.int8(fieldName); break;
      case 0x29: parser.int16le(fieldName); break;
      case 0x2a: parser.buffer(fieldName+'Buffer', 3)
        .tap(function() {
          this.vars[fieldName] = int24.readInt24LE(this.vars[fieldName+'Buffer'], 0);
        }); break;
      case 0x31: parser.int32le(fieldName); break;

      case 0x42: parser.uint8(fieldName+'Length').string(fieldName, fieldName+'Length'); break;
      case 0x44: parser.uint16le(fieldName+'Length').string(fieldName, fieldName+'Length'); break;

      case 0xf0: parser.buffer(fieldName, 8).tap(function() { // IEEE Address
          // We override the IEEE addresses toString to give us a nice human-readable 
          // one that matches up with what's shown on the user's device.
          this.vars[fieldName].toString = function() {
            var part1 = this.readUInt32LE(4).toString(16);
            var part2 = this.readUInt32LE(0).toString(16);
            return (pad(part1, 8) + pad(part2, 8)).toUpperCase();
          };
      }); break;

      default:
        throw new Error('TODO: zcl/DataTypes.read - Unknown data type - ', '0x'+dataType.toString(16), 'for field', fieldName);
    }

  }
};

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}