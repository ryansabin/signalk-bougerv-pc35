# BougeRV PC35 Pro — BLE control protocol

Reverse-engineered from the BougeRV Android app (`com.caption.bougerv`,
class `com.caption.bougerv.bleoperation.BlePortableAcUtils` + `BLEConstantsKt`).
The PC35 Pro uses BougeRV's **own** BLE protocol (not Tuya-cloud), a Tuya-style
datapoint frame carried over a private GATT service. No device local-key or
cloud pairing is needed — it's plain GATT writes + notifications.

## Device / GATT

| Item | Value |
|------|-------|
| Advertised name prefix | `PC35` (older units: `ISSY-M01`) |
| Service UUID | `0000abf0-0000-1000-8000-00805f9b34fb` |
| **Write** characteristic | `0000abf1-0000-1000-8000-00805f9b34fb` |
| **Notify** characteristic | `0000abf3-0000-1000-8000-00805f9b34fb` |
| Connection | single-client — only ONE phone/host at a time |

Enable notifications on `abf1`/`abf3` (write `0x0001` to the CCCD `0x2902`),
then write commands to `abf1`. The device pushes status frames on `abf3`.

## Command frame (host → AC), write to 0xABF1

Fixed 12-byte frame for all setters:

```
55 AA 01 <CMD> 00 05 <CMD> <RW> 00 01 <VAL> <SUM>
 0  1  2   3    4  5   6    7   8  9   10   11
```

- bytes 0-1: header `55 AA` (drainage uses `AA AA`, see below)
- byte 2: `01` (protocol version / slave addr)
- byte 3 & 6: command code (repeated)
- byte 5: `05` payload length
- byte 7: `RW` — `01` = write-with-ack style, `00` = set
- byte 9: `01` value length
- byte 10: the value
- byte 11: **checksum** = (sum of bytes 0..10) AND 0xFF

### Command codes

| Function | CMD | RW | VAL | Notes |
|----------|-----|----|----|-------|
| Power | `0x70` | 1 | 0=off, 1=on | |
| Set temp | `0x71` | 0 | setpoint in **°C**, clamped 16..55 (practical 16–31) | |
| Mode | `0x72` | 0 | see modes | |
| Fan (wind) | `0x73` | 0 | 1=low, 2=med, 3=high | |
| Drainage | `0x74` | 1 | 0=close, 1=open | header is `AA AA` |
| Timing | `0x75` | 0 | hours 0..24 | |
| Appointment | `0x76` | 0 | hours 0..24 | |
| Lighting | `0x78` | 1 | brightness | |
| Temp unit (display) | `0x81` | 1 | 0=°C, 1=°F | affects display only; setpoint stays °C |

### Modes (byte value)

| Mode | Value |
|------|-------|
| Eco / conserve energy | 1 |
| Cool (refrigeration) | 2 |
| Strong breeze | 3 |
| Fan / air supply | 4 |
| Dehumidify | 5 |
| Strong cool | 6 |
| Sleep | 7 |
| Turbo (strong) | 8 |
| Heat | 9 |

### Status poll (7-byte)

```
55 AA 01 20 00 00 20
```

(`0x20` = get-device-info; checksum 0x20.) Send this to request a status frame;
the AC also pushes status on state changes.

### Worked examples (verified against the app's checksum routine)

| Action | Bytes |
|--------|-------|
| Power ON | `55 AA 01 70 00 05 70 01 00 01 01 E8` |
| Power OFF | `55 AA 01 70 00 05 70 01 00 01 00 E7` |
| Set 20 °C | `55 AA 01 71 00 05 71 00 00 01 14 FC` |
| Mode = Cool | `55 AA 01 72 00 05 72 00 00 01 02 EC` |
| Fan = High | `55 AA 01 73 00 05 73 00 00 01 03 EF` |
| Get status | `55 AA 01 20 00 00 20` |

## Status frame (AC → host) on 0xABF3

Tuya-style DP report, ~54 bytes. Byte offsets:

| Offset | Field |
|--------|-------|
| 0 | header1 `0x55` |
| 1 | header2 `0xAA` |
| 2 | version |
| 3 | command |
| 4-5 | length (H,L) |
| 6-9 | power DP header (id,type,lenH,lenL) |
| **10** | **power** (0/1) |
| 11-14 | temp DP header |
| **15** | **temp setpoint (°C)** |
| 16-19 | mode DP header |
| **20** | **mode** (1–9) |
| 21-24 | fan DP header |
| **25** | **fan** (1–3) |
| 26-29 | drainage DP header |
| **30** | **drainage** (0/1) |
| 31-34 | timing DP header |
| **35** | **timing** (hours) |
| 36-39 | appointment DP header |
| **40** | **appointment** (hours) |
| 41-44 | lighting DP header |
| **45** | **lighting** |
| 46-49 | temp-unit DP header |
| **50** | **temp unit** (0=°C,1=°F) |
| 51-52 | remaining time (16-bit, `hi<<8 | lo`) |
| 53 | checksum |

Temperature is native **Celsius**; the app converts to °F for display
(16 °C=61 °F, 20 °C=68 °F, 30 °C=86 °F — standard rounding).
