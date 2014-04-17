'use strict';

var ZCLClient = require('../lib/zcl/ZCLClient');

var client = new ZCLClient();

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
                });
              });

            });
            device.findActiveEndpoints();
            device.findEndpoints(0x0104, [0x0500], [0x0500]); // HA IAS Zones.
          });
        });
      }, 5000);
      
    })
    .done();
});

