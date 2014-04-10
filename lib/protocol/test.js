var packets = require('./packets');

var opts = {
  DstAddr: {
    address: 0xffff
  },
  DstEndpoint: 0x00,
  DstPanId: 0xffff,
  SrcEndpoint: 0xff,
  ClusterID: 0x1000,
  TransID: 0x01,
  Options: {
    wilcardProfileId: true,
    ackRequest: false,
    discoverRoute: true,
    security: false,
    skipRouting: true
  },
  Radius: 0x02,
  payload: new Buffer([1,2,3,4,5])
};

console.log('attribute values', opts);


var buffer = packets.AF_DATA_REQUEST_EXT.write(opts);

console.log('wrote to buffer', buffer);


var parsed = packets.AF_DATA_REQUEST_EXT.read(buffer);

console.log('parsed from buffer', parsed);