#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""
vgamepad.py — pure-Python virtual Xbox360 gamepad via /dev/uinput (no evdev, no compiler).

L2 of the driving test harness (see docs/test-harness.md): drives SnowRunner through its
normal controller input path (SDL/Steam Input see a real pad), enabling analog throttle,
steering, and full routes for realistic / black-box testing and final mod validation.

  python3 vgamepad.py --selftest     # create device, verify it registered, wiggle, destroy
  python3 vgamepad.py --scenario     # run the demo drive scenario (throttle/shift timeline)

Requires a writable /dev/uinput (systemd uaccess grants the active-session user; on this box
it is writable). If you get EACCES, add yourself to a udev-granted group or run once as root.
"""
import ctypes, fcntl, os, struct, sys, time

# ---- ioctl encoding (asm-generic) ----
def _IOC(d, t, nr, size): return (d << 30) | (size << 16) | (ord(t) << 8) | nr
def _IO(t, nr):           return _IOC(0, t, nr, 0)
def _IOW(t, nr, size):    return _IOC(1, t, nr, size)

# ---- struct sizes ----
SZ_UINPUT_SETUP = 92      # input_id(8) + name[80] + ff_effects_max(4)
SZ_UINPUT_ABS_SETUP = 28  # code(2)+pad(2) + input_absinfo(24)

UI_DEV_CREATE  = _IO('U', 1)
UI_DEV_DESTROY = _IO('U', 2)
UI_DEV_SETUP   = _IOW('U', 3, SZ_UINPUT_SETUP)
UI_ABS_SETUP   = _IOW('U', 4, SZ_UINPUT_ABS_SETUP)
UI_SET_EVBIT   = _IOW('U', 100, 4)
UI_SET_KEYBIT  = _IOW('U', 101, 4)
UI_SET_ABSBIT  = _IOW('U', 102, 4)

# ---- event codes (linux/input-event-codes.h) ----
EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ = 0, 1, 2, 3, 4, 5
ABS_HAT0X, ABS_HAT0Y = 16, 17
BTN_A, BTN_B, BTN_X, BTN_Y = 0x130, 0x131, 0x133, 0x134
BTN_TL, BTN_TR = 0x136, 0x137
BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR = 0x13a, 0x13b, 0x13c, 0x13d, 0x13e
BUS_USB = 0x03

BUTTONS = [BTN_A, BTN_B, BTN_X, BTN_Y, BTN_TL, BTN_TR,
           BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR]
# axis -> (min, max)  matching a real X360 pad. (Hat axes ABS_HAT0X/Y are omitted: some
# kernels reject UI_SET_ABSBIT for them; the harness uses buttons for gear/dpad instead.)
AXES = {ABS_X: (-32768, 32767), ABS_Y: (-32768, 32767),
        ABS_RX: (-32768, 32767), ABS_RY: (-32768, 32767),
        ABS_Z: (0, 255), ABS_RZ: (0, 255)}


class VGamepad:
    def __init__(self, name=b'Microsoft X-Box 360 pad',
                 vendor=0x045e, product=0x028e, version=0x0114):
        self.fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
        ioctl = lambda req, arg: fcntl.ioctl(self.fd, req, arg)
        ioctl(UI_SET_EVBIT, EV_KEY)
        ioctl(UI_SET_EVBIT, EV_ABS)
        ioctl(UI_SET_EVBIT, EV_SYN)
        for b in BUTTONS:
            ioctl(UI_SET_KEYBIT, b)
        for a in AXES:
            ioctl(UI_SET_ABSBIT, a)
        # UI_ABS_SETUP per axis: u16 code; pad; input_absinfo(value,min,max,fuzz,flat,res)
        for code, (lo, hi) in AXES.items():
            absinfo = struct.pack('<Hxx6i', code, 0, lo, hi, 0, 0, 0)
            ioctl(UI_ABS_SETUP, absinfo)
        # UI_DEV_SETUP: input_id{bus,vendor,product,version}; name[80]; ff_effects_max
        setup = struct.pack('<4H80sI', BUS_USB, vendor, product, version,
                            name[:79], 0)
        ioctl(UI_DEV_SETUP, setup)
        fcntl.ioctl(self.fd, UI_DEV_CREATE, 0)
        time.sleep(0.3)  # let udev settle
        self.name = name.decode()

    def _emit(self, etype, code, value):
        # struct input_event: timeval{__kernel_long tv_sec, tv_usec}(2*8) + u16 type +
        # u16 code + s32 value = 24 bytes on 64-bit. Use 'q' (8B); '<l' would be 4B -> EINVAL.
        ev = struct.pack('<qqHHi', 0, 0, etype, code, value)
        os.write(self.fd, ev)

    def axis(self, code, value):
        lo, hi = AXES[code]
        self._emit(EV_ABS, code, max(lo, min(hi, int(value))))

    def button(self, code, pressed):
        self._emit(EV_KEY, code, 1 if pressed else 0)

    def syn(self):
        self._emit(EV_SYN, SYN_REPORT, 0)

    # convenience (0..1 pedals, -1..1 steer)
    def throttle(self, x): self.axis(ABS_RZ, x * 255)          # right trigger
    def brake(self, x):    self.axis(ABS_Z, x * 255)           # left trigger
    def steer(self, x):    self.axis(ABS_X, x * 32767)         # left stick X
    def tap(self, btn, dur=0.08):
        self.button(btn, True); self.syn(); time.sleep(dur)
        self.button(btn, False); self.syn()

    def close(self):
        try: fcntl.ioctl(self.fd, UI_DEV_DESTROY, 0)
        except Exception: pass
        os.close(self.fd)


def registered_name_matches(name):
    try:
        with open('/proc/bus/input/devices') as f:
            return name in f.read()
    except Exception:
        return False


def selftest():
    print('creating virtual X360 pad on /dev/uinput ...')
    try:
        pad = VGamepad()
    except PermissionError:
        print('EACCES on /dev/uinput — not permitted for this user/session.'); return 1
    except OSError as e:
        print(f'uinput error: {e}'); return 1
    ok = registered_name_matches(pad.name)
    print(f'device created: name="{pad.name}"  registered_in_/proc: {ok}')
    print('wiggling throttle + steer + buttons for 2s (harmless, no window focused)...')
    for i in range(20):
        pad.throttle((i % 10) / 10.0)
        pad.steer(((i % 10) - 5) / 5.0)
        pad.syn()
        time.sleep(0.1)
    pad.throttle(0); pad.steer(0); pad.syn()
    pad.close()
    print('destroyed. SELFTEST', 'PASS' if ok else 'PARTIAL (created but not found in /proc)')
    return 0 if ok else 1


# demo scenario (mirrors the L1 scenario shape); gear via dpad-up tap as a placeholder
SCENARIO = [
    (0.0,  dict(throttle=0.0)),
    (5.0,  dict(throttle=1.0)),
    (9.0,  dict(throttle=0.0)),
    (12.0, dict(throttle=1.0)),
    (20.0, dict(shift='up')),
    (28.0, dict(shift='up')),
    (34.0, dict(throttle=0.0)),
]


def run_scenario():
    print('NOTE: map these controls in-game / Steam Input first. Focus the game window.')
    pad = VGamepad()
    t0 = time.time()
    idx = 0
    try:
        while idx < len(SCENARIO):
            t, act = SCENARIO[idx]
            if time.time() - t0 >= t:
                if 'throttle' in act: pad.throttle(act['throttle'])
                if act.get('shift') == 'up': pad.tap(BTN_TR)   # placeholder mapping
                pad.syn()
                print(f'  t={t:.0f}s -> {act}')
                idx += 1
            time.sleep(0.02)
        time.sleep(1)
    finally:
        pad.close()
    return 0


if __name__ == '__main__':
    if '--scenario' in sys.argv:
        raise SystemExit(run_scenario())
    raise SystemExit(selftest())
