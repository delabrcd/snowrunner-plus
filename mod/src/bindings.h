// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include <cstdint>

// Binding helpers: keyboard VK names, XInput pad-button names, dynamic XInput polling.
// A bind word is (type << 16) | code — see srdtBind() in telemetry.h.

void keyNameOf(uint32_t vk, char* out_, int n);
void bindName(uint32_t bind, char* out_, int n);   // "---" when unbound
uint32_t padButtons();   // XINPUT_GAMEPAD::wButtons of pad 0; 0 when no pad / no XInput
