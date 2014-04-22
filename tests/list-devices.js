'use strict';

var ZCLClient = require('../lib/zcl/ZCLClient');
var client = new ZCLClient();
var _ = require('underscore');

var glob = require('glob');

glob('{/dev/tty.zigbee,/dev/cu.usbmodem*}', function (err, devices) {
  // TODO: Support the CC2530 on the Sphere.
  if (err || devices.length != 1) {
    //throw new Error('Found ' + devices.length + ' devices that could be the CC2531 usb dongle.');
  }

  client.connectToPort(devices[0])
    .then(client.firmwareVersion.bind(client))
    .then(function(version) {

      var versionString = [
        version.specifics.majorRelease,
        version.specifics.minorRelease,
        version.specifics.maintenanceRelease
      ].join('.');

      console.log('CC2530/1 firmware version: %s %s', version.type, versionString);

    })
    /*/ reset our device so we get back to a clean state
    .then(function() {
      client.resetDevice(false);
    })//*/
    .then(client.startCoordinator.bind(client))
    .then(function() {

      var seen = {};
      
      setInterval(function() {
        client.devices().then(function(devices) {
          devices.forEach(function(device) {
            if (seen[device.IEEEAddress]) {
              return;
            }
            seen[device.IEEEAddress] = true;

            console.log('Found', device.toString());
            device.on('endpoint', function(endpoint) {
              console.log('Found', endpoint.toString());

              endpoint.inClusters().then(function(clusters) {

                clusters.forEach(function(cluster) {
                  console.log('Found', cluster.toString());
                  /*cluster.discoverAttributes(0, 100).then(function(attributes) {
                    console.log('Attributes', cluster.toString(), attributes);
                  });*/

                  cluster.readAttributes().then(function(values) {
                    console.log('Attributes', cluster.toString(), values);
                  }).catch(function(e) {
                    console.log('Attributes read fail', cluster.toString(), e.stack);
                  });

                  /*try {
                    cluster.readReportingConfiguration().then(function(values) {
                      console.log('Read reporting', cluster.toString(), values);
                    }).catch(function(e) {
                      console.log('Read reporting fail', cluster.toString(), e);
                    });
                  } catch(e) {
                    console.error('sss', e.stack);
                  }*/

                });

                var colorCluster = _.findWhere(clusters, {name: 'Color Control'});
                var onOffCluster = _.findWhere(clusters, {name: 'On/Off'});
                var meteringCluster = _.findWhere(clusters, {name: 'Simple Metering'});

                if (meteringCluster) {
                 /* meteringCluster.discoverAttributes(0, 100).then(function(attributes) {
                    console.log('Attributes', meteringCluster.toString(), attributes);
                  });

                  meteringCluster.attributes.InstantaneousDemand.read(function(value) {
                    console.log('InstantaneousDemand value', meteringCluster.toString(), value);
                  });

                  meteringCluster.reportAttributes({
                    id:'InstantaneousDemand',
                    minimumReportingInterval: 10,
                    maximumReportingInterval: 20,
                    reportableChange: 5
                  }).then(function(response) {
                    console.log('Report InstantaneousDemand response', meteringCluster.toString(), response);
                  });*/
                }

                /*if (onOffCluster) {
                  onOffCluster.discoverAttributes(0, 100).then(function(attributes) {
                    console.log('Attributes', onOffCluster.toString(), attributes);
                  });

                  onOffCluster.reportAttributes({
                    id:'OnOff',
                    minimumReportingInterval: 1,
                    maximumReportingInterval: 120
                  }).then(function(response) {
                    console.log('Report OnOff response', onOffCluster.toString(), response);
                  });
                }*/

                /*if (colorCluster) {

                  console.log('Alternating colours', colorCluster.toString());
                  setInterval(function() {
                    setColor(colorCluster, '#FF0000').delay(1500).then(function() {
                      setColor(colorCluster, '#0000FF');
                    });
                  }, 3000);

                } else if (onOffCluster) {

                  console.log('Toggling', onOffCluster.toString());
                  setInterval(function() {
                    onOffCluster.commands.Toggle().done();
                  }, 3000);

                }*/

              });

            });
            device.findActiveEndpoints();
            device.findEndpoints(0x0104, [0x0500], [0x0500]); // HA IAS Zones.
          });
        }).catch(function(e) {
          console.error('Failed getting devices', e.stack);
        });
      }, 5000);
      
    })
    .done();
});



var colorspaces = require('colorspaces');
var Color = require('color');
var Concentrate = require('concentrate');

function setColor(cluster, hex) {

  var color = colorspaces.make_color('hex', hex).as('CIExyY');

  var payload = Concentrate();
  payload.uint16le(Math.floor(color[0] * 0xFFFF)); // Color X
  payload.uint16le(Math.floor(color[1] * 0xFFFF)); // Color Y
  payload.uint16le(3); // Transition duration (1/10th seconds)

  return cluster.commands['Move to Color'](payload.result());
}

