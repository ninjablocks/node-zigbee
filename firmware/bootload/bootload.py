import serial
import struct
import sys, os
from collections import namedtuple
from progressbar import *

BLResponse = namedtuple('BLResponse', ['flags', 'command', 'payload', 'status'])

ser = serial.Serial('/dev/ttyO4', 115200, timeout=10, rtscts=0)

SB_SOF = 0xFE

SB_MB_WAIT_HS = 2

SB_WRITE_CMD                = 0x01
SB_READ_CMD                 = 0x02
SB_ENABLE_CMD               = 0x03
SB_HANDSHAKE_CMD            = 0x04

SB_SUCCESS                  = 0
SB_FAILURE                  = 1
SB_INVALID_FCS              = 2
SB_INVALID_FILE             = 3
SB_FILESYSTEM_ERROR         = 4
SB_ALREADY_STARTED          = 5
SB_NO_RESPOSNE              = 6
SB_VALIDATE_FAILED          = 7
SB_CANCELED                 = 8

SB_RESPONSE_MASK = 0x80

SB_RPC_CMD_AREQ = 0x40
MT_RPC_SYS_SBL = 13

SB_RW_BUF_LEN = 64

from itertools import izip, chain, repeat
def grouper(n, iterable, padvalue=None):
    "grouper(3, 'abcdefg', 'x') --> ('a','b','c'), ('d','e','f'), ('g','x','x')"
    return izip(*[chain(iterable, repeat(padvalue, n-1))]*n)

def calcFCS(data):
	return reduce(lambda a,b:a^b, (ord(c) for c in data))

def make_packet(cmd2, payload=''):
	cmd1 = SB_RPC_CMD_AREQ | MT_RPC_SYS_SBL
	packet_len = len(payload)
	data = struct.pack('<BBBB', SB_SOF, packet_len, cmd1, cmd2)
	data += payload
	data += chr(calcFCS(data[1:])) # FCS
	assert len(data) == packet_len + 5
	#print '>', data.encode('hex')
	return data

def send_packet(cmd, payload=''):
	ser.write(make_packet(cmd, payload))
	response = recv_packet()
	assert response.command == cmd
	return response

def recv_packet():
	header = ser.read(4)
	(sof, packet_len, cmd1, cmd2) = struct.unpack('<BBBB', header)
	assert sof == SB_SOF
	packet = ser.read(packet_len)
	fcs = ord(ser.read(1))
	assert calcFCS(header[1:]+packet) == fcs
	assert cmd2 & SB_RESPONSE_MASK == SB_RESPONSE_MASK
	cmd2 = cmd2 & ~SB_RESPONSE_MASK
	status = None
	if len(packet):
		status = ord(packet[0])
	return BLResponse(cmd1, cmd2, packet, status)

response = send_packet(SB_HANDSHAKE_CMD, chr(SB_MB_WAIT_HS))
if response.status == SB_SUCCESS:
	print 'Handshake OK'
else:
	print 'Handshake FAILed'
	sys.exit(1)

def flash_firmware(filename):
	f = chain(*open(filename, 'rb'))
	for i, chunk in enumerate(grouper(SB_RW_BUF_LEN, f, '\x00')):
		offset = i*SB_RW_BUF_LEN
		payload = struct.pack('<H', offset / 4) + ''.join(chunk)
		assert len(payload) == SB_RW_BUF_LEN + 2
		#print payload.encode('hex')
		response = send_packet(SB_WRITE_CMD, payload)
		if response.status == SB_SUCCESS:
			yield offset
		else:
			print 'Flash write FAILed'
			sys.exit(1)

filename = sys.argv[1]
file_size = os.path.getsize(filename)
pbar = ProgressBar(widgets=[Percentage(), Bar()], maxval=(file_size)).start()
for i in flash_firmware(filename):
	pbar.update(i)
pbar.finish()

response = send_packet(SB_ENABLE_CMD, '')
if response.status == SB_SUCCESS:
	print 'Execute image OK'
else:
	print 'Execute image FAILed'
	sys.exit(1)
