'use strict';

var zigbee = require('./index');
var Table = require('cli-table');
var when = require('when');
var ZCLCluster = require('./lib/zcl').ZCLCluster;
var ResetHue = require('./lib/util/ResetHue');

var Concentrate = require('concentrate');

var glob = require('glob');

glob('/dev/cu.usbmodem*', function (err, devices) {
  // TODO: Support the CC2530 on the Sphere.
  if (err || devices.length != 1) {
    //throw new Error('Found ' + devices.length + ' devices that could be the CC2531 usb dongle.');
  }

  connect(devices[0]);
});

//connect('/dev/cu.usbmodem1411');

function connect(path) {

  zigbee
    .connectNetworkProcessor(path)
    .then(function(zigbeeClient) {
      // Display some version information
      return zigbeeClient.firmwareVersion().then(function(version) {
        console.log('Firmware version: %s %d.%d.%d', version.type,
          version.specifics.majorRelease, version.specifics.minorRelease,
          version.specifics.maintenanceRelease);
      })
      //*/ reset our device so we get back to a clean state
      .then(function() {
        return zigbeeClient.resetDevice(true);
      })//*/
      // and now initiate our coordinator
      .then(function() {
        console.log('ZigBee device ready, setting up as coordinator');
        return zigbeeClient.startCoordinator();
      })
      //.delay(15000)
      /*// Disable automatic permit join on the coordinator
      .then(function() {
        return zigbeeClient.permitJoin(0, 0);
      })//*/
      // now find existing devices and print them out
      .then(function() {

      //setTimeout(function() {
        //var reset = new ResetHue(zigbeeClient);
        //reset.findHues();
      //}, 15000);*/

  //    zigbeeClient.permitJoin(128);
//return;
        displayZigBeeDevices(zigbeeClient);

        zigbeeClient.devices().then(function(devices) {
          devices.forEach(function(device) {
            handleDevice(device);
          });
        });

        zigbeeClient.on('device_announce', function(device) {
          console.log('Got new ZigBee device:', device.IEEEAddress);

          displayZigBeeDevices(zigbeeClient);
          handleDevice(device);
        });
      });
    })
    .catch(function(err) {
      console.log('ZigBee client failed:', err.stack);
    })
    .done(function(err) {
      console.log('ZigBee client running.', err);
    });

}

function assert(expected, message) {
  return function(actual) {
    if (expected !== actual) {
      throw new Error(message + ' (Expected: ' + expected + ', Actual:', actual,')');
    }
  };
}


