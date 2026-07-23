// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#pragma once
#include "imgui.h"

// Shared draw primitives for the overlay panels: a multi-size font ladder for crisp
// text at any pixel size, plus the 270-degree arc helpers used by the tach and the
// generic gauges.

bool uiFontsInit();   // bake fonts; call after ImGui::CreateContext(), before first frame

// Crisp text: picks the smallest baked font >= px and renders at px (downscaling an
// oversampled glyph stays sharp; scaling UP a small bake is what looks blurry).
void uiText(ImDrawList* dl, float px, ImVec2 pos, ImU32 col, const char* txt);
ImVec2 uiTextSize(float px, const char* txt);   // measure with the same font uiText picks

// 270-degree dial: f = 0..1 sweeps from 225deg (math CCW) clockwise through the bottom.
ImVec2 arcPt(ImVec2 c, float r, float degMath);
void arcSeg(ImDrawList* dl, ImVec2 c, float r, float f0, float f1, ImU32 col, float th);
ImU32 rpmCol(float f);   // green -> yellow -> red by rpm fraction
