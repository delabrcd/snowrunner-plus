# snowrunner-engine mod — Windows PE DLL (.asi), cross-built with mingw-w64.
#   cmake -B build -DCMAKE_TOOLCHAIN_FILE=cmake/mingw-w64-x86_64.cmake
#   cmake --build build
# -> build/snowrunner-engine.asi   (install: ./install-mod.sh)
cmake_minimum_required(VERSION 3.20)
project(snowrunner-engine C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(MH    ${CMAKE_CURRENT_SOURCE_DIR}/vendor/minhook)
set(IMGUI ${CMAKE_CURRENT_SOURCE_DIR}/vendor/imgui)

add_library(snowrunner-engine SHARED
  src/dllmain.cpp
  src/xhook.cpp
  src/mem.cpp
  src/overlay.cpp
  src/gauges.cpp
  src/widgets.cpp
  src/assets.cpp
  src/bindings.cpp
  ${MH}/src/buffer.c
  ${MH}/src/hook.c
  ${MH}/src/trampoline.c
  ${MH}/src/hde/hde64.c
  ${IMGUI}/imgui.cpp
  ${IMGUI}/imgui_draw.cpp
  ${IMGUI}/imgui_tables.cpp
  ${IMGUI}/imgui_widgets.cpp
  ${IMGUI}/backends/imgui_impl_dx11.cpp
  ${IMGUI}/backends/imgui_impl_win32.cpp
)

target_include_directories(snowrunner-engine PRIVATE
  ${MH}/include ${IMGUI} ${IMGUI}/backends)
target_compile_definitions(snowrunner-engine PRIVATE IMGUI_IMPL_WIN32_DISABLE_GAMEPAD)
target_compile_options(snowrunner-engine PRIVATE -Wall)

# fully static: one self-contained .asi, no mingw runtime DLLs to ship
target_link_options(snowrunner-engine PRIVATE -static -static-libgcc -static-libstdc++)
target_link_libraries(snowrunner-engine PRIVATE d3d11 d3dcompiler dwmapi user32 gdi32)

set_target_properties(snowrunner-engine PROPERTIES
  PREFIX "" SUFFIX ".asi"
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