function handleDevice(device) {
  console.log('listening for endpoints');

  device.on('endpoint', function(endpoint) {
    console.log('Got endpoint', endpoint.toString());

    endpoint.inClusters().then(function(inClusters) {

      console.log('Found clusters:', inClusters, 'for endpoint ' + endpoint);

      inClusters.forEach(function(zcl) {

        //*
        if (zcl.description.name == 'Basic') {
          zcl.attributes.readAttributes('ManufacturerName', 'ModelIdentifier').then(function(values) {
            console.log('Device : ' + values.ManufacturerName + ' - Manufacturer : ' + values.ModelIdentifier);
          }).catch(function(err) {
            console.error('Failed to read manufacturer name and device id', err.stack);
          });
        }//*/




        /*if (zcl.name == 'Level Control') {
          zcl.attributes.CurrentLevel.read().then(function(level) {
            console.log('Current level', level);
          });

          var payload = Concentrate();
          payload.uint8(200); // Level
          payload.uint16le(0); // Transition duration (1/10th seconds)

          zcl.commands['Move to Level (with On/Off)'](payload.result()).then(function(response) {
            console.log('Move to level response', response);
          });
        }*/

        var colorspaces = require('colorspaces');
        var Color = require('color');

        function setColor(hex) {

          var color = colorspaces.make_color('hex', hex).as('CIExyY');

          var payload = Concentrate();
          payload.uint16le(Math.floor(color[0] * 0xFFFF)); // Color X
          payload.uint16le(Math.floor(color[1] * 0xFFFF)); // Color Y
          payload.uint16le(3); // Transition duration (1/10th seconds)

          return zcl.commands['Move to Color'](payload.result());

          /*var color = new Color(hex);

          console.log('HUe', color.hue());

          var payload = Concentrate();
          payload.uint16le(Math.floor(color.hue() * 0xFFFF)); // Color X
          payload.uint16le(Math.floor(color[1] * 0xFFFF)); // Color Y
          payload.uint16le(3); // Transition duration (1/10th seconds)

          return zcl.commands['Move to Color'](payload.result());*/
        }

        function go() {

          return setColor('#ff0000')
            .delay(300)
            .then(function() {
              return setColor('#00ff00');
            })
            .delay(300)
            .then(function() {
              return setColor('#0000ff');
            })
            .delay(300);

        }

        if (zcl.name == 'Color Control') {
          go();
          /*
          zcl.readAttributes('CurrentHue', 'CurrentSaturation', 'RemainingTime').then(function(results) {
            console.log(zcl.toString(), 'attributes 0-9', JSON.stringify(results,2,2));
          });//*/

          //go();

          /*
          zcl.reportAttributes({
            attributeIdentifier: 0x00, // CurrentHue
            attributeDataType: 0x21, // uint16le
            minimumReportingInterval: 0,
            maximumReportingInterval: 0,
            reportableChange: 1
          }).then(function(results) {
            console.log(zcl.toString(), 'reporting color attributes', results);
          });//*/




          /*
          setColor('#ff0000')
            .delay(300)
            .then(function() {
              return setColor('#00ff00');
            })
            .delay(300)
            .then(function() {
              return setColor('#0000ff');
            })
            .delay(300);*/

        }

        /*if (zcl.description.name == 'ZLL Commissioning') {

          var payload = Concentrate();
          payload.uint32le(12345); // Inter-PAN transaction identifier
          payload.uint16le(15); // Identify duration (seconds)

          zcl.commands['Identify Request'](payload.result()).then(function(response) {
            console.log('Identify response', response);
          });
        }*/

        if (zcl.name == 'IAS Zone') {
          zcl.reportAttributes({
            attributeIdentifier: 0x0002, // ZoneStatus
            attributeDataType: 0x19, // bmp16
            minimumReportingInterval: 0, // in seconds (no minimum)
            maximumReportingInterval: 10, // in seconds
            reportableChange: true
          }).then(function(results) {
            console.log(zcl.toString(), 'reporting ZoneStatus attribute', results);
          });

          zcl.attributes.ZoneState.read()
            .then(function(value) {
              console.log('ZoneState value', value);
            });

          zcl.attributes.ZoneType.read()
            .then(function(value) {
              console.log('Zonetype value', value);
            });

          zcl.attributes.ZoneStatus.read()
            .then(function(value) {
              console.log('ZoneStatus value', value);
            });
        }

        if (zcl.name == 'Occupancy sensing') {
          zcl.reportAttributes({
            attributeIdentifier: 0x0000, // Occupancy
            attributeDataType: 0x18, // bmp8
            minimumReportingInterval: 0,
            maximumReportingInterval: 0,
            reportableChange: true
          }).then(function(results) {
            console.log(zcl.toString(), 'reporting ooccupancy attribute', results);
          });

          zcl.attributes.Occupancy.read()
            .then(function(value) {
              console.log('Occupancy value', value);
            });
        }

        //*
        if (zcl.description.name == 'On/Off') {
          console.log('Found on/off!');

          zcl.reportAttributes({
            attributeIdentifier: 0x0000, // OnOff
            attributeDataType: 0x10, // boolean
            minimumReportingInterval: 0,
            maximumReportingInterval: 0,
            reportableChange: true
          }).then(function(results) {
            console.log(zcl.toString(), 'reporting onoff attribute', results);
          });

          zcl.attributes.OnOff.read()
            .then(function(value) {
              console.log('Device started on?', value);
              if (!value) { // Ensure we always start on. The relay doesn't appear to respond if its already on!
                return zcl.commands.On()
                  .then(zcl.attributes.OnOff.read)
                  .then(assert(true, 'Device didn\'t turn off'))
                  .delay(1000);
              }
            })

            .then(zcl.commands.Off)
            .then(zcl.attributes.OnOff.read)
            .then(assert(false, 'Device didn\'t turn off!'))

            .delay(1000)

            .then(zcl.commands.On)
            .then(zcl.attributes.OnOff.read)
            .then(assert(true, 'Device didn\'t turn on!'))

            .delay(1000)

            .then(zcl.commands.Toggle)
            .then(zcl.attributes.OnOff.read)
            .then(assert(false, 'Device didn\'t toggle!'))

            .then(function() {
              console.log('Successfully turned the on/off device on and off and whatever.');
            })

          .catch(function(err) {
            console.error('On/Off Cluster fail!', err.stack);
          });

        }//*/

        console.log('cluster! ', zcl.toString(),
          JSON.stringify(Object.keys(zcl.attributes)),
          Object.keys(zcl.commands));
        //*/
/*
        zcl.discoverAttributes(0x0000, 100).then(function(attributes) {
          console.log('Discovered', attributes.length, 'attributes on ', endpoint.toString(), 'cluster', id);
        }).timeout(20000).catch(function(e) {
          console.log('Attribute discovery errored for cluster', id, 'on endpoint', endpoint.toString(), e.stack);
          console.log(JSON.stringify(e));
          console.dir(e);
        });
*/
        /*if (zcl.attributes.MeasuredValue) {
          setInterval(function() {

            zcl.attributes.MeasuredValue.read().then(function(response) {
              console.log('MeasuredValue!', response);
            }).catch(function(err) {
              console.log('Failed to read MeasuredValue', err);
            });

          }, 1000);
        }

        switch (id) {
          case 0x0006: // On/Off
            setInterval(function() {
              zcl.sendClusterSpecificCommand(0x02); // Toggle
            }, 2000);
            break;
          /*case 0x0006: // Identify
            zcl.sendClusterSpecificCommand(0x00); // Identify
            break;
          case 0x0400: // Luminance
            zcl.readAttribute(0x0000).then(function(message) {
              console.log('Response from luminance read', message);
            }).catch(function(error) {
              console.error('Failed on luminance read', error.stack);
            }); // Measured Value
            break;
          case 0x0702: // Smart Energy: Metering
            setInterval(function() {
              zcl.readAttribute(0x0400).then(function(message) { // Instantaneous demand
                console.log('Response from instantanteous demand read', message);
              }).catch(function(error) {
                console.error('Failed on instantanteous demand read', error.stack);
              });
            }, 2000);
            break;
        }*/
      });


      /*if (inClusters.indexOf(0x0702) != -1) { // Smart Energy: Metering
        var zcl = new ZCLCluster(endpoint, 0x0702);

        var i = 0;
        setInterval(function() {
          zcl.readAttribute(i++); // Measured Value
        }, 1000);

      }*/


    }).catch(function(err) {
      console.error('Failed getting clusters for device', err.stack);
    });
  });
}

function displayZigBeeDevices(zigbeeClient) {
  zigbeeClient.devices().then(function(devices) {
    var table = new Table({
      head: ['ShortAddr', 'IEEE Address'],
      colWidths: [12, 25],
    });

    devices.forEach(function(device) {
      table.push([
        device.shortAddress ? device.shortAddress.toString(16) : 'undefined',
        device.IEEEAddress ? device.IEEEAddress.toString(16) : 'undefined'
      ]);
    });

    console.log(table.toString());
  })
  .catch(function(err) {
    console.error(err.stack);
  });
}

process.on('uncaughtException', function(err) {
  console.error('UNCAUGHT ' + err);
  console.error(err.stack);
});