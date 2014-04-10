'use strict';

var _ = require('underscore');
var Dissolve = require('dissolve');
var Concentrate = require('concentrate');

var debug = require('debug')('protocol-exporter');

var CORE_TYPES = ['uint8', 'uint16le', 'uint32le', 'buffer', 'string'];

/*
 * This function sorts out the type heirarchy, using the parent type's properties
 * and read/write functions when they are available (and creating new read/write
 * functions if it resolves to a standard type.)

 * TODO: Add all the missing zigbee types to Concentrate.
 */
function resolveTypes(types) {

  CORE_TYPES.forEach(function(t) {
    if (!types[t]) {
      types[t] = {type:t, resolved:true};
    }
  });

  // Resolve the type structure by copying all properties and read/write functions from the parent to the child 
  // (if they aren't already defined)
  // Can (and will often be) run multiple times on the same object.
  // XXX: This is pretty 
  function resolveType(type) {

    if (typeof type !== 'object') {
      throw new Error('Type definition must be an object. Illegal value: ', type);
    }

    var parent = types[type.type];

    while (parent && !type.resolved) {
      resolveType(parent);

      _.defaults(type, JSON.parse(JSON.stringify(parent)));
      type.write = type.write || parent.write;
      type.read = type.read || parent.read;
      type.type = parent.type; // Always switch to the parent's type.
      parent = types[type.type];
    }

  }

  Object.keys(types).forEach(function(name) {

    var type = types[name];
    resolveType(type);

    type.name = name;
  });

  Object.keys(types).forEach(function(name) {

    var type = types[name];
    // Add any missing read/write functions

    if (!type.write) {
      type.write = function(builder, value, attribute) {

        if (attribute.mask) {
          if (typeof value == 'object') {
            var mask = '';
            attribute.mask.slice().reverse().forEach(function(property) {
              mask += value[property]?'1':'0'; // XXX: Is this a problem performance-wise?
            });

            //console.log('Created mask for ', attribute.name, mask, value);
            value = parseInt(mask, 2);

            //console.log('MASK VAL', attribute.name, value);
          }
        }

        if (attribute.enum) {
          switch(typeof value) {
            case 'string': value = attribute.enum[value]; break;
            case 'number': value = attribute.enum.get(value); break;
          }
          value = value.value;
        }
        
        builder[attribute.type](value);
      };
    }

    if (!type.read) {
      type.read = function(parser, attribute) {
        parser[attribute.type](attribute.name);

        /*parser.tap(function() {
          console.log('Read attribute', attribute.name, this.vars[attribute.name]);
        });*/

        if (attribute.mask) {

          parser.tap(function() {
            var value = {};
            this.vars[attribute.name].toString(2).split('').reverse().forEach(function(bit, pos) {
              value[attribute.mask[pos]] = (bit === '1');
            });
            this.vars[attribute.name] = value;
          });
        }
      };
    }

  });

  //console.log('Resolved types', types);

  return types;
}

module.exports = {
  export: function(packets, types) {

    // First. We resolve the types
    resolveTypes(types);

    var exported = {};
    Object.keys(packets).forEach(function(name) {

      var inPacket = packets[name];

      debug('exporting packet', inPacket);

      var packet = {
        name: name,
        attributes: []
      };

      Object.keys(inPacket).forEach(function(attName) {

        var attribute = inPacket[attName];

        // Allow attribute to just be a string link to a type
        if (typeof attribute === 'string') {
          attribute = {type: attribute};
        }

        // Then, use the types props and read/write functions in our attribute (but prefer our own)
        //console.log('Checking attribute ' + attName);
        var type = types[attribute.type];
        //console.log('Type?', type);

        if (type) {
          _.defaults(attribute, JSON.parse(JSON.stringify(type)));
          attribute.write = attribute.write || type.write;
          attribute.read = attribute.read || type.read;
          attribute.type = type.type;
        }

        // Link through the subtype when given (for arrays)
        if (attribute.subtype) {
          if (!types[attribute.subtype]) {
            new Error('Subtype', attribute.subtype, 'was not defined in the types.');
          }

          attribute.subtype = types[attribute.subtype];
        }
        
        attribute.name = attName;

        packet.attributes.push(attribute);
      });

      debug('exported', require('util').inspect(packet, {colors:true}));

      packet.write = function(values) {

        console.log('-- Building', packet.name, ' with ', values);

        var builder = Concentrate();

        packet.attributes.forEach(function(attr) {

          var value = values[attr.name];

          if (typeof value == 'undefined') {
            value = attr.default;
          }

          console.log('----- Set', value, 'on', attr, attr.name);

          attr.write.call(values, builder, value, attr);
        });

        return builder.result();
      };

      packet.read = function(buffer) {

        // XXX: This relies on the dissolve methods all being synchronous. Arrays aren't. This is a problem.
        var output = {};

        var parser = Dissolve();
        parser.tap(function() {
          this.vars = output;
        });

        packet.attributes.forEach(function(attr) {
          attr.read(parser, attr);
        });

        parser.write(buffer);

        return output;
      };

      exported[packet.name] = packet;

    });
    return exported;
  }
};