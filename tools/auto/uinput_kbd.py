#!/usr/bin/env python3
"""
uinput_kbd.py — pure-Python uinput virtual keyboard (no evdev/compiler). For autonomous
menu navigation and keyboard driving of SnowRunner. uinput sits below the compositor, so
keys reach whatever window is focused — focus the game first.

  python3 uinput_kbd.py --selftest              # create/register/destroy (no keys sent)
  python3 uinput_kbd.py --tap ENTER             # press+release a key
  python3 uinput_kbd.py --hold W 3              # hold W for 3s (e.g. drive forward)
  python3 uinput_kbd.py --seq "DOWN DOWN ENTER" # sequence of taps
"""
import fcntl, os, struct, sys, time

def _IOC(d, t, nr, size): return (d << 30) | (size << 16) | (ord(t) << 8) | nr
def _IO(t, nr): return _IOC(0, t, nr, 0)
def _IOW(t, nr, size): return _IOC(1, t, nr, size)
UI_DEV_CREATE = _IO('U', 1); UI_DEV_DESTROY = _IO('U', 2)
UI_DEV_SETUP = _IOW('U', 3, 92); UI_SET_EVBIT = _IOW('U', 100, 4); UI_SET_KEYBIT = _IOW('U', 101, 4)
EV_SYN, EV_KEY = 0x00, 0x01
SYN_REPORT = 0; BUS_USB = 0x03

KEYS = {
    'ESC': 1, 'BACKSPACE': 14, 'TAB': 15, 'ENTER': 28, 'SPACE': 57,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    'W': 17, 'A': 30, 'S': 31, 'D': 32, 'E': 18, 'Q': 16, 'R': 19, 'F': 33, 'C': 46,
    'UP': 103, 'DOWN': 108, 'LEFT': 105, 'RIGHT': 106,
    'LSHIFT': 42, 'LCTRL': 29, 'LALT': 56,
    'F1': 59, 'F5': 63, 'F9': 67,
    # mod shifter keys: ] up, [ down, \ cycles gearbox mode (memexplore 30-gearbox.js)
    'LEFTBRACE': 26, 'RIGHTBRACE': 27, 'BACKSLASH': 43,
}


class Keyboard:
    def __init__(self, name=b'py-uinput-kbd'):
        self.fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_SYN)
        for code in set(KEYS.values()):
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        setup = struct.pack('<4H80sI', BUS_USB, 0x1209, 0x0001, 0x0001, name[:79], 0)
        fcntl.ioctl(self.fd, UI_DEV_SETUP, setup)
        fcntl.ioctl(self.fd, UI_DEV_CREATE, 0)
        time.sleep(0.3)

    def _emit(self, t, c, v):
        os.write(self.fd, struct.pack('<qqHHi', 0, 0, t, c, v))

    def _key(self, name, down):
        c = KEYS[name.upper()]
        self._emit(EV_KEY, c, 1 if down else 0)
        self._emit(EV_SYN, SYN_REPORT, 0)

    def tap(self, name, dur=0.06):
        self._key(name, True); time.sleep(dur); self._key(name, False); time.sleep(0.05)

    def hold(self, name, seconds):
        self._key(name, True); time.sleep(seconds); self._key(name, False)

    def close(self):
        try: fcntl.ioctl(self.fd, UI_DEV_DESTROY, 0)
        except Exception: pass
        os.close(self.fd)


def registered():
    try:
        with open('/proc/bus/input/devices') as f: return 'py-uinput-kbd' in f.read()
    except Exception: return False


def main():
    a = sys.argv[1:]
    if not a or a[0] == '--selftest':
        kb = Keyboard(); ok = registered()
        print(f'keyboard created, registered_in_/proc: {ok}'); kb.close()
        print('SELFTEST', 'PASS' if ok else 'FAIL'); return 0 if ok else 1
    kb = Keyboard()
    try:
        if a[0] == '--tap':   kb.tap(a[1])
        elif a[0] == '--hold': kb.hold(a[1], float(a[2]))
        elif a[0] == '--seq':
            for k in a[1].split(): kb.tap(k)
        else: print('unknown args', a); return 2
        print('done', a)
    finally:
        kb.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
