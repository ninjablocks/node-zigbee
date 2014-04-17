var Enum = require('enum');

var consts = {};

consts.FrameControl = new Enum({
  EntireProfile: 0x00,
  ClusterSpecific: 0x01,

  Reserved: 0x02,

  ManufacturerSpecific: 0x04,

  DirectionServerToClient: 0x08,
  DirectionClientToServer: 0x00,

  DisableDefaultResponse: 0x10,
  EnableDefaultResponse: 0x00,

  // rest are reserved
});

consts.GeneralCommands = new Enum({
  ReadAttributes: 0x00,
  ReadAttributesResponse: 0x01,

  WriteAttributes: 0x02,
  WriteAttributesUndivided: 0x03,
  WriteAttributesResponse: 0x04,
  WriteAttributesNoResponse: 0x05,

  ConfigureReporting: 0x06,
  ConfigureReportingResponse: 0x07,

  ReadReportingConfiguration: 0x08,
  ReadReportingConfigurationResponse: 0x09,

  ReportAttributes: 0x0A,

  DefaultResponse: 0x0B,

  DiscoverAttributes: 0x0C,
  DiscoverAttributesResponse: 0x0D,

  ReadAttributesStructured: 0x0E,
  WriteAttributesStructured: 0x0F,
  WriteAttributesStructuredResponse: 0x10,

  // reserved 0x11 - 0xff
});

consts.Status = new Enum({
  SUCCESS: 0x00,
  FAILURE: 0x02,
  MALFORMED_COMMAND: 0x80,
  UNSUP_CLUSTER_COMMAND: 0x81,
  UNSUP_GENERAL_COMMAND: 0x82,
  UNSUP_MANUF_CLUSTER_COMMAND: 0x83,
  UNSUP_MANUF_GENERAL_COMMAND: 0x84,
  INVALID_FIELD: 0x85,
  UNSUPPORTED_ATTRIBUTE: 0x86,
  INVALID_VALUE: 0x87,
  READ_ONLY: 0x88,
  INSUFFICIENT_SPACE: 0x89,
  DUPLICATE_EXISTS: 0x8a,
  NOT_FOUND: 0x8b,
  UNREPORTABLE_ATTRIBUTE: 0x8c,
  INVALID_DATA_TYPE: 0x8d,
  HARDWARE_FAILURE: 0xc0,
  SOFTWARE_FAILURE: 0xc1,
  CALIBRATION_ERROR: 0xc2
});

module.exports = consts;